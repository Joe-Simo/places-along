import { describe, expect, it } from "vitest";
import { cumulative, formatDistance, formatDuration, haversine, pointAlong, project } from "@/lib/geo";
import type { LonLat } from "@/lib/types";

describe("geo", () => {
  it("measures a known distance (Lawrence to Denver city centers, about 864 km straight)", () => {
    const d = haversine([-95.2359, 38.9719], [-104.9849, 39.7392]);
    expect(d / 1000).toBeGreaterThan(840);
    expect(d / 1000).toBeLessThan(880);
  });

  it("finds a point along a line and projects it back", () => {
    const line: LonLat[] = [[0, 0], [0.1, 0], [0.2, 0]];
    const cum = cumulative(line);
    const p = pointAlong(line, cum, cum[2] * 0.75);
    expect(p[0]).toBeCloseTo(0.15, 6);
    const off: LonLat = [0.15, 0.01];
    const r = project(line, cum, off);
    expect(r.alongM).toBeCloseTo(cum[2] * 0.75, -1);
    expect(r.offM).toBeGreaterThan(1100);
    expect(r.offM).toBeLessThan(1120);
  });

  it("formats durations and distances for people", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(583)).toBe("9 h 43 min");
    expect(formatDistance(916_000)).toBe("569 mi");
    expect(formatDistance(1200)).toBe("0.7 mi");
  });
});
