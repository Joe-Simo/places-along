import { describe, expect, it } from "vitest";
import { EXAMPLES, initialQuestion } from "@/lib/examples";
import { parseTrip } from "@/lib/parse";
import { SAMPLE_QUESTION } from "@/lib/sample";

describe("examples", () => {
  it.each(EXAMPLES)("$label parses", ({ question }) => {
    expect(parseTrip(question).ok).toBe(true);
  });

  it("starts with the sample trip, which sample mode can answer", () => {
    expect(EXAMPLES[0].question).toBe(SAMPLE_QUESTION);
  });
});

describe("initialQuestion", () => {
  it("uses a shared question, tidied and capped", () => {
    expect(initialQuestion("  Austin, TX  to Dallas, TX ")).toBe("Austin, TX to Dallas, TX");
    expect(initialQuestion("x".repeat(400))).toHaveLength(300);
    expect(initialQuestion(["Austin, TX to Dallas, TX", "ignored"])).toBe("Austin, TX to Dallas, TX");
  });

  it("falls back to the sample question", () => {
    expect(initialQuestion(undefined)).toBe(SAMPLE_QUESTION);
    expect(initialQuestion("   ")).toBe(SAMPLE_QUESTION);
  });
});
