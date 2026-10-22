# Places Along

**Where to stop for coffee, EV charging, food, or a rest on a long drive, answered two ways with [Geoapify](https://www.geoapify.com/).**

Type a trip like *"Driving Lawrence, KS to Denver, CO. Where can we stop for coffee and EV charging about every two hours?"* Two columns answer it:

- **Agent**: a model plans the work and calls Geoapify tools through the [Geoapify MCP server](https://apidocs.geoapify.com/docs/mcp/). Its final stop list may only use places a tool returned.
- **Direct**: plain code calls the Geoapify REST APIs through a client typed from [Geoapify's OpenAPI specs](https://github.com/geoapify/geoapify-openapi-specs).

Every Geoapify call on both sides is shown in a trace, with its arguments, result summary, and time. A map and a one-line comparison sit on top.

![Places Along on live Geoapify data](public/screenshots/live-overview.png)

Built for the [Geoapify Open Geospatial Program](https://www.geoapify.com/open-geospatial-program/), Batch #2. The full write-up is the **[tutorial](docs/TUTORIAL.md)** (also at `/tutorial` in the app), including how to connect the Geoapify MCP server to Cursor and Claude Code with the exact prompts.

## Status

Demo: **[places-along.vercel.app](https://places-along.vercel.app)**, on live Geoapify data. The hosted demo runs on a key provided by Geoapify's Open Geospatial Program; to run it yourself, get a free key at [myprojects.geoapify.com](https://myprojects.geoapify.com/).

| | |
| --- | --- |
| Live Geoapify, direct path (REST, typed client) | Working, verified on the hosted demo, Oct 22, 2026 |
| Live Geoapify, agent path (MCP, scripted driver) | Working, verified on the hosted demo, Oct 22, 2026 |
| Model-driven agent (OpenRouter free models) | Works locally; free models are slow (45 to 70 s) and sometimes time out, so the hosted demo uses the scripted driver |
| Sample mode (no keys) | Working, tested |

What the live run found, and what was fixed, is in [FEEDBACK.md](FEEDBACK.md) and [LESSONS.md](LESSONS.md).

### Protecting the free quota

Geoapify's free plan allows 3,000 requests a day. Every Geoapify call stays on the server (Next.js route handlers); the key never reaches the browser and is not in this repo. The public demo also counts the Geoapify requests it makes and stops live runs at a daily budget (1,000 by default), allows 12 live runs per visitor a day, and caches repeated questions for an hour.

## Architecture

```
 question ──► parseTrip ──┬──► Agent path                                   ┌─► trace
                          │     official MCP client (Streamable HTTP)       │
                          │     ──► https://api.geoapify.com/v1/mcp         │
                          │         geocode_address, calculate_route,       │
                          │         measure_geometry, search_places          │
                          │     model (OpenRouter) or scripted driver        │
                          │     answer kept only if a tool returned it ─────┤
                          │                                                  ├─► stops ─► map + columns
                          └──► Direct path                                   │
                                openapi-fetch + types from Geoapify OpenAPI  │
                                GET /v1/geocode/search  x2                   │
                                GET /v1/routing         x1                   │
                                POST /v2/places (polyline filter) per stop ──┘
                                shared planner (src/lib/plan.ts)
```

| Path | File | What it does |
| --- | --- | --- |
| `src/lib/agent.ts` | Agent harness | Tool loop, route-geometry references, answer validation, scripted driver |
| `src/lib/mcp/connect.ts` | MCP session | Official `@modelcontextprotocol/client`, key in `x-api-key` |
| `src/lib/direct.ts` | Direct path | Geocode, route, places per stop window |
| `src/lib/geoapify/client.ts` | Typed REST client | openapi-fetch over generated types, trace middleware |
| `src/lib/geoapify/generated/` | Generated | `pnpm gen:client` from `openapi/*.json` |
| `src/lib/plan.ts` | Planner | Stop windows and picks, shared by both paths |
| `src/lib/sample.ts`, `src/lib/mcp/sample-server.ts` | Sample mode | Stand-ins that answer in Geoapify's response shapes |
| `prompts/` | Prompts | The agent's system prompt and the client prompts from the tutorial |

## Setup

Requirements: Node.js 20+, pnpm 10.

```bash
git clone https://github.com/Joe-Simo/places-along
cd places-along
pnpm install
pnpm dev                 # http://localhost:3000
```

With no keys this runs in sample mode. To use Geoapify:

```bash
cp .env.example .env.local
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEOAPIFY_API_KEY` | for live data | Geoapify key from [myprojects.geoapify.com](https://myprojects.geoapify.com/). Read from the environment only; never commit it. |
| `OPENROUTER_API_KEY` | no | Lets a model drive the agent. Without it the agent follows a scripted plan with the same tools. |
| `PLACES_ALONG_MODELS` | no | Comma-separated OpenRouter model ids (free models by default). |
| `PLACES_ALONG_DAILY_GEOAPIFY_REQUESTS` | no | Geoapify requests the server may make per day before live runs stop (default 1000; the free plan allows 3,000). Counted per server instance. |
| `PLACES_ALONG_VISITOR_RUNS_PER_DAY` | no | Live runs per visitor (IP address) per day (default 12). |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm test` | Vitest: parser, geometry, planner, both paths end to end in sample mode, house style |
| `pnpm typecheck` / `pnpm lint` | TypeScript and ESLint |
| `pnpm gen:client` | Regenerate types and the MCP tool catalog from `openapi/` |
| `pnpm smoke` | With `GEOAPIFY_API_KEY` set: one live run of both paths plus checks of the live MCP shapes, written to `smoke-report.json` |
| `pnpm transcript` | With `GEOAPIFY_API_KEY` set: the tutorial's prompt 1 as plain MCP tool calls with the official client ([sample output](docs/transcripts/mcp-official-client.txt)) |
| `node scripts/build-sample.mjs` | Rebuild the sample data from OSRM and OpenStreetMap |

## Deploy

Any Node host works. On Vercel: import the repo, set `GEOAPIFY_API_KEY` (and optionally `OPENROUTER_API_KEY`) as environment variables, deploy.

## Tested

- Automated: `pnpm test` (33 tests: parser, geometry, planner, both paths end to end in sample mode, the live-shape fixes, house style), plus typecheck, lint, and build.
- Live, Oct 22, 2026, on the hosted demo with the program key: Lawrence, KS to Denver, CO (coffee and EV charging); Portland, OR to Boise, ID (coffee and food); Chicago, IL to Nashville, TN (food and rest). Both paths returned stops on every trip with no failed calls.
- `pnpm smoke` and `pnpm transcript` against the live API and MCP server (output in [docs/transcripts/](docs/transcripts/)).

## Known limitations

- **The agent can miss stops the direct path finds.** MCP `search_places` searches a circle around one point per stop; the REST Places polyline filter covers the whole stretch of road. On empty roads the agent comes back with fewer picks, and the page says why.
- **The hosted agent is scripted.** It makes the same MCP calls a model would, in a fixed order. The model driver (OpenRouter free models) works locally but took 45 to 70 s per run in our tests and sometimes timed out.
- **The demo's daily budget is per server instance** and kept in memory, so it resets when an instance restarts. It keeps casual traffic well under the free plan; it is not a hard global quota.
- **Driving only, one question shape.** The parser reads "A to B" plus the kinds of stop and "every N hours" or minutes. Other phrasings get a hint instead of an answer.
- **"Rest" means public toilets and picnic sites.** Geoapify has no highway rest area category (see FEEDBACK.md).
- **The map is a schematic line**, not a tile map: enough to place the stops along the drive, not to navigate.
- **Cursor and Claude Code were not run for the tutorial.** Their setup follows Geoapify's guide; the tested equivalents are the official MCP client and curl transcripts.

## Also in this repo

- [docs/TUTORIAL.md](docs/TUTORIAL.md): the tutorial
- [docs/transcripts/](docs/transcripts/): real transcripts of the Geoapify MCP server (official client and curl), key hidden
- [LESSONS.md](LESSONS.md): what needed human guidance while building it
- [FEEDBACK.md](FEEDBACK.md): concrete notes on Geoapify's OpenAPI specs and MCP tools
- [prompts/](prompts/): agent instructions and client prompts

## Credits and license

Location data and APIs by [Geoapify](https://www.geoapify.com/), built on [OpenStreetMap](https://www.openstreetmap.org/copyright) (data (c) OpenStreetMap contributors, ODbL). Vendored OpenAPI specs (c) Geoapify, MIT. Sample route from the [OSRM](https://project-osrm.org/) demo server.

Places Along is an independent project, not made or endorsed by Geoapify. Code: [MIT](LICENSE).
