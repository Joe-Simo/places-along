import type { Category, Trip } from "./types";

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const KINDS: [Category, RegExp][] = [
  ["coffee", /\b(coffee|cafes?|caf\u00e9s?|espresso|latte)\b/i],
  ["charging", /\b(ev|charg(e|er|ers|ing)|supercharg\w*|electric)\b/i],
  ["food", /\b(food|eat|eating|lunch|dinner|breakfast|meals?|restaurants?|burgers?|snacks?)\b/i],
  ["rest", /\b(rest|restrooms?|bathrooms?|toilets?|picnic|stretch|break)\b/i],
];

export const DEFAULT_EVERY = 120;
const LEAD = /^(?:(?:i'?m|we'?re|we are|i am|driving|drive|road\s*trip(?:ping)?|heading|going|travel(?:l)?ing|from)\s+)+/i;
const PLACE = String.raw`[\p{L}0-9 .'\-]+?(?:,\s*\p{L}{2}\b)?`;
const ROUTE = new RegExp(String.raw`(${PLACE})\s+(?:to|->|\u2192)\s+(${PLACE})(?=\s*[,?.;!]|\s+(?:where|and|with|stopping|every|for|via)\b|\s*$)`, "iu");

export type ParseResult = { ok: true; trip: Trip } | { ok: false; error: string };

/**
 * Reads a one-line trip question such as
 * "Driving Lawrence, KS to Denver, CO. Where can we stop for coffee and EV charging about every two hours?"
 * The direct path needs these fields; the agent path gets the original sentence.
 */
export function parseTrip(text: string): ParseResult {
  const clean = text.replace(/\s+/g, " ").trim();
  const m = clean.match(ROUTE);
  if (!m) return { ok: false, error: 'Name both ends of the drive, like "Lawrence, KS to Denver, CO".' };
  const from = m[1].replace(LEAD, "").trim();
  const to = m[2].trim();
  if (!from || !to) return { ok: false, error: 'Name both ends of the drive, like "Lawrence, KS to Denver, CO".' };

  const categories = KINDS.filter(([, re]) => re.test(clean)).map(([c]) => c);
  return { ok: true, trip: { from, to, categories: categories.length ? categories : ["coffee", "food"], everyMinutes: parseEvery(clean) } };
}

export function parseEvery(text: string): number {
  const m = text.match(/every\s+(?:(\d+(?:\.\d+)?)|(a|an|one|two|three|four|five|six))?\s*(and a half\s+)?(hours?|hrs?|h|minutes?|mins?)\b/i);
  if (!m) return DEFAULT_EVERY;
  const n = m[1] ? Number(m[1]) : WORDS[(m[2] ?? "a").toLowerCase()];
  const value = (n + (m[3] ? 0.5 : 0)) * (/^m/i.test(m[4]) ? 1 : 60);
  return Math.min(360, Math.max(30, Math.round(value)));
}
