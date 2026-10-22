// Key-day check: one live run of both paths against Geoapify, plus the MCP facts the code
// assumes but could not verify without a key. Prints a report and writes smoke-report.json.
// Usage: GEOAPIFY_API_KEY=... pnpm smoke   (OPENROUTER_API_KEY optional)
import { readFileSync, writeFileSync } from "node:fs";
import { runAgent } from "../src/lib/agent";
import { compare } from "../src/lib/compare";
import { runDirect } from "../src/lib/direct";
import { modelKey, openRouterChat } from "../src/lib/llm";
import { connectGeoapifyMcp, GEOAPIFY_MCP_URL, rawToolsList } from "../src/lib/mcp/connect";
import { parseTrip } from "../src/lib/parse";
import { SAMPLE_QUESTION } from "../src/lib/sample";
import type { Trip } from "../src/lib/types";
import { CATEGORIES, CATEGORY_ORDER } from "../src/lib/types";

const key = process.env.GEOAPIFY_API_KEY?.trim();
if (!key) {
  console.error("Set GEOAPIFY_API_KEY first.");
  process.exit(1);
}
const question = process.argv[2] ?? SAMPLE_QUESTION;
const trip = (parseTrip(question) as { ok: true; trip: Trip }).trip;
const report: Record<string, unknown> = { at: new Date().toISOString(), question };

// 1. Raw tools/list: what the live server really sends.
const raw = await fetch(GEOAPIFY_MCP_URL, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-api-key": key }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
const rawText = await raw.text();
report.toolsListHttp = { status: raw.status, contentType: raw.headers.get("content-type") };
const listed = await rawToolsList(key, fetch);
const rawJson = rawText.trim().startsWith("{") ? rawText : rawText.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}";
const rawTools = (JSON.parse(rawJson) as { result?: { tools?: { name: string; inputSchema?: { type?: string }; outputSchema?: unknown }[] } }).result?.tools ?? [];
report.tools = rawTools.map((t) => ({ name: t.name, inputSchemaType: t.inputSchema?.type ?? null, hasOutputSchema: !!t.outputSchema }));
report.toolCount = listed.length;

// 2. The official client: does listTools accept the live schemas?
const mcp = await connectGeoapifyMcp(key);
try {
  await (mcp as unknown as { tools: () => Promise<unknown> }).tools();
  report.officialClientListTools = "ok (or fell back; see warnings above)";
} catch (e) {
  report.officialClientListTools = `failed: ${e instanceof Error ? e.message : e}`;
}

// 3. Shapes the agent harness depends on.
const route = await mcp.call("calculate_route", { waypoints: [{ lat: 38.9719, lon: -95.2359 }, { lat: 39.7392, lon: -104.9849 }], mode: "drive", geometry_scope: "route", geometry_format: "geojson" });
const geom = route.structured?.geometry as { type?: string; coordinates?: unknown[] } | undefined;
report.calculateRoute = { ok: route.ok, geometryType: geom?.type ?? null, points: Array.isArray(geom?.coordinates) ? geom!.coordinates.length : null, distanceUnits: route.structured?.distance_units, timeUnits: route.structured?.time_units };
if (geom) {
  // calculate_route returns a MultiLineString; measure_geometry "along" accepts only a LineString.
  const asIs = await mcp.call("measure_geometry", { operation: "along", geometry: geom, distance: 100, units: "kilometers" });
  report.measureAlongMultiLine = { ok: asIs.ok, shape: (asIs.ok ? JSON.stringify(asIs.structured) : asIs.text).slice(0, 300) };
  const line = geom.type === "MultiLineString" ? (geom.coordinates as unknown[][]).flat() : geom.coordinates;
  const along = await mcp.call("measure_geometry", { operation: "along", geometry: { type: "LineString", coordinates: line }, distance: 100, units: "kilometers" });
  report.measureAlong = { ok: along.ok, shape: (along.ok ? JSON.stringify(along.structured) : along.text).slice(0, 300) };
}
// After tools/list the official client validates results against outputSchema; does search_places pass?
const ev = await mcp.call("search_places", { category: "service.vehicle.charging_station", lat: 38.878, lon: -97.808, radius_meters: 50000, limit: 50 });
report.searchPlacesOutputSchema = { ok: ev.ok, count: ev.structured?.count ?? null, mismatch: ev.schemaMismatch ?? null };
const cats = await mcp.call("list_place_categories", {});
const all = (cats.structured?.categories as string[] | undefined) ?? [];
report.categories = { count: all.length, restLike: all.filter((c) => /rest|toilet|picnic/.test(c) && !c.includes("restaurant")), ourKeysPresent: Object.fromEntries(CATEGORY_ORDER.flatMap((c) => CATEGORIES[c].geoapify).map((k) => [k, all.includes(k)])) };
await mcp.close();

// 4. Both paths end to end.
const direct = await runDirect(trip, { apiKey: key });
const session = await connectGeoapifyMcp(key);
const mk = modelKey();
const agent = await runAgent({ question, trip, mcp: session, data: "live", chat: mk ? openRouterChat(mk) : null, systemPrompt: readFileSync("prompts/agent-system.md", "utf8") });
await session.close();
const summary = (r: typeof direct) => ({ error: r.error ?? null, note: r.note ?? null, driver: r.driver ?? null, ms: r.ms, calls: r.trace.map((t) => `${t.ok ? "ok " : "ERR"} ${t.name}: ${t.summary} (${t.ms} ms)`), stops: r.stops.map((s) => ({ n: s.n, at: s.targetMinutes, picks: s.picks.map((p) => `${p.category}: ${p.place.name} (${p.offRouteM} m off)`), missing: s.missing })) });
report.direct = summary(direct);
report.agent = summary(agent);
if (!direct.error && !agent.error) report.comparison = compare(agent, direct);

writeFileSync("smoke-report.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
