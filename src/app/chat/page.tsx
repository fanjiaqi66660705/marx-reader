"use client";

import { useRef, useState } from "react";

interface Citation {
  childId: number;
  title: string;
  chapter: string | null;
  section: string | null;
  quote: string;
}

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

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history: history.slice(-8) }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`请求失败（${res.status}）`);
      }
      // NDJSON 流：每行 {type:'delta'|'citations'|'error'}
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            text?: string;
            message?: string;
            citations?: Citation[];
          };
          if (event.type === "delta" && event.text) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + event.text };
              return next;
            });
            listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
          } else if (event.type === "citations" && event.citations) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, citations: event.citations };
              return next;
            });
          } else if (event.type === "error") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = {
                ...last,
                content: last.content || `⚠️ ${event.message ?? "服务异常"}`,
              };
              return next;
            });
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = {
          ...last,
          content: last.content || `⚠️ ${err instanceof Error ? err.message : "网络错误"}`,
        };
        return next;
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
