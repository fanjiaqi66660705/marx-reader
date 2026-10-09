import { retrieve } from "../src/lib/retrieval";
import { streamChat, type ChatMessage } from "../src/lib/llm";

/**
 * 端到端 RAG 联调：检索 → 引用 → 流式对话
 * 用法：node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/e2e-test.ts
 */

const SYSTEM_PROMPT = `你是马克思主义经典文献研读平台的 AI 助手，面向高校学生与理论学习者。

【必须遵守的规则】
1. 只依据下方提供的「原文片段」回答问题。不得使用片段之外的任何知识编造引文。
2. 回答中凡涉及原文的论断，必须在句末标注引文编号，如 [1]、[2]，编号对应提供的片段序号。
3. 如果提供的片段不足以回答问题，直接说明「所提供的文献片段不足以完整回答该问题」，并指出片段中与问题相关的线索。绝不允许编造引文或出处。
4. 风格：严谨、清晰、面向研读讨论。可分点论述，但避免空洞套话。
5. 解释概念时，先给出原文依据，再做通俗阐释，最后可提出一个供讨论的延伸问题。`;

async function main() {
  const question = "什么是剩余价值？它与资本主义的剥削关系是什么？";
  console.log(`\n${"=".repeat(60)}`);
  console.log(`问题: ${question}`);
  console.log("=".repeat(60));

  // 1) 检索
  console.log("\n[1] 检索中...");
  const { contexts, citations } = await retrieve(question);
  console.log(`    命中 ${citations.length} 条引用，${contexts.length} 个上下文块`);

  if (citations.length === 0) {
    console.error("    未检索到任何内容，终止");
    process.exit(1);
  }

  // 打印引用摘要
  citations.forEach((c, i) => {
    console.log(
      `    [${i + 1}] ${c.title} · ${c.chapter ?? "?"} / ${c.section ?? "?"} · score=${c.score.toFixed(4)}`
    );
    console.log(`        引文: ${c.quote.slice(0, 80)}...`);
  });

  // 2) 组装 prompt 并调用 LLM
  console.log("\n[2] 调用 LLM 流式生成...");
  const contextBlock = contexts
    .map((text, i) => `[${i + 1}] ${text.slice(0, 3000)}`)
    .join("\n\n---\n\n")
    .slice(0, 12000);

  const messages: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n【原文片段】\n${contextBlock}` },
    { role: "user", content: question },
  ];

  let fullResponse = "";
  let tokenCount = 0;
  for await (const delta of streamChat(messages)) {
    process.stdout.write(delta);
    fullResponse += delta;
    tokenCount++;
  }

  console.log(`\n\n[3] 生成完毕（${tokenCount} 个 delta）`);
  console.log(`    回答长度: ${fullResponse.length} 字`);
  console.log(`    引文标注: ${(fullResponse.match(/\[\d+\]/g) ?? []).join(" ")}`);

  console.log("\n" + "=".repeat(60));
  console.log("端到端 RAG 联调通过 ✅");
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("联调失败:", e);
  process.exit(1);
});
