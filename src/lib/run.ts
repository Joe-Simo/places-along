import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAgent } from "./agent";
import { runDirect } from "./direct";
import { modelKey, openRouterChat } from "./llm";
import { connectGeoapifyMcp } from "./mcp/connect";
import { parseTrip } from "./parse";
import type { RunResult, Trip } from "./types";
import { CATEGORIES, CATEGORY_ORDER } from "./types";

/** The Geoapify key is read from the environment only, never from a file in the repo. */
export const geoapifyKey = () => process.env.GEOAPIFY_API_KEY?.trim() || null;

export function status() {
  return { data: geoapifyKey() ? ("live" as const) : ("sample" as const), model: modelKey() ? "openrouter" : null };
}

let prompt: string | null = null;
export function systemPrompt() {
  if (!prompt) {
    const raw = readFileSync(path.join(process.cwd(), "prompts/agent-system.md"), "utf8");
    const table = CATEGORY_ORDER.map((c) => `- ${c} (${CATEGORIES[c].label}): ${CATEGORIES[c].geoapify.join(", ")}`).join("\n");
    prompt = raw.replace("{{categories}}", table);
  }
  return prompt;
}

// Small in-memory cache and a daily cap on live runs, so a public demo cannot drain the free
// Geoapify and OpenRouter allowances. Both reset when the server instance restarts.
const cache = new Map<string, { at: number; result: RunResult }>();
const HOUR = 3_600_000;
let day = "";
let liveRuns = 0;
const dailyCap = () => Number(process.env.PLACES_ALONG_DAILY_LIVE_RUNS ?? 60);

export type PlanResponse = { trip: Trip; result: RunResult } | { error: string; status: number };

export async function plan(which: "agent" | "direct", question: string): Promise<PlanResponse> {
  const parsed = parseTrip(question);
  if (!parsed.ok) return { error: parsed.error, status: 400 };
  const trip = parsed.trip;
  const key = geoapifyKey();
  const cacheKey = `${which}|${key ? "live" : "sample"}|${question.trim().toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && (!key || Date.now() - hit.at < HOUR)) return { trip, result: hit.result };

  if (key) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) [day, liveRuns] = [today, 0];
    if (++liveRuns > dailyCap()) return { error: "Today's live demo allowance is used up. Try the sample trip, or run it locally with your own key.", status: 429 };
  }

  let result: RunResult;
  if (which === "direct") {
    result = await runDirect(trip, { apiKey: key });
  } else {
    const mcp = await connectGeoapifyMcp(key);
    try {
      const mk = modelKey();
      result = await runAgent({ question, trip, mcp, data: key ? "live" : "sample", chat: mk ? openRouterChat(mk) : null, systemPrompt: systemPrompt() });
    } finally {
      await mcp.close().catch(() => {});
    }
  }
  if (!result.error) {
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { at: Date.now(), result });
  }
  return { trip, result };
}
