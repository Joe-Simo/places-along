"use client";

import { useState } from "react";
import { formatDistance, formatDuration } from "@/lib/geo";
import type { RunResult, TraceEntry } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

const TITLES = {
  agent: { title: "Agent", via: "Geoapify MCP server", color: "text-agent", dot: "border-2 border-agent" },
  direct: { title: "Direct", via: "typed OpenAPI client", color: "text-direct", dot: "bg-direct" },
};

export function ResultColumn({ which, result, loading, error }: { which: "agent" | "direct"; result: RunResult | null; loading: boolean; error: string | null }) {
  const t = TITLES[which];
  const calls = result?.trace.filter((e) => e.kind !== "model").length ?? 0;
  return (
    <section className="rounded-2xl border border-line bg-card p-5 sm:p-6 min-w-0" aria-busy={loading}>
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className={`inline-block size-2.5 rounded-full ${t.dot}`} aria-hidden />
          {t.title}
          <span className="font-normal text-mute text-sm">through the {t.via}</span>
        </h2>
      </header>
      <p className="mt-1 text-sm text-mute min-h-5">
        {loading ? "Working..." : result ? `${calls} ${which === "agent" ? "MCP tool" : "HTTP"} call${calls === 1 ? "" : "s"} in ${result.ms < 1000 ? `${result.ms} ms` : `${(result.ms / 1000).toFixed(1)} s`}${result.driver ? `, driven by ${result.driver === "scripted" ? "a scripted plan (no model key)" : result.driver}` : ""}` : ""}
      </p>

      {error || result?.error ? <p className="mt-4 rounded-lg bg-warn-bg text-warn px-3 py-2 text-sm">{error ?? result?.error}</p> : null}
      {result?.note ? <p className="mt-4 rounded-lg bg-warn-bg text-warn px-3 py-2 text-sm">{result.note}</p> : null}

      {loading && !result ? <Skeleton /> : null}

      {result && !result.error ? (
        result.stops.length ? (
          <ol className="mt-4 space-y-4">
            {result.stops.map((s) => (
              <li key={s.n}>
                <p className="text-xs uppercase tracking-wide text-mute">Stop {s.n} <span className="normal-case tracking-normal">around {formatDuration(s.targetMinutes)}</span></p>
                <ul className="mt-1.5 space-y-1.5">
                  {s.picks.map((p) => (
                    <li key={p.place.id} className="text-sm leading-snug">
                      <span className="text-mute">{CATEGORIES[p.category].label}: </span>
                      <span className="font-medium">{p.place.name}</span>
                      <span className="text-mute">, {shortAddress(p.place.name, p.place.address)}</span>
                      <span className="block text-xs text-mute">at {formatDuration(p.etaMinutes)}, {p.offRouteM < 160 ? "on the route" : `${formatDistance(p.offRouteM)} off the route`}</span>
                    </li>
                  ))}
                  {s.missing.map((c) => (
                    <li key={c} className="text-sm text-mute">No {CATEGORIES[c].noun} found close to the road here.</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-mute">No stops: the drive is shorter than the interval you asked for.</p>
        )
      ) : null}

      {result?.unsupported?.length ? (
        <p className="mt-4 text-xs text-mute">Dropped {result.unsupported.length} stop{result.unsupported.length > 1 ? "s" : ""} the model named that no tool result backs up: {result.unsupported.join(", ")}.</p>
      ) : null}

      {result?.trace.length ? <Trace entries={result.trace} /> : null}
    </section>
  );
}

/** "Starbucks, 1045 1st Street, Bennett, Colorado, 80102" becomes "1045 1st Street, Bennett". */
function shortAddress(name: string, address: string) {
  const parts = address.split(", ");
  const rest = parts[0] === name ? parts.slice(1) : parts;
  return rest.slice(0, 2).join(", ") || "address not listed";
}

function Skeleton() {
  return (
    <div className="mt-4 space-y-3 animate-pulse motion-reduce:animate-none" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 w-24 rounded bg-line" />
          <div className="h-4 w-4/5 rounded bg-line/70" />
        </div>
      ))}
    </div>
  );
}

function Trace({ entries }: { entries: TraceEntry[] }) {
  const [open, setOpen] = useState(false);
  const calls = entries.filter((e) => e.kind !== "model").length;
  return (
    <div className="mt-6 border-t border-line pt-4">
      <button type="button" onClick={() => setOpen(!open)} className="text-sm font-medium flex items-center gap-1.5 cursor-pointer" aria-expanded={open}>
        <span className={`inline-block transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} aria-hidden>&#8250;</span>
        Trace: every call, in order ({calls} Geoapify call{calls === 1 ? "" : "s"}{entries.length > calls ? `, ${entries.length - calls} model turns` : ""})
      </button>
      {open ? (
        <ol className="mt-3 space-y-1.5 font-mono text-xs">
          {entries.map((e, i) => (
            <li key={i}>
              <details className="group">
                <summary className="cursor-pointer list-none flex gap-2 items-baseline">
                  <span className="text-mute w-5 shrink-0 text-right">{i + 1}</span>
                  <span className={e.kind === "model" ? "text-mute" : e.ok ? "text-ink" : "text-warn"}>{e.name}</span>
                  <span className="text-mute truncate">{e.summary}</span>
                  <span className="text-mute ml-auto shrink-0">{e.ms} ms</span>
                </summary>
                <pre className="mt-1 ml-7 whitespace-pre-wrap break-all rounded-md bg-paper p-2 text-[11px] leading-relaxed">{JSON.stringify(e.input, null, 1)}</pre>
              </details>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
