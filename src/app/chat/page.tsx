"use client";

import { useRef, useState } from "react";
import {
  retrieve,
  streamChat,
  type Citation,
  type ChatMessage as ApiMessage,
} from "@/lib/client-rag";

const SYSTEM_PROMPT = `你是马克思主义经典文献研读平台的 AI 助手，面向高校学生与理论学习者。

【必须遵守的规则】
1. 只依据下方提供的「原文片段」回答问题。不得使用片段之外的任何知识编造引文。
2. 回答中凡涉及原文的论断，必须在句末标注引文编号，如 [1]、[2]，编号对应提供的片段序号。
3. 如果提供的片段不足以回答问题，直接说明「所提供的文献片段不足以完整回答该问题」，并指出片段中与问题相关的线索。绝不允许编造引文或出处。
4. 风格：严谨、清晰、面向研读讨论。可分点论述，但避免空洞套话。
5. 解释概念时，先给出原文依据，再做通俗阐释，最后可提出一个供讨论的延伸问题。`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

const suggestedQuestions = [
  "什么是商品的二重性？",
  "剩余价值是如何被生产出来的？",
  "《共产党宣言》如何描述资产阶级的历史作用？",
  "异化劳动理论的核心内容是什么？",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    setInput("");
    const history = [...messages, { role: "user" as const, content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setLoading(true);

    const patchLast = (patch: Partial<ChatMessage>) =>
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, ...patch };
        return next;
      });

    try {
      // 1) 浏览器端检索原文片段（首次会懒加载约 8MB 静态数据）
      const { contexts, citations } = await retrieve(question);
      if (contexts.length === 0) {
        patchLast({ content: "⚠️ 文献库中未检索到相关原文，请换一个与文献内容相关的问题。" });
        return;
      }

      // 2) 组装提示词（截断超长父块，防止超出 LLM 上下文窗口）
      const MAX_PER_CTX = 3000;
      const MAX_TOTAL = 12000;
      const contextBlock = contexts
        .map((text, i) => `[${i + 1}] ${text.slice(0, MAX_PER_CTX)}`)
        .join("\n\n---\n\n")
        .slice(0, MAX_TOTAL);

      const historyMessages: ApiMessage[] = history
        .filter((m) => m.content.trim() && m.content !== question)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const apiMessages: ApiMessage[] = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n【原文片段】\n${contextBlock}` },
        ...historyMessages,
        { role: "user", content: question },
      ];

      // 3) 流式输出
      for await (const delta of streamChat(apiMessages)) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + delta };
          return next;
        });
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      }
      patchLast({ citations });
    } catch (err) {
      patchLast({
        content: `⚠️ ${err instanceof Error ? err.message : "网络错误"}`,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-9.5rem)] flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">经典著作 AI 对话助手</h1>
        <span className="text-xs text-stone-500">回答均附带原文引用，请核对后引用</span>
      </div>

      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="text-sm text-stone-500">试着提出一个理论问题，例如：</p>
            <div className="flex max-w-lg flex-wrap justify-center gap-2">
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border border-stone-300 px-3 py-1.5 text-sm text-stone-700 transition hover:border-red-800 hover:text-red-900"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-red-900 text-stone-50"
                  : "bg-stone-100 text-stone-900"
              }`}
            >
              <div className="whitespace-pre-wrap">{m.content || "……"}</div>
              {m.citations && m.citations.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-stone-300 pt-2">
                  <p className="text-xs font-semibold text-stone-500">原文引用</p>
                  {m.citations.map((c) => (
                    <details key={c.childId} className="rounded-lg bg-white p-2 text-xs">
                      <summary className="cursor-pointer font-medium text-stone-700">
                        《{c.title}》{c.chapter ? ` · ${c.chapter}` : ""}
                        {c.section ? ` · ${c.section}` : ""}
                      </summary>
                      <p className="mt-1.5 whitespace-pre-wrap text-stone-600">{c.quote}</p>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的理论疑问……"
          className="flex-1 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-red-800"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-xl bg-red-900 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-red-800 disabled:opacity-40"
        >
          {loading ? "检索中…" : "发送"}
        </button>
      </form>
    </div>
  );
}
