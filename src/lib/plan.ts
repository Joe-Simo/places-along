import { cumulative, pointAlong, project } from "./geo";
import type { Category, Pick, Place, Route, Stop, Trip } from "./types";
import { CATEGORY_ORDER } from "./types";

export interface PlanOptions {
  /** Places farther than this from the route are ignored. */
  maxOffRouteM?: number;
  /** No stop is planned this close to arrival. */
  arrivalBufferMinutes?: number;
}

/** Minutes of detour each kilometer off the route costs, there and back at town speeds. */
const MINUTES_PER_OFF_KM = 2.4;

/**
 * Turns a route and the places found along it into a stop list: one stop every `everyMinutes`,
 * and at each stop the best place of every requested kind. "Best" balances how close it is to the
 * ideal time against how far it is off the route. Both paths run this same function, so any
 * difference between them comes from the data they gathered, not from the planning.
 */
export function planStops(route: Route, places: Place[], trip: Trip, opts: PlanOptions = {}): Stop[] {
  const maxOff = opts.maxOffRouteM ?? 3000;
  const buffer = opts.arrivalBufferMinutes ?? 20;
  const cum = cumulative(route.line);
  const total = cum[cum.length - 1];
  if (!total || route.durationS <= 0) return [];
  const speed = total / route.durationS; // meters per second, averaged over the trip
  const toMinutes = (m: number) => m / speed / 60;

  const wanted = new Set(trip.categories);
  const located = places
    .filter((p) => wanted.has(p.category))
    .map((p) => ({ place: p, ...project(route.line, cum, p.at) }))
    .filter((p) => p.offM <= maxOff);

  const used = new Set<string>();
  const stops: Stop[] = [];
  const durationMin = route.durationS / 60;
  for (let n = 1; n * trip.everyMinutes <= durationMin - buffer; n++) {
    const target = n * trip.everyMinutes;
    const window = trip.everyMinutes * 0.4;
    const picks: Pick[] = [];
    const missing: Category[] = [];
    for (const category of CATEGORY_ORDER.filter((c) => wanted.has(c))) {
      let best: (typeof located)[number] | null = null;
      let bestScore = Infinity;
      for (const c of located) {
        if (c.place.category !== category || used.has(c.place.id)) continue;
        const fromTarget = Math.abs(toMinutes(c.alongM) - target);
        if (fromTarget > window) continue;
        const score = fromTarget + (c.offM / 1000) * MINUTES_PER_OFF_KM;
        if (score < bestScore) [best, bestScore] = [c, score];
      }
      if (!best) {
        missing.push(category);
        continue;
      }
      used.add(best.place.id);
      picks.push({ category, place: best.place, etaMinutes: Math.round(toMinutes(best.alongM)), offRouteM: Math.round(best.offM) });
    }
    stops.push({ n, targetMinutes: target, picks, missing });
  }
  return stops;
}

export interface StopWindow {
  n: number;
  targetMinutes: number;
  /** The stretch of route where a stop for this slot may be: target time plus or minus 40% of the interval. */
  line: [number, number][];
  /** The ideal point on the route for this stop. */
  center: [number, number];
}

/**
 * The stretches of route worth searching. Both paths search only here, which keeps calls and
 * credits proportional to the number of stops rather than to the length of the drive.
 */
export function stopWindows(route: Route, trip: Trip, arrivalBufferMinutes = 20): StopWindow[] {
  const cum = cumulative(route.line);
  const total = cum[cum.length - 1];
  if (!total || route.durationS <= 0) return [];
  const metersPerMinute = (total / route.durationS) * 60;
  const out: StopWindow[] = [];
  for (let n = 1; n * trip.everyMinutes <= route.durationS / 60 - arrivalBufferMinutes; n++) {
    const target = n * trip.everyMinutes;
    const half = trip.everyMinutes * 0.4 * metersPerMinute;
    const a = Math.max(0, target * metersPerMinute - half);
    const b = Math.min(total, target * metersPerMinute + half);
    const inner = route.line.filter((_, i) => cum[i] > a && cum[i] < b);
    out.push({ n, targetMinutes: target, line: [pointAlong(route.line, cum, a), ...inner, pointAlong(route.line, cum, b)], center: pointAlong(route.line, cum, target * metersPerMinute) });
  }
  return out;
}
