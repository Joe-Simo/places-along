/** [longitude, latitude], the GeoJSON order. */
export type LonLat = [number, number];

export type Category = "coffee" | "charging" | "food" | "rest";

/**
 * How each kind of stop maps onto Geoapify place categories.
 * `geoapify` feeds the Places API (any of them may match). `mcp` is the single category the
 * MCP search_places tool accepts per call, so the agent path makes one call per key.
 */
export const CATEGORIES: Record<Category, { label: string; noun: string; geoapify: string[] }> = {
  coffee: { label: "Coffee", noun: "coffee", geoapify: ["catering.cafe"] },
  charging: { label: "EV charging", noun: "EV charging", geoapify: ["service.vehicle.charging_station"] },
  food: { label: "Food", noun: "food", geoapify: ["catering.restaurant", "catering.fast_food"] },
  rest: { label: "Rest", noun: "a rest stop", geoapify: ["amenity.toilet", "leisure.picnic.picnic_site"] },
};
export const CATEGORY_ORDER: Category[] = ["coffee", "charging", "food", "rest"];

/** Map a Geoapify category list (as returned on a place) back to our stop kind. */
export function categoryOf(geoapifyCategories: string[]): Category | null {
  for (const c of CATEGORY_ORDER) {
    if (CATEGORIES[c].geoapify.some((k) => geoapifyCategories.some((g) => g === k || g.startsWith(`${k}.`)))) return c;
  }
  return null;
}

/** A readable name for a place OpenStreetMap left unnamed, such as most public toilets. */
export function unnamedPlace(geoapifyCategories: string[], category: Category): string {
  const has = (k: string) => geoapifyCategories.some((g) => g === k || g.startsWith(`${k}.`));
  if (has("amenity.toilet")) return "Public toilets";
  if (has("leisure.picnic")) return "Picnic site";
  if (has("service.vehicle.charging_station")) return "EV charger";
  if (has("catering.cafe")) return "Cafe";
  if (has("catering.fast_food")) return "Fast food";
  if (has("catering.restaurant")) return "Restaurant";
  return CATEGORIES[category].label;
}

export interface Trip {
  from: string;
  to: string;
  categories: Category[];
  everyMinutes: number;
}

export interface Endpoint { label: string; at: LonLat }

export interface Route {
  from: Endpoint;
  to: Endpoint;
  distanceM: number;
  durationS: number;
  line: LonLat[];
}

export interface Place {
  id: string;
  name: string;
  address: string;
  at: LonLat;
  category: Category;
}

export interface Pick {
  category: Category;
  place: Place;
  /** Minutes from departure to the point on the route nearest this place. */
  etaMinutes: number;
  /** Straight-line distance from the route, in meters. */
  offRouteM: number;
}

export interface Stop {
  /** 1-based stop number. */
  n: number;
  targetMinutes: number;
  picks: Pick[];
  /** Requested kinds with nothing close enough near this stop. */
  missing: Category[];
}

export interface TraceEntry {
  path: "agent" | "direct";
  kind: "mcp" | "http" | "model";
  /** Tool name for MCP, "METHOD /path" for HTTP, model id for model turns. */
  name: string;
  /** Arguments or query, with any key redacted and long geometry shortened. */
  input: unknown;
  ok: boolean;
  ms: number;
  /** One line a person can read: "3 places", "812 km, 8 h 10 min". */
  summary: string;
}

export interface RunResult {
  path: "agent" | "direct";
  /** "live" talks to Geoapify; "sample" uses the bundled sample data. */
  data: "live" | "sample";
  /** Who chose the tool calls on the agent path: a model id, or "scripted" without a model key. */
  driver?: string;
  route: Route | null;
  stops: Stop[];
  trace: TraceEntry[];
  ms: number;
  error?: string;
  /** Agent path: stops the model named that no tool result backs up (dropped from `stops`). */
  unsupported?: string[];
  /** Anything the reader should know about how this result was produced. */
  note?: string;
}
