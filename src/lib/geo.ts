import type { LonLat } from "./types";

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters. */
export function haversine(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance from the start of the line to each vertex, in meters. */
export function cumulative(line: LonLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]));
  return out;
}

/** The point `meters` from the start of the line (clamped to its ends). */
export function pointAlong(line: LonLat[], cum: number[], meters: number): LonLat {
  if (meters <= 0) return line[0];
  const total = cum[cum.length - 1];
  if (meters >= total) return line[line.length - 1];
  let i = 1;
  while (cum[i] < meters) i++;
  const t = (meters - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const [a, b] = [line[i - 1], line[i]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Where a point sits relative to a line: how far along it the nearest point is, and how far off
 * it the point lies. Each segment is flattened locally, which is accurate well within a meter
 * for the few-kilometer offsets this app cares about.
 */
export function project(line: LonLat[], cum: number[], p: LonLat): { alongM: number; offM: number } {
  let best = { alongM: 0, offM: Infinity };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const kx = Math.cos(rad((a[1] + b[1]) / 2)) * (Math.PI / 180) * R;
    const ky = (Math.PI / 180) * R;
    const bx = (b[0] - a[0]) * kx;
    const by = (b[1] - a[1]) * ky;
    const px = (p[0] - a[0]) * kx;
    const py = (p[1] - a[1]) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.offM) best = { alongM: cum[i - 1] + t * (cum[i] - cum[i - 1]), offM: off };
  }
  return best;
}

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function formatDistance(meters: number): string {
  const mi = meters / 1609.344;
  return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
}
