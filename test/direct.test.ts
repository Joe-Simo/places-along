import { describe, expect, it } from "vitest";
import { runDirect } from "@/lib/direct";
import { redact } from "@/lib/geoapify/client";
import { parseTrip } from "@/lib/parse";
import { SAMPLE_QUESTION, sampleRestFetch } from "@/lib/sample";
import type { Trip } from "@/lib/types";

const trip = (parseTrip(SAMPLE_QUESTION) as { ok: true; trip: Trip }).trip;

describe("direct path (generated OpenAPI client against sample data)", () => {
  it("geocodes, routes once, then searches each stop window", async () => {
    const r = await runDirect(trip, { apiKey: null, fetch: sampleRestFetch });
    expect(r.error).toBeUndefined();
    expect(r.data).toBe("sample");
    expect(r.route?.durationS).toBeGreaterThan(8 * 3600);
    expect(r.trace.map((t) => t.name)).toEqual([
      "GET /v1/geocode/search",
      "GET /v1/geocode/search",
      "GET /v1/routing",
      ...r.stops.map(() => "POST /v2/places"),
    ]);
    expect(r.trace.every((t) => t.ok)).toBe(true);
    expect(r.stops.length).toBe(4);
    expect(r.stops.flatMap((s) => s.picks).length).toBeGreaterThanOrEqual(4);
    for (const s of r.stops) for (const p of s.picks) expect(p.offRouteM).toBeLessThanOrEqual(3000);
  });

  it("sends the key as a header and waypoints pipe-delimited, as the routing spec declares", async () => {
    const seen: Request[] = [];
    const spy: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      seen.push(req.clone());
      return sampleRestFetch(req);
    };
    await runDirect(trip, { apiKey: "test-key", fetch: spy });
    const routing = seen.find((r) => r.url.includes("/v1/routing"))!;
    const q = new URL(routing.url).searchParams;
    expect(q.getAll("waypoints")).toHaveLength(1);
    expect(q.get("waypoints")).toMatch(/^38\.97\d*,-95\.23\d*\|39\.73\d*,-104\.98\d*$/);
    for (const r of seen) {
      expect(r.headers.get("x-api-key")).toBe("test-key");
      expect(r.url).not.toMatch(/apiKey/i);
    }
  });

  it("uses sample data by default when there is no key, never the network", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("network used"));
    try {
      const r = await runDirect(trip, { apiKey: null });
      expect(r.error).toBeUndefined();
      expect(r.stops.length).toBe(4);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("explains when a place is outside the sample", async () => {
    const r = await runDirect({ ...trip, from: "Boise, ID" }, { apiKey: null, fetch: sampleRestFetch });
    expect(r.error).toMatch(/Boise.*Sample mode/);
    expect(r.stops).toEqual([]);
  });

  it("never keeps a key in a trace", () => {
    expect(redact({ apiKey: "k", text: "Denver", nested: { "x-api-key": "k" } })).toEqual({ text: "Denver", nested: {} });
  });
});
