import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Files read at runtime by server code: the agent's system prompt.
  outputFileTracingIncludes: { "/api/plan": ["./prompts/**"] },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
