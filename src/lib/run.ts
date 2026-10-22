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
  return { data: geoapifyKey() ? ("live" as const) : ("sample" as const), model: modelKey() ? "openrouter" : null, ...(geoapifyKey() ? { usage: usageToday() } : {}) };
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

// Guard rails for the public demo. Geoapify's free plan allows 3,000 requests a day, so the app
// counts the Geoapify requests it actually makes (every MCP tool call and every HTTP call) and
// stops live runs at a daily budget well under that, with a smaller allowance per visitor and a
// one-hour cache for repeated questions. State is per server instance and resets at UTC midnight.
const cache = new Map<string, { at: number; result: RunResult }>();
const HOUR = 3_600_000;
const usage = { day: "", requests: 0, byVisitor: new Map<string, number>() };
export const dailyRequestBudget = () => Number(process.env.PLACES_ALONG_DAILY_GEOAPIFY_REQUESTS ?? 1000);
export const visitorRunsPerDay = () => Number(process.env.PLACES_ALONG_VISITOR_RUNS_PER_DAY ?? 12);

/** Geoapify requests a finished run made: MCP tool calls plus HTTP calls, not model turns. */
export const geoapifyRequests = (r: RunResult) => r.trace.filter((t) => t.kind !== "model").length;

function rollDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== usage.day) Object.assign(usage, { day: today, requests: 0, byVisitor: new Map() });
}

export function usageToday() {
  rollDay();
  return { requests: usage.requests, budget: dailyRequestBudget() };
}

export type PlanResponse = { trip: Trip; result: RunResult } | { error: string; status: number };

export async function plan(which: "agent" | "direct", question: string, visitor = "anonymous"): Promise<PlanResponse> {
  const parsed = parseTrip(question);
  if (!parsed.ok) return { error: parsed.error, status: 400 };
  const trip = parsed.trip;
  const key = geoapifyKey();
  const cacheKey = `${which}|${key ? "live" : "sample"}|${question.trim().toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && (!key || Date.now() - hit.at < HOUR)) return { trip, result: hit.result };

  if (key) {
    rollDay();
    if (usage.requests >= dailyRequestBudget()) return { error: "Today's live demo allowance is used up. Try again tomorrow, or run it locally with your own free key.", status: 429 };
    const runs = usage.byVisitor.get(visitor) ?? 0;
    if (runs >= visitorRunsPerDay()) return { error: "You've used today's live runs for this demo. Run it locally with your own free key, or try again tomorrow.", status: 429 };
    usage.byVisitor.set(visitor, runs + 1);
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
  if (key) usage.requests += geoapifyRequests(result);
  if (!result.error) {
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { at: Date.now(), result });
  }
  return { trip, result };
}
