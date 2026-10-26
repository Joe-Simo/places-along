import { SAMPLE_QUESTION } from "./sample";

/** One-tap trips for first-time visitors. Each one is checked against the parser in tests. */
export const EXAMPLES: { label: string; question: string }[] = [
  { label: "Lawrence to Denver", question: SAMPLE_QUESTION },
  { label: "Seattle to Portland", question: "Seattle, WA to Portland, OR. Coffee every hour?" },
  { label: "San Francisco to Los Angeles", question: "San Francisco, CA to Los Angeles, CA. EV charging and food every two hours?" },
  { label: "Chicago to St. Louis", question: "Chicago, IL to St. Louis, MO. Food and a rest stop every 90 minutes?" },
];

/** The question a page load should start with: a shared `?q=` if it is usable, else the sample. */
export function initialQuestion(q: string | string[] | undefined): string {
  const text = (Array.isArray(q) ? q[0] : q)?.replace(/\s+/g, " ").trim().slice(0, 300);
  return text || SAMPLE_QUESTION;
}
