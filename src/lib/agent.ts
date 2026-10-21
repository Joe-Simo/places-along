import { cumulative, formatDistance, formatDuration, haversine, project } from "./geo";
import type { ChatMessage, ToolChat, ToolSpec } from "./llm";
import type { McpSession } from "./mcp/connect";
import { planStops } from "./plan";
import type { LonLat, Pick, Place, Route, RunResult, Stop, TraceEntry, Trip } from "./types";
import { CATEGORIES, CATEGORY_ORDER, categoryOf } from "./types";

/** The five Geoapify MCP tools this job needs. Geoapify's guide advises enabling only what a workflow uses. */
export const AGENT_TOOLS = ["geocode_address", "calculate_route", "measure_geometry", "search_places", "list_place_categories"];
const MAX_TURNS = 12;
const MAX_TOOL_CALLS = 40;

type Args = Record<string, unknown>;

export interface AgentOptions {
  question: string;
  /** The parsed trip. The scripted driver follows it; the model driver gets only the question. */
  trip: Trip;
  mcp: McpSession;
  data: "live" | "sample";
  /** Null runs the scripted driver: same tools, fixed order, no model. */
  chat: ToolChat | null;
  systemPrompt: string;
  deadlineMs?: number;
}

/**
 * Everything the agent learned from tool results. The final stop list may only use places that
 * appear here, which is what makes every answer traceable to a tool call.
 */
class Notebook {
  trace: TraceEntry[] = [];
  places = new Map<string, Place>();
  route: Route | null = null;
  geometry: LonLat[] | null = null;
  calls = 0;

  constructor(private trip: Trip) {}

  record(name: string, args: Args, ok: boolean, structured: Record<string, unknown> | null, text: string, ms: number) {
    this.calls++;
    const s = structured ?? {};
    let summary = ok ? "ok" : text.slice(0, 140) || "failed";
    if (ok && name === "geocode_address") {
      const r = (s.results as { formatted?: string }[] | undefined) ?? [];
      summary = r[0]?.formatted ? `1st of ${r.length}: ${r[0].formatted}` : "no match";
    }
    if (ok && name === "calculate_route") {
      summary = `${formatDistance(Number(s.distance))}, ${formatDuration(Number(s.time) / 60)}`;
      const line = lineOf(s.geometry);
      const w = (args.waypoints as { lat: number; lon: number }[] | undefined) ?? [];
      if (line && w.length >= 2) {
        this.geometry = line;
        this.route = {
          from: { label: this.trip.from, at: [w[0].lon, w[0].lat] },
          to: { label: this.trip.to, at: [w[w.length - 1].lon, w[w.length - 1].lat] },
          distanceM: s.distance_units === "miles" ? Number(s.distance) * 1609.344 : Number(s.distance),
          durationS: Number(s.time),
          line,
        };
      }
    }
    if (ok && name === "measure_geometry") {
      const pt = pointOf(s);
      summary = pt ? `point ${pt[1].toFixed(3)}, ${pt[0].toFixed(3)}` : "no point";
    }
    if (ok && name === "search_places") {
      const results = (s.results as Record<string, unknown>[] | undefined) ?? [];
      for (const r of results) {
        const cats = (r.categories as string[] | undefined) ?? [String(args.category)];
        const category = categoryOf(cats) ?? categoryOf([String(args.category)]);
        if (!category || typeof r.lat !== "number" || typeof r.lon !== "number") continue;
        const id = String(r.place_id ?? `${r.lon},${r.lat}`);
        this.places.set(id, { id, name: String(r.name ?? CATEGORIES[category].label), address: String(r.formatted ?? ""), at: [r.lon, r.lat], category });
      }
      summary = `${results.length} \u00d7 ${args.category}`;
    }
    if (ok && name === "list_place_categories") summary = `${s.count ?? "?"} categories`;
    this.trace.push({ path: "agent", kind: "mcp", name, input: shorten(args), ok, ms, summary });
  }
}

function lineOf(g: unknown): LonLat[] | null {
  const geo = g as { type?: string; coordinates?: unknown } | undefined;
  if (geo?.type === "LineString") return geo.coordinates as LonLat[];
  if (geo?.type === "MultiLineString") return (geo.coordinates as LonLat[][]).flat();
  return null;
}

function pointOf(s: Record<string, unknown>): LonLat | null {
  const d = (s.data ?? s) as { type?: string; coordinates?: LonLat; geometry?: { coordinates?: LonLat } };
  return d.geometry?.coordinates ?? (d.type === "Point" ? d.coordinates ?? null : null);
}

function shorten(v: unknown): unknown {
  if (Array.isArray(v)) return v.length > 6 && v.every(Array.isArray) ? `[${v.length} points]` : v.map(shorten);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x)]));
  return v;
}

/** What the model sees of a tool result: the useful fields, with big geometry swapped for a reference. */
export function forModel(name: string, ok: boolean, s: Record<string, unknown> | null, text: string): string {
  if (!ok || !s) return JSON.stringify({ error: text.slice(0, 400) });
  if (name === "calculate_route") {
    const line = lineOf(s.geometry);
    return JSON.stringify({ distance: s.distance, distance_units: s.distance_units, time_seconds: s.time, geometry: line ? { ref: "route", points: line.length, note: 'Pass {"ref":"route"} as a geometry argument to use this line.' } : null });
  }
  if (name === "geocode_address") {
    const r = ((s.results as Record<string, unknown>[]) ?? []).slice(0, 2);
    return JSON.stringify({ results: r.map(({ formatted, lat, lon, result_type }) => ({ formatted, lat, lon, result_type })) });
  }
  if (name === "search_places") {
    const r = ((s.results as Record<string, unknown>[]) ?? []).slice(0, 8);
    return JSON.stringify({ category: s.category, count: s.count, results: r.map(({ place_id, name, formatted, lat, lon, distance }) => ({ place_id, name, formatted, lat, lon, distance })) });
  }
  if (name === "measure_geometry") {
    const pt = pointOf(s);
    return JSON.stringify(pt ? { lon: pt[0], lat: pt[1] } : s);
  }
  if (name === "list_place_categories") {
    const all = (s.categories as string[]) ?? [];
    const keep = all.filter((c) => /^(catering\.(cafe|restaurant|fast_food)|service\.vehicle|amenity\.toilet|leisure\.picnic)/.test(c));
    return JSON.stringify({ count: all.length, shown: keep.length, note: "Filtered by the app to categories relevant to road-trip stops.", categories: keep });
  }
  return JSON.stringify(s).slice(0, 2000);
}

/** Swap {"ref":"route"} (or "route") for the stored route geometry before a call goes to Geoapify. */
function resolveRefs(args: Args, nb: Notebook): Args {
  const out: Args = { ...args };
  for (const [k, v] of Object.entries(out)) {
    const isRef = v === "route" || v === "$route" || (typeof v === "object" && v !== null && (v as { ref?: string }).ref === "route");
    if (isRef && nb.geometry) out[k] = { type: "LineString", coordinates: nb.geometry };
  }
  return out;
}

/** Group validated picks into stops, timing each from the route the agent itself fetched. */
export function stopsFromPicks(route: Route, trip: Trip, picks: { n: number; place: Place }[]): Stop[] {
  const cum = cumulative(route.line);
  const minutesPerMeter = route.durationS / 60 / cum[cum.length - 1];
  const byN = new Map<number, Pick[]>();
  for (const { n, place } of picks) {
    const { alongM, offM } = project(route.line, cum, place.at);
    const list = byN.get(n) ?? [];
    if (!list.some((p) => p.category === place.category)) list.push({ category: place.category, place, etaMinutes: Math.round(alongM * minutesPerMeter), offRouteM: Math.round(offM) });
    byN.set(n, list);
  }
  return [...byN.keys()].sort((a, b) => a - b).map((n, i) => {
    const list = byN.get(n)!.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
    return { n: i + 1, targetMinutes: n * trip.everyMinutes, picks: list, missing: trip.categories.filter((c) => !list.some((p) => p.category === c)) };
  });
}

/** Parse the model's final answer and keep only stops that match a place a tool returned. */
export function validateAnswer(content: string, nb: Notebook | { places: Map<string, Place> }) {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let parsed: { stops?: { n?: number; category?: string; place_id?: string; name?: string; lat?: number; lon?: number }[] };
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.stops)) return null;
  const picks: { n: number; place: Place }[] = [];
  const unsupported: string[] = [];
  for (const s of parsed.stops) {
    let place = s.place_id ? nb.places.get(String(s.place_id)) : undefined;
    if (!place && s.name && typeof s.lat === "number" && typeof s.lon === "number") {
      place = [...nb.places.values()].find((p) => p.name === s.name && haversine(p.at, [s.lon!, s.lat!]) < 200);
    }
    if (!place) {
      unsupported.push(s.name ?? s.place_id ?? "unnamed stop");
      continue;
    }
    picks.push({ n: Number(s.n) || 1, place });
  }
  return { picks, unsupported };
}

async function scripted(o: AgentOptions, nb: Notebook) {
  const call = async (name: string, args: Args) => {
    const r = await o.mcp.call(name, args);
    nb.record(name, args, r.ok, r.structured, r.text, r.ms);
    return r;
  };
  const ends = await Promise.all([o.trip.from, o.trip.to].map((query) => call("geocode_address", { query, limit: 1 })));
  const pts = ends.map((e) => ((e.structured?.results as { lat: number; lon: number }[] | undefined) ?? [])[0]);
  if (!pts[0] || !pts[1]) throw new Error(`Couldn't find ${!pts[0] ? o.trip.from : o.trip.to}.${o.data === "sample" ? " Sample mode knows only Lawrence, KS and Denver, CO." : ""}`);
  await call("calculate_route", { waypoints: pts.map(({ lat, lon }) => ({ lat, lon })), mode: "drive", geometry_scope: "route", geometry_format: "geojson" });
  if (!nb.route || !nb.geometry) throw new Error("The route came back without geometry.");
  const route = nb.route;
  const kmPerMinute = route.distanceM / 1000 / (route.durationS / 60);
  const targets: number[] = [];
  for (let n = 1; n * o.trip.everyMinutes <= route.durationS / 60 - 20; n++) targets.push(n * o.trip.everyMinutes * kmPerMinute);
  const centers = await Promise.all(targets.map((km) => call("measure_geometry", { operation: "along", geometry: { type: "LineString", coordinates: nb.geometry }, distance: Math.round(km * 10) / 10, units: "kilometers" })));
  const searches: Promise<unknown>[] = [];
  for (const c of centers) {
    const pt = c.structured ? pointOf(c.structured) : null;
    if (!pt) continue;
    for (const cat of o.trip.categories) for (const key of CATEGORIES[cat].geoapify) searches.push(call("search_places", { category: key, lat: pt[1], lon: pt[0], radius_meters: 20000, limit: 20 }));
  }
  await Promise.all(searches);
}

async function modelDriven(o: AgentOptions, nb: Notebook, deadline: number) {
  const tools: ToolSpec[] = (await o.mcp.tools())
    .filter((t) => AGENT_TOOLS.includes(t.name))
    .map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema.type === "object" ? t.inputSchema : { type: "object", ...t.inputSchema } } }));
  const messages: ChatMessage[] = [{ role: "system", content: o.systemPrompt }, { role: "user", content: o.question }];
  let model = "";
  for (let turn = 0; turn < MAX_TURNS && Date.now() < deadline; turn++) {
    const asked = Date.now();
    const t = await o.chat!(messages, tools);
    model = t.model;
    nb.trace.push({ path: "agent", kind: "model", name: t.model, input: { turn: turn + 1 }, ok: true, ms: Date.now() - asked, summary: t.toolCalls.length ? `asked for ${t.toolCalls.length} tool call${t.toolCalls.length > 1 ? "s" : ""}` : "final answer" });
    if (!t.toolCalls.length) return { model, content: t.content ?? "" };
    messages.push({ role: "assistant", content: t.content, tool_calls: t.toolCalls });
    const results = await Promise.all(
      t.toolCalls.map(async (tc) => {
        if (nb.calls >= MAX_TOOL_CALLS) return { id: tc.id, content: JSON.stringify({ error: "Tool budget used up. Give your final answer now." }) };
        let args: Args = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          return { id: tc.id, content: JSON.stringify({ error: "Arguments were not valid JSON." }) };
        }
        const name = tc.function.name;
        if (!AGENT_TOOLS.includes(name)) return { id: tc.id, content: JSON.stringify({ error: `Tool ${name} is not enabled.` }) };
        const real = resolveRefs(args, nb);
        const r = await o.mcp.call(name, real);
        nb.record(name, real, r.ok, r.structured, r.text, r.ms);
        return { id: tc.id, content: forModel(name, r.ok, r.structured, r.text) };
      }),
    );
    for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
  return { model, content: null as string | null };
}

/**
 * The agent path. Every Geoapify call goes through the MCP server and lands in the trace.
 * With a model, the model chooses the calls and writes the stop list; the app then keeps only
 * stops that a search_places result backs up. Without a model, a scripted driver makes the
 * calls in a fixed order and the shared planner picks stops from what it found.
 */
export async function runAgent(o: AgentOptions): Promise<RunResult> {
  const started = Date.now();
  const deadline = started + (o.deadlineMs ?? 50_000);
  const nb = new Notebook(o.trip);
  const base = { path: "agent" as const, data: o.data, trace: nb.trace };
  try {
    if (!o.chat) {
      await scripted(o, nb);
      return { ...base, driver: "scripted", route: nb.route, stops: nb.route ? planStops(nb.route, [...nb.places.values()], o.trip) : [], ms: Date.now() - started };
    }
    let driver = "model";
    let note: string | undefined;
    let answer: { model: string; content: string | null } = { model: "", content: null };
    try {
      answer = await modelDriven(o, nb, deadline);
      driver = answer.model || driver;
    } catch (err) {
      note = `The model stopped early (${err instanceof Error ? err.message : String(err)}).`;
    }
    if (!nb.route) throw new Error(note ?? "The agent never fetched a route.");
    const checked = answer.content ? validateAnswer(answer.content, nb) : null;
    if (checked && checked.picks.length) {
      return { ...base, driver, route: nb.route, stops: stopsFromPicks(nb.route, o.trip, checked.picks), unsupported: checked.unsupported, ms: Date.now() - started, note };
    }
    const why = note ?? (answer.content ? "The model's answer named no place a tool had returned." : "The model ran out of turns before answering.");
    return { ...base, driver, route: nb.route, stops: planStops(nb.route, [...nb.places.values()], o.trip), unsupported: checked?.unsupported, ms: Date.now() - started, note: `${why} Stops below were picked by the shared planner from the places the agent's own tool calls returned.` };
  } catch (err) {
    return { ...base, driver: o.chat ? "model" : "scripted", route: nb.route, stops: [], ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

