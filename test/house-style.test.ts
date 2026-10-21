import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SKIP = new Set(["node_modules", ".next", ".git", ".vercel", "generated"]);
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    if (SKIP.has(f)) return [];
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|md|mjs|json|css)$/.test(f) && !f.startsWith("pnpm-lock") ? [p] : [];
  });
}

describe("house style", () => {
  it("has no em dashes anywhere in our own files", () => {
    const offenders = files(".").filter((f) => !f.startsWith("openapi") && readFileSync(f, "utf8").includes("\u2014"));
    expect(offenders).toEqual([]);
  });
});
