/**
 * 静态导出脚本：把 app.db 导出为 GitHub Pages 可用的静态数据
 * 输出：
 *   src/data-static/documents.json  文献库列表（library 页构建时导入）
 *   src/data-static/chunks.json     子块引用 + 父块上下文（chat 页动态导入）
 *   public/data/embeddings.bin      int8 逐向量 min-max 量化的子块向量（懒加载）
 * 运行：node scripts/export-static.js
 */
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");

const ROOT = path.resolve(__dirname, "..");
const db = new Database(path.join(ROOT, "data/app.db"), { readonly: true });
sqliteVec.load(db);

// 1) 文献列表
const documents = db
  .prepare(
    `SELECT d.id, d.title, d.file_name, d.format, d.created_at,
            (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id AND c.kind = 'child') AS child_count
     FROM documents d ORDER BY d.id`
  )
  .all();

// 2) 子块（含引用元数据）+ 父块内容
const children = db
  .prepare(
    `SELECT c.id AS childId, c.parent_id AS parentId, d.title, c.chapter, c.section, c.content AS quote
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.kind = 'child' ORDER BY c.id`
  )
  .all();

const parents = {};
for (const row of db.prepare(`SELECT id, content FROM chunks WHERE kind = 'parent'`).all()) {
  parents[row.id] = row.content;
}

// 3) 向量（按子块顺序对齐，int8 min-max 量化）
const vecRows = db
  .prepare(
    `SELECT m.chunk_id AS chunkId, v.embedding AS blob
     FROM chunk_vecs v JOIN vec_map m ON m.vec_rowid = v.rowid`
  )
  .all();
const vecByChunk = new Map(vecRows.map((r) => [r.chunkId, new Float32Array(r.blob.buffer, r.blob.byteOffset, r.blob.length / 4)]));
const DIM = 1024;
const withVec = children.filter((c) => vecByChunk.has(c.childId));
const skipped = children.length - withVec.length;

const quant = new Int8Array(withVec.length * DIM);
const scales = new Float32Array(withVec.length * 2); // min, range per vector
withVec.forEach((c, i) => {
  const v = vecByChunk.get(c.childId);
  let min = Infinity, max = -Infinity;
  for (let d = 0; d < DIM; d++) { if (v[d] < min) min = v[d]; if (v[d] > max) max = v[d]; }
  const range = max - min || 1e-9;
  scales[i * 2] = min; scales[i * 2 + 1] = range;
  for (let d = 0; d < DIM; d++) quant[i * DIM + d] = Math.round(((v[d] - min) / range) * 254 - 127);
});

// 写文件
fs.mkdirSync(path.join(ROOT, "src/data-static"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "public/data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "src/data-static/documents.json"), JSON.stringify(documents));
fs.writeFileSync(
  path.join(ROOT, "src/data-static/chunks.json"),
  JSON.stringify({ dim: DIM, children: withVec, parents })
);
// embeddings.bin: [meta JSON length:uint32][meta JSON][scales f32][quant i8]
const meta = Buffer.from(JSON.stringify({ count: withVec.length, dim: DIM }), "utf8");
const bin = Buffer.concat([
  Buffer.from(new Uint32Array([meta.length]).buffer),
  meta,
  Buffer.from(scales.buffer),
  Buffer.from(quant.buffer),
]);
fs.writeFileSync(path.join(ROOT, "public/data/embeddings.bin"), bin);

console.log(`documents: ${documents.length}`);
console.log(`children with vec: ${withVec.length} (skipped ${skipped})`);
console.log(`parents: ${Object.keys(parents).length}`);
console.log(`chunks.json: ${(fs.statSync(path.join(ROOT, "src/data-static/chunks.json")).size / 1048576).toFixed(1)} MB`);
console.log(`embeddings.bin: ${(bin.length / 1048576).toFixed(1)} MB`);
