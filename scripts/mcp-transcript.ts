// A plain transcript of the tutorial's prompt 1, made with the official MCP TypeScript client and
// nothing else from this app: connect, list tools, then the same tool calls a chat client makes.
// The key is sent in a header and never printed. Usage: GEOAPIFY_API_KEY=... pnpm transcript
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const key = process.env.GEOAPIFY_API_KEY?.trim();
if (!key) {
  console.error("Set GEOAPIFY_API_KEY first.");
  process.exit(1);
}

const short = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.length > 4 && v.every(Array.isArray) ? `[${v.length} coordinate pairs]` : v.map(short);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, short(x)]));
  return v;
};

const client = new Client({ name: "places-along-transcript", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://api.geoapify.com/v1/mcp"), { requestInit: { headers: { "x-api-key": key } } }));
const server = client.getServerVersion();
console.log(`$ connected to https://api.geoapify.com/v1/mcp (header x-api-key: [hidden])`);
console.log(`  server ${server?.name} ${server?.version}, protocol ${client.getNegotiatedProtocolVersion()}`);
const { tools } = await client.listTools();
console.log(`\n$ tools/list -> ${tools.length} tools`);
for (const t of tools) console.log(`  ${t.name}${t.outputSchema ? "  (has outputSchema)" : ""}`);

let n = 0;
async function call(name: string, args: Record<string, unknown>) {
  n++;
  const started = Date.now();
  console.log(`\n[${n}] tools/call ${name} ${JSON.stringify(short(args))}`);
  try {
    const r = await client.callTool({ name, arguments: args });
    const s = (r.structuredContent ?? {}) as Record<string, unknown>;
    if (r.isError) {
      const text = (r.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
      console.log(`    error (${Date.now() - started} ms): ${text.slice(0, 200)}`);
      return null;
    }
    console.log(`    ok (${Date.now() - started} ms)`);
    return s;
  } catch (err) {
    console.log(`    client error (${Date.now() - started} ms): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

type Hit = { name?: string; city?: string; lat: number; lon: number; distance?: number };
const ends: { lat: number; lon: number }[] = [];
for (const query of ["Lawrence, KS", "Denver, CO"]) {
  const s = await call("geocode_address", { query, limit: 1 });
  const r = (s?.results as (Hit & { formatted: string })[] | undefined)?.[0];
  if (r) console.log(`    ${r.formatted} at ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`);
  if (r) ends.push({ lat: r.lat, lon: r.lon });
}
const route = await call("calculate_route", { waypoints: ends, mode: "drive", geometry_scope: "route", geometry_format: "geojson" });
const geom = route?.geometry as { type: string; coordinates: unknown[] } | undefined;
const hours = Number(route?.time) / 3600;
console.log(`    ${(Number(route?.distance) / 1609.344).toFixed(0)} mi, ${hours.toFixed(1)} h, geometry ${geom?.type} with ${geom?.coordinates.length} part(s)`);

// measure_geometry "along" accepts only a LineString; calculate_route returns a MultiLineString.
const asIs = await call("measure_geometry", { operation: "along", geometry: geom, distance: 100, units: "kilometers" });
if (!asIs) console.log("    (expected: along needs a LineString, so flatten the route first)");
const line = { type: "LineString", coordinates: geom?.type === "MultiLineString" ? (geom.coordinates as unknown[][]).flat() : geom?.coordinates };

const kmPerHour = Number(route?.distance) / 1000 / hours;
for (let h = 2; h <= hours - 20 / 60; h += 2) {
  const at = await call("measure_geometry", { operation: "along", geometry: line, distance: Math.round(h * kmPerHour), units: "kilometers" });
  const [lon, lat] = ((at?.data as { geometry?: { coordinates?: number[] } } | undefined)?.geometry?.coordinates ?? []) as number[];
  if (lat === undefined) continue;
  console.log(`    stop at ${h} h: ${lat.toFixed(3)}, ${lon.toFixed(3)}`);
  for (const category of ["catering.cafe", "service.vehicle.charging_station"]) {
    const s = await call("search_places", { category, lat, lon, radius_meters: 50000, limit: 5 });
    const hits = (s?.results as Hit[] | undefined) ?? [];
    console.log(`    ${s ? `${s.count} found` : "no result"}${hits.length ? ": " + hits.slice(0, 3).map((p) => `${p.name ?? "(unnamed)"}, ${p.city ?? "?"} (${((p.distance ?? 0) / 1000).toFixed(1)} km)`).join("; ") : ""}`);
  }
}
await client.close();
console.log(`\n${n} tool calls. Run on ${new Date().toISOString().slice(0, 10)}.`);
