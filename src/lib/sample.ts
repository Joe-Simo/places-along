import sampleJson from "../../fixtures/sample-lawrence-denver.json";
import { cumulative, haversine, project } from "./geo";
import type { LonLat } from "./types";

/**
 * Sample mode: what the app shows when no GEOAPIFY_API_KEY is set. One real drive (Lawrence, KS
 * to Denver, CO) with real places, but NOT Geoapify responses: the route comes from the public
 * OSRM demo server and the places from OpenStreetMap (see scripts/build-sample.mjs). The fake
 * fetches below answer in Geoapify's documented response shapes, so the app's real request code
 * (the generated REST client and the official MCP client) runs unchanged against them.
 */
export interface SampleEndpoint { label: string; formatted: string; city: string; state: string; country_code: string; at: LonLat }
export interface SamplePlace { id: string; name: string; formatted: string; city: string; state: string | null; at: LonLat; categories: string[] }
export interface SampleWorld {
  note: string;
  builtAt: string;
  endpoints: Record<string, SampleEndpoint>;
  route: { distanceM: number; durationS: number; line: LonLat[] };
  places: SamplePlace[];
}

export const SAMPLE = sampleJson as unknown as SampleWorld;
export const SAMPLE_QUESTION = "Driving Lawrence, KS to Denver, CO. Where can we stop for coffee and EV charging about every two hours?";

export function sampleGeocode(text: string): SampleEndpoint | null {
  const t = text.toLowerCase();
  if (/\blawrence\b/.test(t)) return SAMPLE.endpoints.lawrence;
  if (/\bdenver\b/.test(t)) return SAMPLE.endpoints.denver;
  return null;
}

/** The sample route between two points, if they are the sample trip's ends (either direction). */
export function sampleRoute(from: LonLat, to: LonLat) {
  const { lawrence, denver } = SAMPLE.endpoints;
  const near = (a: LonLat, b: LonLat) => haversine(a, b) < 5000;
  if (near(from, lawrence.at) && near(to, denver.at)) return SAMPLE.route;
  if (near(from, denver.at) && near(to, lawrence.at)) return { ...SAMPLE.route, line: [...SAMPLE.route.line].reverse() };
  return null;
}

const matches = (p: SamplePlace, keys: string[]) => keys.some((k) => p.categories.includes(k));

export function samplePlacesAlong(line: LonLat[], keys: string[], bufferM: number, limit: number) {
  const cum = cumulative(line);
  return SAMPLE.places.filter((p) => matches(p, keys) && project(line, cum, p.at).offM <= bufferM).slice(0, limit);
}

export function samplePlacesNear(center: LonLat, key: string, radiusM: number | undefined, limit: number) {
  return SAMPLE.places
    .filter((p) => matches(p, [key]))
    .map((p) => ({ p, d: haversine(center, p.at) }))
    .filter(({ d }) => radiusM === undefined || d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = (message: string) => json({ statusCode: 404, error: "Not Found", message }, 404);

/** A fetch that answers the three Geoapify REST calls the direct path makes, from sample data. */
export const sampleRestFetch: typeof fetch = async (input, init) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/v1/geocode/search") {
    const text = url.searchParams.get("text") ?? "";
    const e = sampleGeocode(text);
    return json({ results: e ? [{ formatted: e.formatted, city: e.city, state: e.state, country_code: e.country_code, lon: e.at[0], lat: e.at[1], result_type: "city", rank: { confidence: 1 } }] : [], query: { text } });
  }
  if (req.method === "GET" && url.pathname === "/v1/routing") {
    const pts = (url.searchParams.get("waypoints") ?? "").split("|").map((s) => s.split(",").map(Number)).map(([lat, lon]) => [lon, lat] as LonLat);
    const r = pts.length === 2 ? sampleRoute(pts[0], pts[1]) : null;
    if (!r) return json({ statusCode: 400, error: "Bad Request", message: "Sample mode only knows the drive between Lawrence, KS and Denver, CO." }, 400);
    const waypoints = pts.map(([lon, lat], i) => ({ location: [lon, lat], original_index: i }));
    return json({
      type: "FeatureCollection",
      properties: { mode: "drive", waypoints: pts.map(([lon, lat]) => ({ lat, lon })), units: "metric" },
      features: [{ type: "Feature", geometry: { type: "MultiLineString", coordinates: [r.line] }, properties: { mode: "drive", units: "metric", distance: r.distanceM, distance_units: "meters", time: r.durationS, waypoints, legs: [{ distance: r.distanceM, time: r.durationS, steps: [] }] } }],
    });
  }
  if (req.method === "POST" && url.pathname === "/v2/places") {
    const body = (await req.json()) as { categories: string[]; filter?: { type: string; geometry?: { coordinates: LonLat[] }; buffer?: number }; limit?: number };
    if (body.filter?.type !== "polyline" || !body.filter.geometry) return json({ statusCode: 400, error: "Bad Request", message: "Sample mode supports polyline filters only." }, 400);
    const found = samplePlacesAlong(body.filter.geometry.coordinates, body.categories, body.filter.buffer ?? 1000, body.limit ?? 20);
    return json({ type: "FeatureCollection", features: found.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p.at }, properties: { name: p.name, formatted: p.formatted, city: p.city, state: p.state, lon: p.at[0], lat: p.at[1], categories: p.categories, place_id: p.id, datasource: { sourcename: "openstreetmap", attribution: "(c) OpenStreetMap contributors" } } })) });
  }
  return notFound(`Sample mode has no data for ${req.method} ${url.pathname}`);
};
