/**
 * OpenRouter chat completions with tool calling, on free open models. The free tier allows only
 * a small number of requests a day for the whole account, so the agent caps its turns and the app
 * caches results; without OPENROUTER_API_KEY the agent path runs a scripted driver instead.
 */
export const MODELS = (process.env.PLACES_ALONG_MODELS ?? "nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free,minimax/minimax-m3.1-flash:free")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const modelKey = () => process.env.OPENROUTER_API_KEY?.trim() || null;

export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ToolSpec { type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }
export interface ChatTurn { content: string | null; toolCalls: ToolCall[]; model: string }
export type ToolChat = (messages: ChatMessage[], tools: ToolSpec[]) => Promise<ChatTurn>;

/** House style: no em or en dashes in anything a model writes. */
export function tidy(s: string) {
  return s.replace(/\s*\u2014\s*/g, ", ").replace(/[\u2010-\u2013]/g, "-");
}

export function openRouterChat(key: string, timeoutMs = 25_000): ToolChat {
  return async (messages, tools) => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/Joe-Simo/places-along", "X-Title": "Places Along" },
      body: JSON.stringify({ model: MODELS[0], models: MODELS.slice(0, 3), temperature: 0.1, max_tokens: 1500, tools, tool_choice: "auto", messages }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenRouter ${res.status}${res.status === 429 ? " (free model limit reached)" : ""}`);
    const data = JSON.parse(text) as { model?: string; error?: { message?: string }; choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
    if (data.error) throw new Error(`OpenRouter error: ${data.error.message ?? "unknown"}`);
    const m = data.choices?.[0]?.message;
    const content = m?.content ? tidy(m.content.replace(/<think>[\s\S]*?<\/think>/g, "")) : null;
    return { content, toolCalls: m?.tool_calls ?? [], model: data.model ?? MODELS[0] };
  };
}
