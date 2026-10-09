import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { buildChunks, cleanText } from "../src/lib/chunker";

/**
 * 冒烟测试（不依赖 API Key）：
 * 1. 分块器对经典文本样例的结构识别
 * 2. sqlite-vec 扩展加载与向量查询
 * 3. FTS5 trigram 中文检索
 */

const sample = `第一版序言

一个幽灵，共产主义的幽灵，在欧洲游荡。为了对这个幽灵进行神圣的围剿，旧欧洲的一切势力都联合起来了。从这一事实中可以得出两个结论：共产主义已经被公认为一种势力。

现在，一种势力被围剿，我们有必要向全世界公开说明自己的观点。

第一章 资产者和无产者

至今一切社会的历史都是阶级斗争的历史。自由民和奴隶、贵族和平民、领主和农奴、行会师傅和帮工，一句话，压迫者和被压迫者，始终处于相互对立的地位。

005
`;

function main() {
  // 1) 分块
  const cleaned = cleanText(sample);
  const chunks = buildChunks(cleaned, "共产党宣言");
  const parents = chunks.filter((c) => c.kind === "parent");
  const children = chunks.filter((c) => c.kind === "child");
  console.log(`[smoke] 分块完成: 父块=${parents.length} 子块=${children.length}`);
  const ch1 = children.find((c) => c.content.includes("阶级斗争"));
  if (!ch1 || ch1.chapter !== "第一章 资产者和无产者") {
    throw new Error("章节元数据识别失败: " + JSON.stringify(ch1 ?? null));
  }
  console.log(`[smoke] 章节元数据 OK: chapter="${ch1.chapter}" parentSeq=${ch1.parentSeq}`);

  // 2) sqlite-vec
  const db = new Database(":memory:");
  sqliteVec.load(db);
  db.exec(`CREATE VIRTUAL TABLE t USING vec0(v float[4])`);
  const rows = [
    { id: 1, v: [1, 0, 0, 0] },
    { id: 2, v: [0, 1, 0, 0] },
    { id: 3, v: [0.9, 0.1, 0, 0] },
  ];
  const ins = db.prepare(`INSERT INTO t(v) VALUES (?)`);
  rows.forEach((r, i) => ins.run(Buffer.from(new Float32Array(r.v).buffer)));
  // 显式 rowid 在此版本不支持，验证 auto-rowid + lastInsertRowid
  const assigned = db.prepare(`SELECT rowid FROM t ORDER BY rowid`).all().map((r) => (r as { rowid: number }).rowid);
  if (assigned.join(",") !== "1,2,3") throw new Error("auto rowid 异常: " + assigned.join(","));
  const q = Buffer.from(new Float32Array([1, 0, 0, 0]).buffer);
  const vecHits = db
    .prepare(`SELECT rowid AS id, distance FROM t WHERE v MATCH ? AND k = 2 ORDER BY distance`)
    .all(q) as Array<{ id: number; distance: number }>;
  console.log(`[smoke] vec 查询 OK: ${JSON.stringify(vecHits)}`);
  if (vecHits[0].id !== 1) throw new Error("向量查询结果异常");

  // 3) FTS trigram
  db.exec(`CREATE VIRTUAL TABLE f USING fts5(content, tokenize='trigram')`);
  db.prepare(`INSERT INTO f (rowid, content) VALUES (?, ?)`).run(11, "至今一切社会的历史都是阶级斗争的历史");
  db.prepare(`INSERT INTO f (rowid, content) VALUES (?, ?)`).run(12, "共产主义已经被公认为一种势力");
  const ftsHits = db
    .prepare(`SELECT rowid, bm25(f) AS rank FROM f WHERE f MATCH ? ORDER BY rank`)
    .all("阶级斗争") as Array<{ rowid: number; rank: number }>;
  console.log(`[smoke] FTS trigram 查询 OK: ${JSON.stringify(ftsHits)}`);
  if (ftsHits[0].rowid !== 11) throw new Error("FTS 查询结果异常");

  console.log("[smoke] 全部通过 ✅");
}

main();
