import { cumulative, pointAlong } from "../geo";
import { SAMPLE, sampleGeocode, samplePlacesNear, sampleRoute } from "../sample";
import type { LonLat } from "../types";
import catalog from "./tool-catalog.json";
import categories from "./place-categories.json";

/**
 * A stand-in for https://api.geoapify.com/v1/mcp used only in sample mode. It speaks the same
 * JSON-RPC over Streamable HTTP, lists Geoapify's eleven tools with the input schemas published
 * in Geoapify's MCP OpenAPI specs, and answers the five this app needs from sample data.
 */
const SUPPORTED = ["list_place_categories", "geocode_address", "calculate_route", "measure_geometry", "search_places"];
const PROTOCOL = "2025-06-18"; // the version Geoapify's docs say the endpoint defaults to

type Args = Record<string, unknown>;
const ok = (structuredContent: unknown) => ({ content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent, isError: false });
const fail = (message: string) => ({ content: [{ type: "text", text: message }], isError: true });

function lineOf(geometry: unknown): LonLat[] | null {
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g?.type === "LineString") return g.coordinates as LonLat[];
  if (g?.type === "MultiLineString") return (g.coordinates as LonLat[][]).flat();
  return null;
}

export function callSampleTool(name: string, args: Args) {
  switch (name) {
    case "list_place_categories":
      return ok({ count: categories.length, categories });
    case "geocode_address": {
      const e = sampleGeocode(String(args.query ?? ""));
      return ok({ query: args.query, count: e ? 1 : 0, results: e ? [{ formatted: e.formatted, city: e.city, state: e.state, country_code: e.country_code, lat: e.at[1], lon: e.at[0], result_type: "city", confidence: 1 }] : [] });
    }
    case "calculate_route": {
      const w = (args.waypoints as { lat: number; lon: number }[] | undefined) ?? [];
      const r = w.length === 2 ? sampleRoute([w[0].lon, w[0].lat], [w[1].lon, w[1].lat]) : null;
      if (!r) return fail("Sample mode only knows the drive between Lawrence, KS and Denver, CO.");
      // Like the live server (seen Oct 22, 2026): a one-part MultiLineString.
      const geometry = args.geometry_scope === "none" ? undefined : { type: "MultiLineString", coordinates: [r.line] };
      return ok({ distance: r.distanceM, units: "metric", distance_units: "meters", time: r.durationS, time_units: "seconds", waypoints: w, legs: [{ distance: r.distanceM, time: r.durationS }], ...(geometry ? { geometry } : {}) });
    }
    case "measure_geometry": {
      if (args.operation !== "along") return fail("Sample mode implements measure_geometry with operation \"along\" only.");
      // The live server accepts only a LineString here and answers anything else with this 400.
      if ((args.geometry as { type?: string } | undefined)?.type !== "LineString") return fail(JSON.stringify({ statusCode: 400, error: "Bad Request", message: "geometry.type must be one of LineString" }));
      const line = lineOf(args.geometry);
      if (!line) return fail(JSON.stringify({ statusCode: 400, error: "Bad Request", message: "geometry must be a GeoJSON geometry object" }));
      const unit = String(args.units ?? "kilometers");
      const factor = /^met/.test(unit) ? 1 : /^mile/.test(unit) ? 1609.344 : 1000;
      const at = pointAlong(line, cumulative(line), Number(args.distance) * factor);
      return ok({ type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: at } } });
    }
    case "search_places": {
      const radius = args.radius_meters === undefined ? undefined : Number(args.radius_meters);
      const found = samplePlacesNear([Number(args.lon), Number(args.lat)], String(args.category), radius, Number(args.limit ?? 20));
      return ok({ category: args.category, coordinates: { lat: args.lat, lon: args.lon }, ...(radius ? { radius_meters: radius } : {}), count: found.length, results: found.map(({ p, d }) => ({ name: p.name, formatted: p.formatted, city: p.city, state: p.state ?? undefined, lat: p.at[1], lon: p.at[0], categories: p.categories, distance: Math.round(d), place_id: p.id })) });
    }
    default:
      return fail(`Sample mode does not implement ${name}. With a Geoapify key, the live server answers it.`);
  }
}

/**
 * Four of Geoapify's published tool schemas (combine_geometries, evaluate_spatial_relation,
 * measure_geometry, transform_geometry) are a top-level oneOf with no `type: "object"`. MCP
 * requires an object schema, and the official TypeScript client rejects the whole tools/list
 * response without it, so the sample server adds it. See FEEDBACK.md.
 */
export function asObjectSchema(schema: Record<string, unknown>) {
  return schema.type === "object" ? schema : { type: "object", ...schema };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** fetch for the official MCP client's Streamable HTTP transport, answering from sample data. */
export const sampleMcpFetch: typeof fetch = async (input, init) => {
  const req = input instanceof Request ? input : new Request(input, init);
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const msg = (await req.json()) as { id?: number | string; method: string; params?: { name?: string; arguments?: Args; protocolVersion?: string } };
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notifications
  switch (msg.method) {
    case "initialize":
      return json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "geoapify-sample", version: SAMPLE.builtAt } } });
    case "tools/list":
      return json({ jsonrpc: "2.0", id: msg.id, result: { tools: catalog.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema: asObjectSchema(inputSchema) })) } });
    case "tools/call":
      return json({ jsonrpc: "2.0", id: msg.id, result: callSampleTool(msg.params?.name ?? "", msg.params?.arguments ?? {}) });
    case "ping":
      return json({ jsonrpc: "2.0", id: msg.id, result: {} });
    default:
      return json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
};

export const SAMPLE_SUPPORTED_TOOLS = SUPPORTED;
