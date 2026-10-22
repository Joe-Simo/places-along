import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { marked } from "marked";

export const metadata: Metadata = {
  title: "Tutorial: plan stops along a route with Geoapify MCP and OpenAPI",
  description: "Connect the Geoapify MCP server in MCP Inspector and OpenCode (tested), Cursor, and Claude Code, then build a stops-along-the-route planner two ways: an agent over MCP and a typed client generated from Geoapify's OpenAPI specs.",
};

/** docs/TUTORIAL.md is the single source; this page renders it at build time. */
export default function Tutorial() {
  // Paths in the markdown are relative to docs/ so they work on GitHub; map them for the site.
  const md = readFileSync(path.join(process.cwd(), "docs/TUTORIAL.md"), "utf8")
    .replaceAll("](../public/", "](/")
    .replaceAll("](transcripts/", "](https://github.com/Joe-Simo/places-along/blob/main/docs/transcripts/");
  const html = marked.parse(md, { async: false });
  return (
    <main className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-10 sm:py-14">
      <nav className="mb-8 text-sm">
        <Link href="/" className="underline underline-offset-4">&#8249; Places Along</Link>
      </nav>
      <article className="prose-doc" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
