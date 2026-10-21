// Regenerates everything derived from the vendored Geoapify OpenAPI specs in openapi/.
//   1. TypeScript types for the REST APIs the direct path calls (openapi-typescript).
//   2. The MCP tool catalog (name, description, input schema) that sample mode serves
//      from tools/list, taken from Geoapify's focused MCP tool specs.
// Run after refreshing the specs: pnpm gen:client
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

for (const name of ["forward-geocoding", "routing", "places"]) {
  // --default-non-nullable=false: keep request fields that have a default optional, as the spec means.
  execFileSync("pnpm", ["exec", "openapi-typescript", `openapi/${name}.json`, "-o", `src/lib/geoapify/generated/${name}.ts`, "--default-non-nullable=false"], { stdio: "inherit" });
}

// openapi-typescript 7.13 emits the recursive PlaceDetailValue schema as a self-referencing
// property type, which TypeScript rejects (TS2502). Re-express it as a top-level recursive alias.
const placesTs = "src/lib/geoapify/generated/places.ts";
const recursive = /PlaceDetailValue: string \| number \| boolean \| null \| components\["schemas"\]\["PlaceDetailValue"\]\[\] \| \{\s*\[key: string\]: components\["schemas"\]\["PlaceDetailValue"\];\s*\};/;
const src = readFileSync(placesTs, "utf8");
if (!recursive.test(src)) throw new Error("PlaceDetailValue patch no longer matches; check the generated output.");
writeFileSync(
  placesTs,
  src.replace(recursive, "PlaceDetailValue: PlaceDetailJson;") +
    "\n/** Patched in by scripts/gen-client.mjs (see the PlaceDetailValue note there). */\nexport type PlaceDetailJson = string | number | boolean | null | PlaceDetailJson[] | { [key: string]: PlaceDetailJson };\n",
);

/** Inline local "#/components/..." references so each tool schema stands alone. */
function deref(node, doc, seen = new Set()) {
  if (Array.isArray(node)) return node.map((n) => deref(n, doc, seen));
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    if (seen.has(node.$ref)) return {};
    const target = node.$ref.slice(2).split("/").reduce((o, k) => o?.[k], doc);
    const rest = { ...node };
    delete rest.$ref;
    return { ...deref(target, doc, new Set([...seen, node.$ref])), ...deref(rest, doc, seen) };
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(v, doc, seen)]));
}

const tools = readdirSync("openapi/mcp")
  .filter((f) => f.endsWith("-openapi-spec.json"))
  .sort()
  .map((f) => {
    const doc = JSON.parse(readFileSync(`openapi/mcp/${f}`, "utf8"));
    const op = Object.values(doc.paths)[0].post;
    const inputRef = op["x-geoapify-mcp-input-schema"];
    return {
      name: op["x-geoapify-mcp-tool"],
      title: op.summary,
      description: op.description,
      inputSchema: deref({ $ref: inputRef }, doc),
      specVersion: doc.info.version,
    };
  });
writeFileSync("src/lib/mcp/tool-catalog.json", JSON.stringify(tools, null, 1) + "\n");
console.log(`MCP tool catalog: ${tools.length} tools`);

// The category list sample mode returns from list_place_categories.
const places = JSON.parse(readFileSync("openapi/places.json", "utf8"));
writeFileSync("src/lib/mcp/place-categories.json", JSON.stringify(places.components.schemas.PlaceCategory.enum) + "\n");
