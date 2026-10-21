import { describe, expect, it } from "vitest";
import { cumulative, pointAlong } from "@/lib/geo";
import { planStops, stopWindows } from "@/lib/plan";
import type { LonLat, Place, Route, Trip } from "@/lib/types";

// A straight 6-hour drive east along the equator, about 111 km per degree.
const line: LonLat[] = Array.from({ length: 61 }, (_, i) => [i * 0.1, 0]);
const route: Route = { from: { label: "A", at: line[0] }, to: { label: "B", at: line[60] }, distanceM: cumulative(line)[60], durationS: 6 * 3600, line };
const cum = cumulative(line);
const at = (hours: number, northM = 0): LonLat => {
  const p = pointAlong(line, cum, (hours / 6) * cum[60]);
  return [p[0], northM / 111_195];
};
const place = (id: string, category: Place["category"], where: LonLat): Place => ({ id, name: id, address: "", at: where, category });
const trip: Trip = { from: "A", to: "B", categories: ["coffee", "charging"], everyMinutes: 120 };

describe("planStops", () => {
  it("plans one stop per interval and picks the closest good place", () => {
    const places = [
      place("coffee-2h", "coffee", at(2, 200)),
      place("coffee-2h-far", "coffee", at(2, 2500)),
      place("charge-2h", "charging", at(2.2, 100)),
      place("coffee-4h", "coffee", at(4.1, 300)),
    ];
    const stops = planStops(route, places, trip);
    expect(stops.map((s) => s.targetMinutes)).toEqual([120, 240]);
    expect(stops[0].picks.map((p) => p.place.id)).toEqual(["coffee-2h", "charge-2h"]);
    expect(stops[0].picks[0].etaMinutes).toBe(120);
    expect(stops[1].picks.map((p) => p.place.id)).toEqual(["coffee-4h"]);
    expect(stops[1].missing).toEqual(["charging"]);
  });

  it("ignores places too far off the road and never uses a place twice", () => {
    const places = [place("only", "coffee", at(3, 100)), place("far", "coffee", at(2, 9000))];
    const stops = planStops(route, places, { ...trip, categories: ["coffee"], everyMinutes: 150 });
    const ids = stops.flatMap((s) => s.picks.map((p) => p.place.id));
    expect(ids).toEqual(["only"]);
  });

  it("plans nothing for a drive shorter than the interval", () => {
    expect(planStops({ ...route, durationS: 3600 }, [], trip)).toEqual([]);
  });

  it("builds search windows around each stop", () => {
    const w = stopWindows(route, trip);
    expect(w.map((x) => x.n)).toEqual([1, 2]);
    expect(w[0].center[0]).toBeCloseTo(2, 1);
    expect(w[0].line[0][0]).toBeCloseTo(1.2, 1);
    expect(w[0].line.at(-1)![0]).toBeCloseTo(2.8, 1);
  });
});
