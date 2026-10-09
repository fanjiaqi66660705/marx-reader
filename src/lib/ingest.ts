import fs from "node:fs";
import path from "node:path";
import { getDb, toVecBlob } from "./db";
import { buildChunks } from "./chunker";
import { embedTexts } from "./embeddings";

/**
 * 文献入库管线：解析 → 清洗 → 父子分块 → 向量化 → 入库
 * 子块进向量库与 FTS，父块只入库（命中子块后回取作为生成上下文）
 */

export interface IngestResult {
  documentId: number;
  title: string;
  parentCount: number;
  childCount: number;
}

async function readText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(filePath)) });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  return fs.readFileSync(filePath, "utf-8");
}

export async function ingestFile(
  filePath: string,
  opts: { title?: string } = {}
): Promise<IngestResult> {
  const db = getDb();
  const fileName = path.basename(filePath);
  const format = path.extname(filePath).replace(".", "").toLowerCase() || "txt";
  const title = opts.title ?? fileName.replace(/\.[^.]+$/, "");

  const raw = await readText(filePath);
  const chunks = buildChunks(raw, title);
  const parents = chunks.filter((c) => c.kind === "parent");
  const children = chunks.filter((c) => c.kind === "child");

  if (children.length === 0) {
    throw new Error("未解析出有效内容");
  }

  const insertDoc = db.prepare(
    `INSERT INTO documents (title, file_name, format) VALUES (?, ?, ?)`
  );
  const insertChunk = db.prepare(
    `INSERT INTO chunks (document_id, parent_id, kind, book, chapter, section, seq, content, char_len)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertVec = db.prepare(
    `INSERT INTO chunk_vecs (embedding) VALUES (?)`
  );
  const insertVecMap = db.prepare(
    `INSERT INTO vec_map (vec_rowid, chunk_id) VALUES (?, ?)`
  );
  const insertFts = db.prepare(
    `INSERT INTO chunks_fts (rowid, content, book, chapter) VALUES (?, ?, ?, ?)`
  );

  const docInfo = insertDoc.run(title, fileName, format);
  const documentId = Number(docInfo.lastInsertRowid);

  // 插父块并建立 seq -> id 映射
  const parentIds = new Map<number, number>();
  for (const p of parents) {
    const info = insertChunk.run(
      documentId, null, "parent", p.book, p.chapter, p.section, p.seq, p.content, p.charLen
    );
    parentIds.set(p.seq, Number(info.lastInsertRowid));
  }

  // 向量化（子块）
  const vectors = await embedTexts(children.map((c) => c.content));

  // 插子块 + 向量 + FTS
  children.forEach((c, i) => {
    const parentId = c.parentSeq !== null ? parentIds.get(c.parentSeq) ?? null : null;
    const info = insertChunk.run(
      documentId, parentId, "child", c.book, c.chapter, c.section, c.seq, c.content, c.charLen
    );
    const childId = Number(info.lastInsertRowid);
    const vecRowId = Number(insertVec.run(toVecBlob(vectors[i])).lastInsertRowid);
    insertVecMap.run(vecRowId, childId);
    insertFts.run(childId, c.content, c.book, c.chapter ?? "");
  });

  return { documentId, title, parentCount: parents.length, childCount: children.length };
}

/** 已入库文献列表 */
export function listDocuments() {
  return getDb()
    .prepare(
      `SELECT d.id, d.title, d.file_name, d.format, d.created_at,
              COUNT(c.id) FILTER (WHERE c.kind='child') AS child_count
       FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
       GROUP BY d.id ORDER BY d.id DESC`
    )
    .all();
}
