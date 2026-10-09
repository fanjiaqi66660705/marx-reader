import { getDb, toVecBlob, EMBEDDING_DIM } from "./db";
import { embedQuery } from "./embeddings";

/**
 * 混合检索层：向量召回 + FTS5(trigram) BM25 关键词召回 → RRF 融合
 * 命中子块后回取父块作为生成上下文，子块本身作为引用溯源依据
 */

export interface Citation {
  childId: number;
  documentId: number;
  title: string;
  chapter: string | null;
  section: string | null;
  quote: string;
  score: number;
}

export interface RetrievalResult {
  /** 父块文本（去重后的生成上下文） */
  contexts: string[];
  /** 引用列表（子块级，供前端展示溯源） */
  citations: Citation[];
}

interface Hit {
  childId: number;
  rrfScore: number;
  vectorDistance: number | null;
}

const RRF_K = 60;
const VECTOR_CANDIDATES = 20;
const FTS_CANDIDATES = 20;
const FINAL_TOP_K = 6;

function sanitizeFtsQuery(q: string): string {
  return q.replace(/["'()*:^{}[\]]/g, " ").trim();
}

export async function retrieve(
  question: string,
  opts: { documentId?: number } = {}
): Promise<RetrievalResult> {
  const db = getDb();

  // 1) 向量召回（查询侧指令；vec_rowid 经 vec_map 映射回 chunk_id）
  const queryVec = await embedQuery(question);
  const vecRows = db
    .prepare(
      `SELECT m.chunk_id, v.distance FROM chunk_vecs v
       JOIN vec_map m ON m.vec_rowid = v.rowid
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`
    )
    .all(toVecBlob(queryVec), VECTOR_CANDIDATES) as Array<{
    chunk_id: number;
    distance: number;
  }>;

  // 2) BM25 关键词召回（trigram 分词器，支持中文子串）
  const ftsRows = db
    .prepare(
      `SELECT rowid, bm25(chunks_fts) AS rank FROM chunks_fts
       WHERE chunks_fts MATCH ?
       ORDER BY rank LIMIT ?`
    )
    .all(sanitizeFtsQuery(question), FTS_CANDIDATES) as Array<{
    rowid: number;
    rank: number;
  }>;

  // 3) RRF 融合
  const hits = new Map<number, Hit>();
  vecRows.forEach((r, i) => {
    hits.set(r.chunk_id, {
      childId: r.chunk_id,
      rrfScore: 1 / (RRF_K + i + 1),
      vectorDistance: r.distance,
    });
  });
  ftsRows.forEach((r, i) => {
    const prev = hits.get(r.rowid);
    if (prev) {
      prev.rrfScore += 1 / (RRF_K + i + 1);
    } else {
      hits.set(r.rowid, { childId: r.rowid, rrfScore: 1 / (RRF_K + i + 1), vectorDistance: null });
    }
  });

  const candidates = [...hits.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, FINAL_TOP_K);
  if (candidates.length === 0) return { contexts: [], citations: [] };

  // 4) 取子块详情与父块内容
  const chunkStmt = db.prepare(
    `SELECT c.id, c.document_id, c.parent_id, c.book, c.chapter, c.section, c.content,
            d.title
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.id = ?`
  );
  const parentStmt = db.prepare(`SELECT content FROM chunks WHERE id = ?`);

  const citations: Citation[] = [];
  const contextSet = new Map<string, true>();

  for (const hit of candidates) {
    const row = chunkStmt.get(hit.childId) as
      | {
          id: number;
          document_id: number;
          parent_id: number | null;
          book: string;
          chapter: string | null;
          section: string | null;
          content: string;
          title: string;
        }
      | undefined;
    if (!row) continue;

    citations.push({
      childId: row.id,
      documentId: row.document_id,
      title: row.title,
      chapter: row.chapter,
      section: row.section,
      quote: row.content,
      score: hit.rrfScore,
    });

    // 优先父块作为生成上下文，无父块则用子块本身
    const parentContent =
      row.parent_id !== null
        ? ((parentStmt.get(row.parent_id) as { content: string } | undefined)?.content ?? row.content)
        : row.content;
    contextSet.set(parentContent, true);
  }

  return { contexts: [...contextSet.keys()], citations };
}

export { EMBEDDING_DIM };
