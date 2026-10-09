import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "node:fs";
import path from "node:path";

/**
 * 数据层：SQLite + sqlite-vec 向量扩展
 * - documents: 文献元信息
 * - chunks:    父子分块（kind = parent | child），携带引用溯源元数据
 * - chunk_vecs: sqlite-vec 虚拟表，仅存子块向量
 * - chunks_fts: FTS5 全文索引（BM25 混合检索用）
 */

export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM ?? 1024);

declare global {
  // eslint-disable-next-line no-var
  var __marxDb: Database.Database | undefined;
}

function createDb(): Database.Database {
  const dbPath = path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "data/app.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  sqliteVec.load(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      file_name   TEXT NOT NULL,
      format      TEXT NOT NULL,
      meta_json   TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      parent_id    INTEGER REFERENCES chunks(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL CHECK (kind IN ('parent','child')),
      book         TEXT NOT NULL,
      chapter      TEXT,
      section      TEXT,
      seq          INTEGER NOT NULL,
      content      TEXT NOT NULL,
      char_len     INTEGER NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_parent   ON chunks(parent_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content, book, chapter, tokenize='trigram'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vecs USING vec0(
      embedding float[${EMBEDDING_DIM}]
    );

    -- vec0 仅支持 auto-rowid 插入，用映射表回连 chunks.id
    CREATE TABLE IF NOT EXISTS vec_map (
      vec_rowid INTEGER PRIMARY KEY,
      chunk_id  INTEGER NOT NULL UNIQUE
    );
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!globalThis.__marxDb) {
    globalThis.__marxDb = createDb();
  }
  return globalThis.__marxDb;
}

export function toVecBlob(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}
