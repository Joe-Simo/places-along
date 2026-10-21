import type { RunResult } from "./types";

export interface Comparison {
  calls: { agent: number; direct: number };
  ms: { agent: number; direct: number };
  picks: { agent: number; direct: number; shared: number };
}

const geoCalls = (r: RunResult) => r.trace.filter((t) => t.kind !== "model").length;
const pickIds = (r: RunResult) => new Set(r.stops.flatMap((s) => s.picks.map((p) => `${p.category}:${p.place.id}`)));

/** The numbers the side-by-side view shows under the two columns. */
export function compare(agent: RunResult, direct: RunResult): Comparison {
  const a = pickIds(agent);
  const d = pickIds(direct);
  return {
    calls: { agent: geoCalls(agent), direct: geoCalls(direct) },
    ms: { agent: agent.ms, direct: direct.ms },
    picks: { agent: a.size, direct: d.size, shared: [...a].filter((x) => d.has(x)).length },
  };
}
