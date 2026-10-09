/**
 * Embedding 客户端：SiliconFlow + BAAI/bge-m3（1024 维）
 *
 * OpenAI 兼容 /v1/embeddings 端点，支持批量输入（最多 64 条/请求）
 * bge-m3 是目前中文语义检索效果最好的开源向量模型之一
 */

const BATCH_SIZE = 32;

interface EmbedConfig {
  apiKey: string;
  model: string;
  baseURL: string;
}

function getConfig(): EmbedConfig {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) throw new Error("缺少 EMBEDDING_API_KEY，请在 .env 中配置");
  const model = process.env.EMBEDDING_MODEL || "BAAI/bge-m3";
  const baseURL = (process.env.EMBEDDING_BASE_URL ?? "https://api.siliconflow.cn/v1").replace(/\/+$/, "");
  return { apiKey, model, baseURL };
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const { apiKey, model, baseURL } = getConfig();
  const res = await fetch(`${baseURL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts, encoding_format: "float" }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Embedding 请求失败 HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const j = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return j.data.map((d) => d.embedding);
}

/** 批量向量化（入库用），内部自动分批 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(batch);
    out.push(...vectors);
  }
  return out;
}

/** 单条向量化（检索提问用） */
export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  return vec;
}
