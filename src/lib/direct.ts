import { formatDistance, formatDuration } from "./geo";
import { createGeoapify, type HttpCall, type PlaceFeature } from "./geoapify/client";
import { planStops, stopWindows } from "./plan";
import { sampleRestFetch } from "./sample";
import type { LonLat, Place, Route, RunResult, TraceEntry, Trip } from "./types";
import { CATEGORIES, categoryOf } from "./types";

/** One readable line per HTTP call, from its response. */
export function summarizeHttp(c: HttpCall): string {
  const o = c.output as { results?: unknown[]; features?: { properties?: { distance?: number; time?: number } }[]; message?: string } | undefined;
  if (c.status >= 400) return `HTTP ${c.status}${o?.message ? `: ${o.message}` : ""}`;
  if (c.path.endsWith("/geocode/search")) return `${o?.results?.length ?? 0} match${o?.results?.length === 1 ? "" : "es"}`;
  if (c.path.endsWith("/routing")) {
    const p = o?.features?.[0]?.properties;
    return p?.distance !== undefined && p.time !== undefined ? `${formatDistance(p.distance)}, ${formatDuration(p.time / 60)}` : "no route";
  }
  if (c.path.endsWith("/places")) return `${o?.features?.length ?? 0} places`;
  return `HTTP ${c.status}`;
}

export function placeFromFeature(f: Pick<PlaceFeature, "properties">): Place | null {
  const p = f.properties as { name?: string; formatted?: string; address_line2?: string; lat?: number; lon?: number; categories?: string[]; place_id?: string };
  const category = categoryOf(p.categories ?? []);
  if (!category || p.lat === undefined || p.lon === undefined) return null;
  return { id: p.place_id ?? `${p.lon},${p.lat}`, name: p.name ?? CATEGORIES[category].label, address: p.formatted ?? p.address_line2 ?? "", at: [p.lon, p.lat], category };
}

/**
 * The direct path: the app decides every call itself and makes it through the client generated
 * from Geoapify's OpenAPI specs. Geocode both ends, route once, then one Places request per stop
 * window that asks for every requested category along that stretch of road.
 */
export async function runDirect(trip: Trip, opts: { apiKey: string | null; fetch?: typeof fetch }): Promise<RunResult> {
  const started = Date.now();
  const trace: TraceEntry[] = [];
  const geo = createGeoapify({
    apiKey: opts.apiKey ?? "sample",
    // No key means sample mode: the same client, answered by the bundled sample data.
    fetch: opts.fetch ?? (opts.apiKey ? undefined : sampleRestFetch),
    onCall: (c) => trace.push({ path: "direct", kind: "http", name: `${c.method} ${c.path}`, input: c.input, ok: c.status < 400, ms: c.ms, summary: summarizeHttp(c) }),
  });
  const base: Omit<RunResult, "route" | "stops" | "ms"> = { path: "direct", data: opts.apiKey ? "live" : "sample", trace };

  try {
    const [from, to] = await Promise.all([geo.geocode(trip.from), geo.geocode(trip.to)]);
    if (!from || !to) throw new Error(`Couldn't find ${!from ? trip.from : trip.to}.${opts.apiKey ? "" : " Sample mode knows only Lawrence, KS and Denver, CO."}`);

    const r = await geo.route(from.at, to.at);
    const route: Route = { from: { label: trip.from, at: from.at }, to: { label: trip.to, at: to.at }, ...r };

    const keys = trip.categories.flatMap((c) => CATEGORIES[c].geoapify);
    const windows = stopWindows(route, trip);
    const found = await Promise.all(windows.map((w) => geo.placesAlong(w.line as LonLat[], keys)));

    const seen = new Set<string>();
    const places = found.flat().map(placeFromFeature).filter((p): p is Place => !!p && !seen.has(p.id) && !!seen.add(p.id));
    return { ...base, route, stops: planStops(route, places, trip), ms: Date.now() - started };
  } catch (err) {
    return { ...base, route: null, stops: [], ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}
