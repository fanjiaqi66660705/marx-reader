/**
 * 浏览器端 RAG：静态站点（GitHub Pages）下直连 SiliconFlow 完成检索 + 生成
 * - 检索：bge-m3 查询向量 × int8 量化子块向量（余弦）+ 字符二元组关键词分，RRF 融合
 * - 生成：SiliconFlow Qwen 流式输出（SSE）
 * 数据在首次提问时懒加载（chunks.json + embeddings.bin，约 8MB）
 */

export interface Citation {
  childId: number;
  title: string;
  chapter: string | null;
  section: string | null;
  quote: string;
}

interface ChildChunk extends Citation {
  parentId: number | null;
}

interface RagData {
  children: ChildChunk[];
  parents: Record<string, string>;
  count: number;
  dim: number;
  scales: Float32Array; // 每向量 [min, range]
  quant: Int8Array;
}

const API_KEY = process.env.NEXT_PUBLIC_SF_API_KEY ?? "";
const BASE_URL = (process.env.NEXT_PUBLIC_SF_BASE_URL ?? "https://api.siliconflow.cn/v1").replace(/\/+$/, "");
const EMBED_MODEL = process.env.NEXT_PUBLIC_EMBED_MODEL ?? "BAAI/bge-m3";
const CHAT_MODEL = process.env.NEXT_PUBLIC_CHAT_MODEL ?? "Qwen/Qwen2.5-7B-Instruct";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

let ragPromise: Promise<RagData> | null = null;

async function loadRag(): Promise<RagData> {
  const [chunksMod, binRes] = await Promise.all([
    import("@/data-static/chunks.json"),
    fetch(`${BASE_PATH}/data/embeddings.bin`),
  ]);
  if (!binRes.ok) throw new Error(`向量数据加载失败（${binRes.status}）`);
  const buf = await binRes.arrayBuffer();
  const view = new DataView(buf);
  const metaLen = view.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, metaLen))) as {
    count: number;
    dim: number;
  };
  const scalesOff = 4 + metaLen;
  const scales = new Float32Array(buf.slice(scalesOff, scalesOff + meta.count * 2 * 4));
  const quant = new Int8Array(buf.slice(scalesOff + meta.count * 2 * 4));
  const raw = chunksMod.default as unknown as {
    children: Array<ChildChunk & { parentId: number | null }>;
    parents: Record<string, string>;
  };
  return { children: raw.children, parents: raw.parents, ...meta, scales, quant };
}

/** 首次调用会加载约 8MB 数据，之后命中缓存 */
export function warmupRag(): Promise<RagData> {
  ragPromise ??= loadRag();
  return ragPromise;
}

async function embedQuery(text: string): Promise<Float32Array> {
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: [text], encoding_format: "float" }),
  });
  if (!res.ok) throw new Error(`Embedding 请求失败（${res.status}）`);
  const j = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return new Float32Array(j.data[0].embedding);
}

/** 字符二元组集合（中文关键词近似匹配） */
function bigrams(text: string): Set<string> {
  const clean = text.replace(/[\s\p{P}\p{S}]/gu, "");
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}

const RRF_K = 60;
const TOP_K = 6;
const CANDIDATES = 20;

export interface RetrievalResult {
  contexts: string[];
  citations: Citation[];
}

export async function retrieve(question: string): Promise<RetrievalResult> {
  const rag = await warmupRag();
  const qv = await embedQuery(question);

  // 余弦相似度（子块向量已按 min-max int8 量化，还原为 q/254*range+min 后与查询点积；查询向量先 L2 归一）
  let qNorm = 0;
  for (let d = 0; d < rag.dim; d++) qNorm += qv[d] * qv[d];
  qNorm = Math.sqrt(qNorm) || 1;

  const vecScore = new Float32Array(rag.count);
  const deq = new Float32Array(rag.dim);
  for (let i = 0; i < rag.count; i++) {
    const min = rag.scales[i * 2], range = rag.scales[i * 2 + 1];
    const off = i * rag.dim;
    let dot = 0, n2 = 0;
    for (let d = 0; d < rag.dim; d++) {
      const v = ((rag.quant[off + d] + 127) / 254) * range + min;
      deq[d] = v;
      dot += qv[d] * v;
      n2 += v * v;
    }
    vecScore[i] = dot / ((qNorm * Math.sqrt(n2)) || 1);
  }

  // 关键词分：问题二元组在子块中的命中率
  const qGrams = bigrams(question);
  const kwScore = new Float32Array(rag.count);
  if (qGrams.size > 0) {
    rag.children.forEach((c, i) => {
      let hit = 0;
      const cGrams = bigrams(c.quote);
      for (const g of qGrams) if (cGrams.has(g)) hit++;
      kwScore[i] = hit / qGrams.size;
    });
  }

  // RRF 融合两路排序
  const vecRank = [...Array(rag.count).keys()].sort((a, b) => vecScore[b] - vecScore[a]).slice(0, CANDIDATES);
  const kwRank = [...Array(rag.count).keys()].sort((a, b) => kwScore[b] - kwScore[a]).slice(0, CANDIDATES);
  const rrf = new Map<number, number>();
  vecRank.forEach((idx, r) => rrf.set(idx, (rrf.get(idx) ?? 0) + 1 / (RRF_K + r + 1)));
  kwRank.forEach((idx, r) => rrf.set(idx, (rrf.get(idx) ?? 0) + 1 / (RRF_K + r + 1)));

  const top = [...rrf.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_K);
  const citations: Citation[] = [];
  const contextSet = new Map<string, true>();
  for (const [idx] of top) {
    const c = rag.children[idx];
    citations.push({ childId: c.childId, title: c.title, chapter: c.chapter, section: c.section, quote: c.quote });
    const parent = c.parentId !== null ? rag.parents[String(c.parentId)] : undefined;
    contextSet.set(parent ?? c.quote, true);
  }
  return { contexts: [...contextSet.keys()], citations };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 流式对话：逐 token 产出文本增量 */
export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: true, temperature: 0.3 }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败（${res.status}）：${detail.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // 忽略无法解析的行
      }
    }
  }
}
