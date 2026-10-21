// Builds fixtures/sample-lawrence-denver.json, the data sample mode serves when no
// GEOAPIFY_API_KEY is set. It does NOT come from Geoapify: the route is from the public OSRM
// demo server and the places are from OpenStreetMap via Nominatim (data (c) OpenStreetMap
// contributors, ODbL). Geoapify is also built on OpenStreetMap, so the shapes are realistic,
// but every screen that shows this data labels it "Sample data".
// With a GEOAPIFY_API_KEY set, the app ignores this file and calls Geoapify.
//
// Usage: node scripts/build-sample.mjs            (fetches; about 2 minutes, Nominatim allows 1 request/s)
//        SAMPLE_CACHE=/tmp/pa node scripts/build-sample.mjs   (reuses nom.json from an earlier run)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const UA = { "User-Agent": "places-along-sample-builder/0.1 (https://github.com/Joe-Simo/places-along)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOWNS = { Topeka: [39.0473, -95.6752], "Junction City": [39.0286, -96.8314], Abilene: [38.9172, -97.2139], Salina: [38.8403, -97.6114], Russell: [38.8953, -98.8598], Hays: [38.8792, -99.3268], WaKeeney: [39.025, -99.8793], Oakley: [39.1333, -100.8638], Colby: [39.3958, -101.0524], Goodland: [39.35, -101.7107], Burlington: [39.3061, -102.2693], Limon: [39.2639, -103.6922], Bennett: [39.7589, -104.4272] };
const TYPES = ["cafe", "charging station", "fast food", "restaurant", "toilets", "picnic site"];
const GEOAPIFY = { cafe: ["catering", "catering.cafe"], charging_station: ["service", "service.vehicle", "service.vehicle.charging_station"], fast_food: ["catering", "catering.fast_food"], restaurant: ["catering", "catering.restaurant"], toilets: ["amenity", "amenity.toilet"], picnic_site: ["leisure", "leisure.picnic", "leisure.picnic.picnic_site"] };
const UNNAMED = { toilets: "Public restrooms", picnic_site: "Picnic area" };

async function nominatim() {
  const cache = process.env.SAMPLE_CACHE && `${process.env.SAMPLE_CACHE}/nom.json`;
  if (cache && existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const places = [];
  for (const [town, [lat, lon]] of Object.entries(TOWNS)) {
    for (const q of TYPES) {
      const d = 0.06;
      const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=15&viewbox=${[lon - d, lat + d, lon + d, lat - d]}&bounded=1&addressdetails=1`;
      const r = await fetch(u, { headers: UA });
      for (const p of r.ok ? await r.json() : []) places.push({ town, q, ...p });
      await sleep(1100);
    }
  }
  const geo = {};
  for (const q of ["Lawrence, Kansas", "Denver, Colorado"]) {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&addressdetails=1`, { headers: UA });
    geo[q] = (await r.json())[0];
    await sleep(1100);
  }
  return { places, geo };
}

/** Douglas-Peucker in degrees; 0.001 keeps the I-70 corridor shape at about 200 points. */
function simplify(p, eps) {
  if (p.length < 3) return p;
  const [a, b] = [p[0], p[p.length - 1]];
  let dmax = 0, idx = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[i][0] - a[0]) * dx + (p[i][1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(p[i][0] - (a[0] + t * dx), p[i][1] - (a[1] + t * dy));
    if (d > dmax) [dmax, idx] = [d, i];
  }
  if (dmax <= eps) return [a, b];
  return simplify(p.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(p.slice(idx), eps));
}

function offRouteM(line, pt) {
  const R = 6371008.8, rad = (d) => (d * Math.PI) / 180;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const kx = Math.cos(rad((a[1] + b[1]) / 2)) * rad(1) * R, ky = rad(1) * R;
    const bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * ky, px = (pt[0] - a[0]) * kx, py = (pt[1] - a[1]) * ky;
    const l2 = bx * bx + by * by, t = l2 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - t * bx, py - t * by));
  }
  return best;
}

const round = (n) => Math.round(n * 1e5) / 1e5;
const { places, geo } = await nominatim();
const ends = ["Lawrence, Kansas", "Denver, Colorado"].map((k) => geo[k]);
const coords = ends.map((g) => `${g.lon},${g.lat}`).join(";");
const osrm = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`, { headers: UA })).json();
const r = osrm.routes[0];
const line = simplify(r.geometry.coordinates, 0.001).map(([x, y]) => [round(x), round(y)]);

const seen = new Set();
const out = [];
for (const p of places) {
  const id = `osm:${p.osm_type}/${p.osm_id}`;
  if (seen.has(id) || !GEOAPIFY[p.type]) continue;
  seen.add(id);
  const at = [round(Number(p.lon)), round(Number(p.lat))];
  if (offRouteM(line, at) > 3000) continue;
  const name = p.name || UNNAMED[p.type];
  if (!name) continue;
  const a = p.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const city = a.city ?? a.town ?? a.village ?? p.town;
  const formatted = [name, street, [city, a.state].filter(Boolean).join(", "), a.postcode].filter(Boolean).join(", ");
  out.push({ id, name, formatted, city, state: a.state ?? null, at, categories: GEOAPIFY[p.type] });
}
out.sort((x, y) => x.at[0] - y.at[0]);

const endpoint = (g, label) => ({ label, formatted: g.display_name, city: g.address.city, state: g.address.state, country_code: g.address.country_code, at: [round(Number(g.lon)), round(Number(g.lat))] });
const sample = {
  note: "Sample data for offline demos. Not Geoapify responses. Route: OSRM public demo server. Places: OpenStreetMap via Nominatim. Data (c) OpenStreetMap contributors, ODbL 1.0.",
  builtAt: new Date().toISOString().slice(0, 10),
  endpoints: { lawrence: endpoint(ends[0], "Lawrence, KS"), denver: endpoint(ends[1], "Denver, CO") },
  route: { distanceM: Math.round(r.distance), durationS: Math.round(r.duration), line },
  places: out,
};
writeFileSync("fixtures/sample-lawrence-denver.json", JSON.stringify(sample) + "\n");
const counts = {};
for (const p of out) counts[p.categories.at(-1)] = (counts[p.categories.at(-1)] ?? 0) + 1;
console.log(`route ${line.length} points, ${Math.round(r.distance / 1000)} km, ${(r.duration / 3600).toFixed(1)} h; places`, counts);
