import Database from "better-sqlite3";
const db = new Database("data/app.db");
const stats = db.prepare(
  `SELECT kind, MIN(char_len) as min, MAX(char_len) as max, CAST(AVG(char_len) as int) as avg, COUNT(*) as cnt FROM chunks GROUP BY kind`
).all();
console.log("块大小分布:", stats);
const big = db.prepare(
  `SELECT id, char_len, substr(content,1,80) as preview FROM chunks WHERE kind='parent' ORDER BY char_len DESC LIMIT 5`
).all();
console.log("\n最大父块:");
big.forEach(r => console.log(`  id=${r.id} len=${r.char_len} | ${r.preview}...`));
