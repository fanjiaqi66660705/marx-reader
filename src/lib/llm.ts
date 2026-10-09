/**
 * LLM 客户端：OpenAI 兼容 /chat/completions 流式调用（直接 fetch，SSE 解析）
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function getLLMConfig() {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("缺少 LLM_API_KEY，请在 .env 中配置");
  return {
    apiKey,
    baseUrl: (process.env.LLM_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL ?? "deepseek-chat",
  };
}

/** 逐 token 产出文本增量 */
export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const { apiKey, baseUrl, model } = getLLMConfig();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.3, // 学术场景低温度，减少发挥
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败（${res.status}）：${detail.slice(0, 200)}`);
  }

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
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // 忽略无法解析的行
      }
    }
  }
}
