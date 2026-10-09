import { NextRequest } from "next/server";
import { retrieve } from "@/lib/retrieval";
import { streamChat, type ChatMessage } from "@/lib/llm";

export const maxDuration = 120;

const SYSTEM_PROMPT = `你是马克思主义经典文献研读平台的 AI 助手，面向高校学生与理论学习者。

【必须遵守的规则】
1. 只依据下方提供的「原文片段」回答问题。不得使用片段之外的任何知识编造引文。
2. 回答中凡涉及原文的论断，必须在句末标注引文编号，如 [1]、[2]，编号对应提供的片段序号。
3. 如果提供的片段不足以回答问题，直接说明「所提供的文献片段不足以完整回答该问题」，并指出片段中与问题相关的线索。绝不允许编造引文或出处。
4. 风格：严谨、清晰、面向研读讨论。可分点论述，但避免空洞套话。
5. 解释概念时，先给出原文依据，再做通俗阐释，最后可提出一个供讨论的延伸问题。`;

interface ChatBody {
  message?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatBody;
  const question = (body.message ?? "").trim();
  if (!question) {
    return Response.json({ error: "消息不能为空" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 1) 检索原文片段
        const { contexts, citations } = await retrieve(question);

        if (contexts.length === 0) {
          controller.enqueue(
            ndjson({
              type: "error",
              message:
                "文献库中未检索到相关原文。请先在文献库中入库经典文献（npm run ingest），或换一个与文献内容相关的问题。",
            })
          );
          controller.close();
          return;
        }

        // 2) 组装提示词（截断超长父块，防止超出 LLM 上下文窗口）
        const MAX_PER_CTX = 3000;
        const MAX_TOTAL = 12000;
        const contextBlock = contexts
          .map((text, i) => `[${i + 1}] ${text.slice(0, MAX_PER_CTX)}`)
          .join("\n\n---\n\n")
          .slice(0, MAX_TOTAL);

        const historyMessages: ChatMessage[] = (body.history ?? [])
          .filter((m) => m.content.trim() && m.content !== question)
          .slice(-6)
          .map((m) => ({ role: m.role, content: m.content }));

        const messages: ChatMessage[] = [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n【原文片段】\n${contextBlock}` },
          ...historyMessages,
          { role: "user", content: question },
        ];

        // 3) 流式输出
        for await (const delta of streamChat(messages, req.signal)) {
          controller.enqueue(ndjson({ type: "delta", text: delta }));
        }
        controller.enqueue(ndjson({ type: "citations", citations }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "服务异常";
        controller.enqueue(ndjson({ type: "error", message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
