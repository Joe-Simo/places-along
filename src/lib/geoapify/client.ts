import createClient, { type Middleware } from "openapi-fetch";
import type { components as PlacesComponents, paths as PlacesPaths } from "./generated/places";
import type { components as GeocodeComponents, paths as GeocodePaths } from "./generated/forward-geocoding";
import type { paths as RoutingPaths } from "./generated/routing";
import type { LonLat } from "../types";

export const GEOAPIFY_V1 = "https://api.geoapify.com/v1";
export const GEOAPIFY_V2 = "https://api.geoapify.com/v2";

export interface HttpCall {
  method: string;
  path: string;
  /** Query parameters and JSON body, with the key removed and long arrays shortened. */
  input: Record<string, unknown>;
  status: number;
  ms: number;
  /** Parsed JSON response body, for summaries. */
  output?: unknown;
}

/**
 * The generated `PlacesPostRequest` type collapses to `unknown` (the spec's "filter or bias"
 * rule is an `anyOf` of `required` lists, which openapi-typescript 7.13 cannot express), so the
 * one body shape this app sends is typed here from the generated parts.
 */
export interface PlacesAlongBody {
  categories: string[];
  filter: PlacesComponents["schemas"]["PlacesRawPolylineFilter"];
  limit?: number;
}

export type PlaceFeature = PlacesComponents["schemas"]["Feature"];
type GeocodeJson = GeocodeComponents["schemas"]["GeocodingJsonResponse"];

/** Shorten coordinate arrays so a trace stays readable; never keep a key. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length > 6 && value.every((v) => Array.isArray(v))) return `[${value.length} points]`;
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !/^(apikey|api_key|x-api-key)$/i.test(k)).map(([k, v]) => [k, redact(v)]));
  }
  return value;
}

/**
 * Typed clients generated from Geoapify's OpenAPI specs (see scripts/gen-client.mjs).
 * The key travels in the x-api-key header, never in a URL. `fetch` is injectable so sample mode
 * and tests run the exact same request code against bundled data.
 */
export function createGeoapify(opts: { apiKey: string; fetch?: typeof fetch; onCall?: (c: HttpCall) => void }) {
  const headers = { "x-api-key": opts.apiKey };
  const started = new WeakMap<Request, { t: number; body: unknown }>();
  const trace: Middleware = {
    async onRequest({ request }) {
      let body: unknown;
      if (request.method !== "GET") body = await request.clone().json().catch(() => undefined);
      started.set(request, { t: Date.now(), body });
      return request;
    },
    async onResponse({ request, response }) {
      const s = started.get(request);
      const url = new URL(request.url);
      const query: Record<string, unknown> = {};
      url.searchParams.forEach((v, k) => (query[k] = v));
      const isJson = /json/.test(response.headers.get("content-type") ?? "");
      const output = isJson ? await response.clone().json().catch(() => undefined) : undefined;
      opts.onCall?.({ method: request.method, path: url.pathname, input: redact({ ...query, ...(s?.body && typeof s.body === "object" ? s.body : {}) }) as Record<string, unknown>, status: response.status, ms: s ? Date.now() - s.t : 0, output });
      return response;
    },
  };
  const base = { headers, ...(opts.fetch ? { fetch: opts.fetch } : {}) };
  // Routing declares `waypoints` as style: pipeDelimited, explode: false. openapi-fetch reads
  // types, not styles, so the array style has to be set by hand or it sends waypoints=a&waypoints=b.
  const routing = createClient<RoutingPaths>({ baseUrl: GEOAPIFY_V1, ...base, querySerializer: { array: { style: "pipeDelimited", explode: false } } });
  const geocoding = createClient<GeocodePaths>({ baseUrl: GEOAPIFY_V1, ...base });
  const places = createClient<PlacesPaths>({ baseUrl: GEOAPIFY_V2, ...base });
  for (const c of [routing, geocoding, places]) c.use(trace);

  return {
    /** Best match for a free-text place, or null. */
    async geocode(text: string) {
      const { data, error, response } = await geocoding.GET("/geocode/search", { params: { query: { text, limit: 1, format: "json", lang: "en" } } });
      // The 200 response is typed as the union of its GeoJSON, JSON, and XML bodies; format=json picks JSON.
      if (error || !data || !Array.isArray((data as { results?: unknown }).results)) throw new Error(`Geocoding failed (${response.status})`);
      const best = (data as GeocodeJson).results[0];
      if (!best || best.lat === undefined || best.lon === undefined) return null;
      return { label: best.formatted ?? text, at: [best.lon, best.lat] as LonLat };
    },

    /** A driving route. Geoapify routing takes waypoints as "lat,lon", the reverse of GeoJSON. */
    async route(from: LonLat, to: LonLat) {
      const { data, error, response } = await routing.GET("/routing", {
        params: { query: { waypoints: [`${from[1]},${from[0]}`, `${to[1]},${to[0]}`], mode: "drive", format: "geojson" } },
      });
      if (error || !data || typeof data !== "object" || !("features" in data)) throw new Error(`Routing failed (${response.status})`);
      const f = data.features[0];
      if (!f) throw new Error("Routing returned no route");
      const line = f.geometry.coordinates.flat() as LonLat[];
      return { distanceM: f.properties.distance, durationS: f.properties.time, line };
    },

    /** Places of the given categories within `buffer` meters of a line, in one request. */
    async placesAlong(line: LonLat[], categories: string[], buffer = 3000, limit = 500) {
      const body: PlacesAlongBody = { categories, filter: { type: "polyline", geometry: { type: "LineString", coordinates: line }, buffer }, limit };
      const { data, error, response } = await places.POST("/places", { body });
      if (error || !data) throw new Error(`Places search failed (${response.status})`);
      return data.features;
    },
  };
}
export type Geoapify = ReturnType<typeof createGeoapify>;
