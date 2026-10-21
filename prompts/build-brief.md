# Build brief (condensed)

The coding agent that built Places Along worked from this brief, written for Joe Simo's Geoapify Open Geospatial Program entry (Batch #2, accepted Oct 21, 2026, due Nov 15, 2026).

- Build the key-independent version first: everything that does not need the Geoapify key.
- Scope (from Geoapify's acceptance mail): stops along a route, such as coffee, EV charging, food, and rest. Not fuel prices.
- Agent path through the Geoapify MCP server (`https://api.geoapify.com/v1/mcp`, `x-api-key` header), with every tool call shown in a trace.
- Direct path through a typed TypeScript client generated from Geoapify's OpenAPI specs.
- A side-by-side comparison of the two.
- Sample mode with clearly labeled sample data until `GEOAPIFY_API_KEY` exists. The key is read from the environment only.
- Deliverables: MIT repo, README (architecture, setup, run, link to geoapify.com), `docs/TUTORIAL.md` also rendered on the site, including connecting the Geoapify MCP server in Cursor and Claude Code with exact prompts (screenshot placeholders marked honestly, keys hidden), this `prompts/` folder, LESSONS.md, FEEDBACK.md with only observed facts (unverified items marked), and passing tests, typecheck, lint, and build.
- Stack: Next.js App Router, Tailwind, pnpm, free OpenRouter models, Vercel.
- House rules: no secrets in git, no em dashes anywhere, keep the repo private until verified live.
- Quality bar: simple, honest, and finished, with care for the parts no one sees.
