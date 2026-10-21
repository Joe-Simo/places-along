import path from "node:path";

const root = import.meta.dirname;
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(root, "src"), "server-only": path.resolve(root, "test/empty.ts") } },
  test: { environment: "node", env: { GEOAPIFY_API_KEY: "", OPENROUTER_API_KEY: "" }, testTimeout: 20000 },
});
