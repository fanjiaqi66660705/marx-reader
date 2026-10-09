/**
 * 列出 key 可访问的模型 + 对比测试文本版 embedding 报错类型
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const KEY = env.EMBEDDING_API_KEY;
const BASE = "https://ark.cn-beijing.volces.com/api/v3";

// 1. 列出模型
const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
const text = await res.text();
console.log(`=== GET /models · HTTP ${res.status} ===`);
try {
  const j = JSON.parse(text);
  const ids = (j.data ?? []).map((m) => m.id);
  console.log(`共 ${ids.length} 个模型:`);
  ids.forEach((id) => console.log("  -", id));
} catch {
  console.log(text.slice(0, 800));
}

// 2. 对比：文本版 embedding 模型（未开通时预期 ModelNotOpen 404）
async function tryEmb(model, url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log(`\n=== ${model} @ ${url.split("/api/v3")[1]} · HTTP ${r.status} ===`);
  console.log(t.slice(0, 250));
}

await tryEmb("doubao-embedding-large-text-250515", `${BASE}/embeddings`, {
  model: "doubao-embedding-large-text-250515",
  input: ["测试"],
});
await tryEmb("doubao-embedding-vision-251215", `${BASE}/embeddings`, {
  model: "doubao-embedding-vision-251215",
  input: ["测试"],
});
