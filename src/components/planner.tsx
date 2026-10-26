"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { compare } from "@/lib/compare";
import { EXAMPLES } from "@/lib/examples";
import { formatDuration } from "@/lib/geo";
import { shareUrl } from "@/lib/links";
import { parseTrip } from "@/lib/parse";
import type { RunResult } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { ResultColumn } from "./result-column";
import { RouteMap } from "./route-map";

type Side = { result: RunResult | null; loading: boolean; error: string | null };
const idle: Side = { result: null, loading: false, error: null };

async function ask(path: "agent" | "direct", question: string): Promise<RunResult> {
  const res = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, question }) });
  const body = (await res.json().catch(() => ({}))) as { result?: RunResult; error?: string };
  if (!res.ok || !body.result) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body.result;
}

export function Planner({ initial, data }: { initial: string; data: "live" | "sample" }) {
  const [question, setQuestion] = useState(initial);
  const [agent, setAgent] = useState<Side>(idle);
  const [direct, setDirect] = useState<Side>(idle);
  const parsed = useMemo(() => parseTrip(question), [question]);

  const run = useCallback((q: string) => {
    // Keep the trip in the address bar, so a plan can be shared or reloaded.
    window.history.replaceState(null, "", shareUrl(window.location.origin, q));
    for (const [path, set] of [["agent", setAgent], ["direct", setDirect]] as const) {
      set((s) => ({ ...s, loading: true, error: null }));
      ask(path, q)
        .then((result) => set({ result, loading: false, error: null }))
        .catch((e: Error) => set({ result: null, loading: false, error: e.message }));
    }
  }, []);

  // Show the product working on arrival: run the starting trip once.
  useEffect(() => run(initial), [run, initial]);

  const route = direct.result?.route ?? agent.result?.route ?? null;
  const both = agent.result && direct.result && !agent.result.error && !direct.result.error ? compare(agent.result, direct.result) : null;
  const busy = agent.loading || direct.loading;

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.ok && !busy) run(question);
        }}
        className="rounded-2xl border border-line bg-card p-2 pl-4 flex flex-col sm:flex-row sm:items-center gap-2 focus-within:border-ink/40 transition-colors"
      >
        <label htmlFor="q" className="sr-only">Your trip</label>
        <textarea
          id="q"
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="flex-1 min-w-0 resize-none bg-transparent py-2 pr-2 text-base leading-6 outline-none placeholder:text-mute [field-sizing:content] max-sm:min-h-18"
          placeholder="Driving Lawrence, KS to Denver, CO. Coffee and EV charging every two hours?"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={!parsed.ok || busy} className="shrink-0 rounded-xl bg-ink text-paper px-5 py-2.5 text-sm font-medium disabled:opacity-40 cursor-pointer disabled:cursor-default">
          {busy ? "Planning" : "Plan stops"}
        </button>
      </form>

      <p className="text-sm text-mute -mt-3 px-1 min-h-5" aria-live="polite">
        {parsed.ok ? (
          <>
            {parsed.trip.from} to {parsed.trip.to}, {parsed.trip.categories.map((c) => CATEGORIES[c].noun).join(" and ")}, every {formatDuration(parsed.trip.everyMinutes)}
            {data === "sample" ? <span className="text-warn">. Sample data knows only Lawrence, KS and Denver, CO.</span> : null}
          </>
        ) : (
          <span className="text-warn">{parsed.error}</span>
        )}
      </p>

      {data === "live" ? (
        <div className="-mt-3 flex flex-wrap items-center gap-2 px-1 text-sm" role="group" aria-label="Example trips">
          <span className="text-mute">Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              disabled={busy}
              aria-pressed={question === ex.question}
              onClick={() => {
                setQuestion(ex.question);
                run(ex.question);
              }}
              className="rounded-full border border-line bg-card px-3 py-1 cursor-pointer hover:border-ink/30 aria-pressed:border-ink/50 aria-pressed:text-ink text-mute disabled:opacity-50 disabled:cursor-default transition-colors"
            >
              {ex.label}
            </button>
          ))}
        </div>
      ) : null}

      {route ? (
        <figure className="rounded-2xl border border-line bg-card px-3 pt-3 pb-2">
          <div className="hidden sm:block"><RouteMap route={route} direct={direct.result?.stops ?? []} agent={agent.result?.stops ?? []} /></div>
          <div className="sm:hidden"><RouteMap compact route={route} direct={direct.result?.stops ?? []} agent={agent.result?.stops ?? []} /></div>
          <figcaption className="flex flex-wrap gap-x-5 gap-y-1 px-2 pb-1 text-xs text-mute">
            <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full bg-direct" aria-hidden />Direct picks</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full border-2 border-agent" aria-hidden />Agent picks</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-full bg-ink" aria-hidden />Ideal stop point</span>
          </figcaption>
        </figure>
      ) : null}

      {both ? (
        <p className="text-sm text-center text-mute">
          The agent made <b className="text-ink font-medium">{both.calls.agent}</b> MCP calls; the direct path made <b className="text-ink font-medium">{both.calls.direct}</b> HTTP calls.{" "}
          {both.picks.shared} of {Math.max(both.picks.agent, both.picks.direct)} picks are the same place.
          {both.picks.agent < both.picks.direct ? " The MCP place search looks in a circle around each stop point, while the REST polyline filter covers the whole stretch of road, so the direct path can reach stops the agent cannot." : ""}
        </p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <ResultColumn which="agent" {...agent} />
        <ResultColumn which="direct" {...direct} />
      </div>
    </div>
  );
}
