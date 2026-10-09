/**
 * 结构感知的父子分块器
 *
 * 设计要点（针对经典著作长论证链）：
 * - 子块（~420 字）：向量检索的最小命中单元
 * - 父块（~1600 字）：命中子块后回取的生成上下文，保证论证完整
 * - 元数据：识别「第X章 / 第X节」标题行，逐块携带，供引用溯源
 */

const PARENT_SIZE = 1600;
const CHILD_SIZE = 420;
const CHILD_OVERLAP = 60;

export interface StructuredChunk {
  kind: "parent" | "child";
  book: string;
  chapter: string | null;
  section: string | null;
  seq: number;
  /** 子块所属父块的 seq，用于入库时建立回链 */
  parentSeq: number | null;
  content: string;
  charLen: number;
}

/** 篇章/章节标题：检测到即单独成段，不与正文粘连（长度与数字约束见 buildChunks） */
const HEADING_RE =
  /^(?:第[一二三四五六七八九十百千零〇\d]+[编章节卷篇部][^\n]{0,40}|[一二三四五六七八九十]+\s{2,}\S.{0,30}|［[^］]{2,30}］|【[^】]{2,30}】)$/;

/** 目录点线引导符（连续省略号/点线，正文不会出现） */
const TOC_DOTS_RE = /(…{3,}|．{3,}|·{5,}|\.{5,}|—{5,})/;
/** 页眉页码行：如「七 ７５６」 */
const HEADER_PAGENO_RE = /^[一二三四五六七八九十]+\s+[0-9０-９]+\s*$/;

/** 文本清洗：去 PDF 噪声、合并行内软换行、还原段落结构 */
export function cleanText(raw: string): string {
  const rawLines = raw.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());

  // 第一轮：标记噪声行（页标记 / 页码 / 空白乱码行 / 目录点线行 / 页眉页码）
  const kept = rawLines.map((line) => {
    if (line === "") return "";
    if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(line)) return null; // pdf-parse 页标记
    if (/^[0-9０-９]+\s*$/.test(line)) return null; // 半角/全角独立页码
    if (TOC_DOTS_RE.test(line)) return null; // 目录条目（带点线引导符）
    if (HEADER_PAGENO_RE.test(line)) return null; // 页眉「章节 + 页码」
    if (/^第[一二三四五六七八九十百千零〇\d]+卷(编审人员)?$/.test(line)) return null; // 页眉「第X卷」
    if (/^第[一二三四五六七八九十百千零〇\d]+[章编]$/.test(line)) return null; // 页眉「第X章」（无标题文字）
    const stripped = line.replace(/\s+/g, "");
    if (stripped.length < 3) return null; // 零散符号
    if ((line.match(/\s/g) ?? []).length / line.length > 0.5 && stripped.length < 20) return null; // 大段空白夹杂乱码
    return line;
  });

  // 第二轮：页码/页标记相邻的短行（无句读标点）视为页眉书名
  const noiseIdx = new Set<number>();
  kept.forEach((v, i) => {
    if (v !== null) return;
    for (const j of [i - 1, i - 2, i + 1, i + 2]) {
      const cand = kept[j];
      if (cand && cand.length <= 12 && !/[。，；：？！、]/.test(cand) && !HEADING_RE.test(cand)) {
        noiseIdx.add(j);
      }
    }
  });

  const lines = kept
    .map((v, i) => (v === null || noiseIdx.has(i) ? "" : v))
    .filter((l) => l !== "");

  // 第三轮：连续非空行合并为段落，遇到标题行则断段
  const paragraphs: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf) paragraphs.push(buf);
    buf = "";
  };
  for (const line of lines) {
    const isHeading = HEADING_RE.test(line);
    const startsNote = /^[①-⑳⓪]/.test(line);
    if (!buf || isHeading || startsNote) {
      flush();
      buf = line;
      if (isHeading) flush();
    } else {
      buf += line;
    }
  }
  flush();

  return paragraphs.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 标题归类：严格限制长度与构成，避免目录残留/页眉/正文误判 */
function classifyHeading(p: string): "chapter" | "section" | null {
  if (p.length > 40 || TOC_DOTS_RE.test(p)) return null;
  if (/^第[一二三四五六七八九十百千零〇\d]+[编章卷篇部]/.test(p)) return "chapter";
  if (/^第[一二三四五六七八九十百千零〇\d]+[节回]/.test(p)) return "section";
  if (/^［[^］]{2,20}］$/.test(p)) return "section";
  // 宣言式标题「一 资产者和无产者」：中文数字起头、无句读标点
  if (/^[一二三四五六七八九十]+\s\S/.test(p) && !/[。，；：？！、]/.test(p)) return "section";
  return null;
}

/** 标题行规范化：折叠多余空白、剥除尾粘的全角页码 */
function normalizeHeading(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/[0-9０-９]+\s*$/, "")
    .trim();
}

/** 按中文句子边界切分，保留标点 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；…])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 将段落序列聚合成 ~size 的块，单段超长时按句子硬切 */
function aggregate(paragraphs: string[], size: number): string[] {
  const blocks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if (buf && buf.length + p.length + 1 > size) {
      blocks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n${p}` : p;
    }
    while (buf.length > size * 1.4) {
      const sentences = splitSentences(buf);
      let head = "";
      let i = 0;
      while (i < sentences.length && head.length + sentences[i].length <= size) {
        head += sentences[i];
        i++;
      }
      blocks.push(head);
      buf = sentences.slice(i).join("");
    }
  }
  if (buf) blocks.push(buf);
  return blocks;
}

export function buildChunks(raw: string, book: string): StructuredChunk[] {
  const text = cleanText(raw);
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);

  // 第一遍：按标题行与长度聚合出父块，跟踪章节元数据
  const parents: StructuredChunk[] = [];
  let chapter: string | null = null;
  let section: string | null = null;
  let parentSeq = 0;

  let bufParas: string[] = [];
  let bufChapter: string | null = null;
  let bufSection: string | null = null;

  const flushParent = () => {
    if (bufParas.length === 0) return;
    const content = bufParas.join("\n");
    parents.push({
      kind: "parent",
      book,
      chapter: bufChapter,
      section: bufSection,
      seq: parentSeq++,
      parentSeq: null,
      content,
      charLen: content.length,
    });
    bufParas = [];
  };

  for (const p of paragraphs) {
    const heading = classifyHeading(p);
    if (heading === "chapter") {
      flushParent();
      chapter = normalizeHeading(p);
      section = null;
      continue;
    }
    if (heading === "section") {
      flushParent();
      section = normalizeHeading(p);
      continue;
    }
    const metaChanged = bufParas.length > 0 && (chapter !== bufChapter || section !== bufSection);
    if (metaChanged) flushParent();
    if (bufParas.length === 0) {
      bufChapter = chapter;
      bufSection = section;
    }
    bufParas.push(p);
    if (bufParas.join("\n").length >= PARENT_SIZE) flushParent();
  }
  flushParent();

  // 第二遍：从每个父块做句子级滑窗，切出带 overlap 的子块
  const children: StructuredChunk[] = [];
  let childSeq = 0;
  for (const parent of parents) {
    const sentences = splitSentences(parent.content.replace(/\n/g, ""));
    let i = 0;
    while (i < sentences.length) {
      let content = "";
      let end = i;
      while (end < sentences.length && content.length + sentences[end].length <= CHILD_SIZE) {
        content += sentences[end];
        end++;
      }
      if (!content) {
        content = sentences[i]; // 兜底：单句超长
        end = i + 1;
      }
      children.push({
        kind: "child",
        book,
        chapter: parent.chapter,
        section: parent.section,
        seq: childSeq++,
        parentSeq: parent.seq,
        content,
        charLen: content.length,
      });
      if (end >= sentences.length) break;
      // 回退 ~CHILD_OVERLAP 字符的句子作为下一窗口开头
      let back = 0;
      let j = end - 1;
      while (j > i && back < CHILD_OVERLAP) {
        back += sentences[j].length;
        j--;
      }
      i = j + 1 > i ? j + 1 : i + 1;
    }
  }

  return [...parents, ...children];
}
