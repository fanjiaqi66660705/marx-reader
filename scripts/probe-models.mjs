/**
 * 模型探针：实测方舟两个模型的真实可用端点与向量维度
 * 用法：node scripts/probe-models.mjs
 * 读取 .env 中的 KEY 与模型 ID（也可直接硬编码传入）
 */
import { readFileSync } from "node:fs";

// 简易解析 .env
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const KEY = env.EMBEDDING_API_KEY;
const EMB_MODEL = process.argv[2] ?? "doubao-embedding-vision-251215";
const LLM_MODEL = process.argv[3] ?? "doubao-seed-2-1-lite-260915";
const BASE = "https://ark.cn-beijing.volces.com/api/v3";

async function probe(name, url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let dim = null;
    let preview = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      const emb = j?.data?.embedding ?? j?.data?.[0]?.embedding ?? j?.embedding;
      if (Array.isArray(emb)) {
        dim = emb.length;
        preview = JSON.stringify({ ...j, data: { embedding: `[${dim}维]` } }).slice(0, 300);
      }
    } catch { /* 非 JSON */ }
    console.log(`\n=== ${name} ===`);
    console.log(`HTTP ${res.status}${dim ? ` · 维度=${dim}` : ""}`);
    console.log(preview);
    return { status: res.status, dim };
  } catch (e) {
    console.log(`\n=== ${name} ===`);
    console.log("网络错误:", e.message);
    return { status: 0, dim: null };
  }
}

// 1. 标准 OpenAI 兼容 embeddings 端点
const r1 = await probe(
  `标准端点 /embeddings · ${EMB_MODEL}`,
  `${BASE}/embeddings`,
  { model: EMB_MODEL, input: ["剩余价值是资本主义生产的秘密。"] }
);

// 2. 多模态 embeddings 端点（vision 模型的原生端点）
const r2 = await probe(
  `多模态端点 /embeddings/multimodal · ${EMB_MODEL}`,
  `${BASE}/embeddings/multimodal`,
  { model: EMB_MODEL, input: [{ type: "text", text: "剩余价值是资本主义生产的秘密。" }] }
);

// 3. 对话模型
const r3 = await probe(
  `对话 /chat/completions · ${LLM_MODEL}`,
  `${BASE}/chat/completions`,
  {
    model: LLM_MODEL,
    messages: [{ role: "user", content: "用一句话说明什么是剩余价值。" }],
    max_tokens: 100,
  }
);

console.log("\n===== 结论 =====");
console.log(`标准端点: ${r1.status === 200 ? "可用" : `不可用(HTTP ${r1.status})`}`);
console.log(`多模态端点: ${r2.status === 200 ? `可用 · 维度=${r2.dim}` : `不可用(HTTP ${r2.status})`}`);
console.log(`对话模型: ${r3.status === 200 ? "可用" : `不可用(HTTP ${r3.status})`}`);
