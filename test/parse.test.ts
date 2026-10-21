import { describe, expect, it } from "vitest";
import { parseEvery, parseTrip } from "@/lib/parse";
import { SAMPLE_QUESTION } from "@/lib/sample";

describe("parseTrip", () => {
  it("reads the sample question", () => {
    const r = parseTrip(SAMPLE_QUESTION);
    expect(r).toEqual({ ok: true, trip: { from: "Lawrence, KS", to: "Denver, CO", categories: ["coffee", "charging"], everyMinutes: 120 } });
  });

  it("handles 'from' phrasing, minutes, and food", () => {
    const r = parseTrip("Road trip from San Francisco to Los Angeles, stopping for lunch every 90 minutes");
    expect(r.ok && r.trip).toMatchObject({ from: "San Francisco", to: "Los Angeles", categories: ["food"], everyMinutes: 90 });
  });

  it("defaults to coffee and food every two hours", () => {
    const r = parseTrip("Austin, TX to Dallas, TX");
    expect(r.ok && r.trip).toMatchObject({ from: "Austin, TX", to: "Dallas, TX", categories: ["coffee", "food"], everyMinutes: 120 });
  });

  it("asks for both ends when it cannot find them", () => {
    const r = parseTrip("where should I get coffee?");
    expect(r.ok).toBe(false);
  });
});

describe("parseEvery", () => {
  it.each([
    ["every hour", 60],
    ["every two hours", 120],
    ["every 2.5 hours", 150],
    ["every one and a half hours", 90],
    ["every 45 minutes", 45],
    ["every 10 minutes", 30],
    ["no interval here", 120],
  ])("%s -> %i", (text, minutes) => expect(parseEvery(text)).toBe(minutes));
});
