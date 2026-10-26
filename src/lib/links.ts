import type { LonLat, Route, Stop } from "./types";

/** Google Maps directions links accept at most nine waypoints. */
export const MAX_WAYPOINTS = 9;

const latLon = ([lon, lat]: LonLat) => `${lat.toFixed(6)},${lon.toFixed(6)}`;

/** The place on OpenStreetMap, the data Geoapify's places come from. */
export function placeUrl(at: LonLat): string {
  const [lon, lat] = at.map((n) => n.toFixed(6));
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

/** Each picked place once, in driving order. */
export function waypoints(stops: Stop[]): LonLat[] {
  const seen = new Set<string>();
  return stops
    .flatMap((s) => s.picks)
    .sort((a, b) => a.etaMinutes - b.etaMinutes)
    .filter((p) => (seen.has(p.place.id) ? false : (seen.add(p.place.id), true)))
    .map((p) => p.place.at);
}

/**
 * A Google Maps driving link through every picked place, so the plan can go straight to a phone.
 * Returns null when there is nothing to add to a plain A-to-B drive.
 */
export function tripUrl(route: Route, stops: Stop[]): { url: string; dropped: number } | null {
  const all = waypoints(stops);
  if (!all.length) return null;
  const kept = all.slice(0, MAX_WAYPOINTS);
  const q = new URLSearchParams({
    api: "1",
    origin: latLon(route.from.at),
    destination: latLon(route.to.at),
    travelmode: "driving",
    waypoints: kept.map(latLon).join("|"),
  });
  return { url: `https://www.google.com/maps/dir/?${q}`, dropped: all.length - kept.length };
}

/** A link that reopens the app on the same question. */
export function shareUrl(origin: string, question: string): string {
  return `${origin}/?${new URLSearchParams({ q: question })}`;
}
