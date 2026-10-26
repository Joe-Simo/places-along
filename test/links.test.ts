import { describe, expect, it } from "vitest";
import { MAX_WAYPOINTS, placeUrl, shareUrl, tripUrl, waypoints } from "@/lib/links";
import type { Pick, Route, Stop } from "@/lib/types";

const route: Route = {
  from: { label: "Lawrence, KS", at: [-95.235, 38.9717] },
  to: { label: "Denver, CO", at: [-104.9903, 39.7392] },
  distanceM: 800_000,
  durationS: 27_000,
  line: [[-95.235, 38.9717], [-104.9903, 39.7392]],
};
const pick = (id: string, eta: number, at: [number, number]): Pick => ({
  category: "coffee",
  place: { id, name: id, address: "", at, category: "coffee" },
  etaMinutes: eta,
  offRouteM: 100,
});

describe("links", () => {
  it("points a place at OpenStreetMap with lat before lon", () => {
    expect(placeUrl([-97.6114, 38.8403])).toBe("https://www.openstreetmap.org/?mlat=38.840300&mlon=-97.611400#map=17/38.840300/-97.611400");
  });

  it("lists each place once, in driving order", () => {
    const stops: Stop[] = [
      { n: 1, targetMinutes: 120, picks: [pick("b", 130, [-97, 38.8]), pick("a", 110, [-96, 38.9])], missing: [] },
      { n: 2, targetMinutes: 240, picks: [pick("b", 130, [-97, 38.8]), pick("c", 250, [-100, 39])], missing: [] },
    ];
    expect(waypoints(stops)).toEqual([[-96, 38.9], [-97, 38.8], [-100, 39]]);
  });

  it("builds a Google Maps driving link through the picks", () => {
    const stops: Stop[] = [{ n: 1, targetMinutes: 120, picks: [pick("a", 110, [-96, 38.9])], missing: [] }];
    const t = tripUrl(route, stops)!;
    const u = new URL(t.url);
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/dir/");
    expect(u.searchParams.get("origin")).toBe("38.971700,-95.235000");
    expect(u.searchParams.get("destination")).toBe("39.739200,-104.990300");
    expect(u.searchParams.get("waypoints")).toBe("38.900000,-96.000000");
    expect(u.searchParams.get("travelmode")).toBe("driving");
    expect(t.dropped).toBe(0);
  });

  it("caps waypoints at the Google Maps limit and says how many it left out", () => {
    const picks = Array.from({ length: 12 }, (_, i) => pick(`p${i}`, i * 10, [-96 - i * 0.5, 39]));
    const t = tripUrl(route, [{ n: 1, targetMinutes: 60, picks, missing: [] }])!;
    expect(new URL(t.url).searchParams.get("waypoints")!.split("|")).toHaveLength(MAX_WAYPOINTS);
    expect(t.dropped).toBe(3);
  });

  it("has no trip link when nothing was picked", () => {
    expect(tripUrl(route, [{ n: 1, targetMinutes: 120, picks: [], missing: ["coffee"] }])).toBeNull();
  });

  it("encodes the question in a share link", () => {
    expect(shareUrl("https://places-along.vercel.app", "St. Louis, MO to Chicago, IL?")).toBe("https://places-along.vercel.app/?q=St.+Louis%2C+MO+to+Chicago%2C+IL%3F");
  });
});
