# Plan stops along a route with Geoapify: an MCP agent and a typed OpenAPI client, side by side

You are driving Lawrence, Kansas to Denver, Colorado, more than 500 miles on I-70, and you want coffee and an EV charger about every two hours. This tutorial answers that question with [Geoapify](https://www.geoapify.com/) in two ways and compares them honestly:

1. **Agent path.** An AI model plans the work and calls Geoapify tools through the [Geoapify MCP server](https://apidocs.geoapify.com/docs/mcp/). Every tool call is logged.
2. **Direct path.** Plain TypeScript calls the Geoapify REST APIs through a client whose types are generated from [Geoapify's OpenAPI specs](https://github.com/geoapify/geoapify-openapi-specs).

Part A needs no code: it connects the Geoapify MCP server to Cursor and to Claude Code and gives you the exact prompts. Parts B to D walk through the open source app, [Places Along](https://github.com/Joe-Simo/places-along), which runs both paths side by side.

> **Status of this tutorial (Oct 21, 2026).** The code, the tests, and the sample mode are complete. The steps in Part A follow Geoapify's own [client setup guide](https://apidocs.geoapify.com/how-to/api-tooling-ai/connect-ai-client-mcp/). The screenshots and recorded transcripts from live runs are marked *pending* below. They will be captured with a real key, with the key hidden, before final submission. Nothing on this page claims a live result that has not been run yet.

## What you need

- A Geoapify API key. Create a project at [myprojects.geoapify.com](https://myprojects.geoapify.com/) and copy its key.
- For Part A: Cursor or Claude Code.
- For Parts B to D: Node.js 20 or newer and pnpm. Optional: an [OpenRouter](https://openrouter.ai/) key, so the agent path is driven by a model rather than a script.

Keep the key in an environment variable named `GEOAPIFY_API_KEY`. Do not paste it into chat, into a committed file, or into a screenshot.

```bash
export GEOAPIFY_API_KEY="your key here"   # in the shell that starts your editor or CLI
```

## Part A: connect the Geoapify MCP server to your AI client

The Geoapify MCP server is a remote HTTP (Streamable HTTP) server. It authenticates with your API key and does not support OAuth. Send the key in an `x-api-key` header. These are the values every client needs:

| Setting | Value |
| --- | --- |
| Name | `geoapify` |
| Transport | Remote HTTP / Streamable HTTP (not stdio, not SSE) |
| URL | `https://api.geoapify.com/v1/mcp` |
| Header | `x-api-key: <your key, from an environment variable>` |

The server exposes eleven tools: `geocode_address`, `geocode_structured_address`, `reverse_geocode_coordinates`, `search_places`, `list_place_categories`, `calculate_route`, `calculate_route_matrix`, `combine_geometries`, `evaluate_spatial_relation`, `measure_geometry`, and `transform_geometry`. A stops-along-the-route question uses five of them.

`initialize` and `tools/list` cost no credits. Each `tools/call` is billed like the Geoapify API call behind it ([Geoapify docs](https://apidocs.geoapify.com/how-to/api-tooling-ai/connect-ai-client-mcp/)).

### Cursor

1. Set `GEOAPIFY_API_KEY` in the environment that starts Cursor, then restart Cursor.
2. Create `.cursor/mcp.json` in your project (or merge into the existing one):

   ```json
   {
     "mcpServers": {
       "geoapify": {
         "url": "https://api.geoapify.com/v1/mcp",
         "headers": { "x-api-key": "${env:GEOAPIFY_API_KEY}" }
       }
     }
   }
   ```

3. Open Cursor Settings, find the MCP section, and turn on `geoapify`. You should see its tools listed.
4. Check the file: it must contain `${env:GEOAPIFY_API_KEY}`, never the key itself.

*Screenshot pending: Cursor's MCP settings with `geoapify` enabled and its tools listed. Key not visible.*

### Claude Code

1. Set `GEOAPIFY_API_KEY` in the shell where you start `claude`.
2. Create `.mcp.json` in the project root (or merge into the existing one):

   ```json
   {
     "mcpServers": {
       "geoapify": {
         "type": "http",
         "url": "https://api.geoapify.com/v1/mcp",
         "headers": { "x-api-key": "${GEOAPIFY_API_KEY}" }
       }
     }
   }
   ```

3. Start `claude` in that folder, approve the project server when asked, then run `/mcp` to see `geoapify` connected. `claude mcp get geoapify` shows the same from the terminal.

*Screenshot pending: `/mcp` in Claude Code showing `geoapify` connected. Key not visible.*

### Check the connection

Paste this into the chat:

```text
Use the Geoapify tools to geocode "Lawrence, KS". Return the formatted address and the coordinates, and tell me which tool you called.
```

You should see one `geocode_address` call and a result with a formatted address and numeric latitude and longitude. If the client reports HTTP 401, the key did not arrive: check the environment variable and restart the client. (Without a key, the endpoint answers `{"statusCode":401,"error":"Unauthorized","message":"Invalid apiKey"}`, even for `initialize`.)

### The prompts

These are the exact prompts Places Along is built around. They work in Cursor and Claude Code once the server is connected.

**1. The trip question.**

```text
Using only the Geoapify tools: I'm driving from Lawrence, KS to Denver, CO.
Where can I stop for coffee and EV charging about every two hours?

Work like this:
1. Geocode both places with geocode_address.
2. Get a driving route with calculate_route (geometry_format "geojson").
3. Work out the points along the route at 2 h, 4 h, 6 h, and so on (stop no later than
   20 minutes before arrival), using measure_geometry with operation "along".
4. At each point, search with search_places for category "catering.cafe" and for
   "service.vehicle.charging_station", radius_meters 20000.
5. For each stop, pick the closest good option of each kind.

Answer with a numbered stop list: stop time, place name, town, and the tool call each pick came from.
Never name a place that a tool did not return.
```

**2. Show your work.** Ask this right after the answer:

```text
List every Geoapify tool call you made, in order, with its arguments (shorten long coordinate arrays),
and for each stop say which search_places call returned it.
```

**3. Change one thing.**

```text
Same trip, but I also want a proper meal at the stop closest to the halfway point.
Use search_places with "catering.restaurant" there, and keep everything else the same.
```

**4. When a category is unknown.**

```text
Before searching, call list_place_categories and tell me which exact category keys fit
"a place to rest on a road trip". Then use them for the stops in my last trip.
```

What to expect: about two `geocode_address` calls, one `calculate_route`, one `measure_geometry` per stop, and one `search_places` per stop and category. For the trip above that is 2 + 1 + 4 + 8 = 15 tool calls. `search_places` takes one category per call, which is why the count grows with every kind of stop you ask for.

*Transcript pending: the tool calls and answer for prompt 1 in Cursor and in Claude Code, recorded with a live key.*

A note on context size. `calculate_route` returns the full route geometry, and `measure_geometry` needs that geometry passed back in. In a chat client the model has to carry hundreds of coordinates between calls. If your client struggles, ask for `geometry_format "polyline"`, or let the app do it as shown in Part B.

## Part B: the agent path in code

Places Along runs the same workflow inside a Next.js route handler. The pieces, in [`src/lib`](https://github.com/Joe-Simo/places-along/tree/main/src/lib):

**Connect with the official MCP client** ([`mcp/connect.ts`](https://github.com/Joe-Simo/places-along/blob/main/src/lib/mcp/connect.ts)):

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const transport = new StreamableHTTPClientTransport(new URL("https://api.geoapify.com/v1/mcp"), {
  requestInit: { headers: { "x-api-key": process.env.GEOAPIFY_API_KEY! } },
});
const client = new Client({ name: "places-along", version: "0.1.0" });
await client.connect(transport);
const { tools } = await client.listTools();
```

**Offer the model only the tools it needs.** Geoapify's guide advises enabling only what a workflow uses. The app passes five tools to the model as OpenAI-style functions:

```ts
const AGENT_TOOLS = ["geocode_address", "calculate_route", "measure_geometry", "search_places", "list_place_categories"];
```

**Keep big geometry out of the model's context.** When `calculate_route` returns, the app stores the geometry and shows the model a reference instead: `{"geometry": {"ref": "route", "points": 198}}`. When the model later calls `measure_geometry` with `"geometry": {"ref": "route"}`, the app swaps the real line back in before the call goes to Geoapify. The trace still shows the real call. Search results are trimmed the same way, to name, address, coordinates, distance, and `place_id`.

**Only trust what a tool returned.** The model's final answer is JSON with a `place_id` for every stop. The app keeps a stop only if a `search_places` result in this run returned that place, and lists any dropped names under the result. If the model's answer is unusable, the app falls back to its shared planner over the places the agent's own calls found, and says so.

**No model key?** The agent path then follows a scripted plan: the same five tools in the same order, with no model. The page labels which driver ran.

The system prompt is in [`prompts/agent-system.md`](https://github.com/Joe-Simo/places-along/blob/main/prompts/agent-system.md).

## Part C: the direct path with a typed client from OpenAPI

Geoapify publishes OpenAPI 3.1 specs for every API. Places Along vendors three of them and generates types with [openapi-typescript](https://openapi-ts.dev/), then calls the API through [openapi-fetch](https://openapi-ts.dev/openapi-fetch/), the approach Geoapify's own [OpenAPI article](https://www.geoapify.com/geoapify-openapi-specifications-ai-coding-tools/) uses.

```bash
pnpm add openapi-fetch
pnpm add -D openapi-typescript
pnpm exec openapi-typescript openapi/routing.json -o src/lib/geoapify/generated/routing.ts --default-non-nullable=false
```

`--default-non-nullable=false` keeps request fields that have a default (like `limit`) optional, which is what the spec means. [`scripts/gen-client.mjs`](https://github.com/Joe-Simo/places-along/blob/main/scripts/gen-client.mjs) runs it for every spec.

The whole direct path is four kinds of request ([`geoapify/client.ts`](https://github.com/Joe-Simo/places-along/blob/main/src/lib/geoapify/client.ts)):

1. `GET /v1/geocode/search` for each end of the trip.
2. `GET /v1/routing` once.
3. `POST /v2/places` once per stop, with a **polyline filter**: the stretch of road where that stop could be, buffered by 3 km, and every requested category in one request.

```ts
const { data } = await places.POST("/places", {
  body: {
    categories: ["catering.cafe", "service.vehicle.charging_station"],
    filter: { type: "polyline", geometry: { type: "LineString", coordinates: stretch }, buffer: 3000 },
    limit: 500,
  },
});
```

Three things that took care to get right:

- **Coordinate order.** Routing takes waypoints as `latitude,longitude`. GeoJSON, and so the Places polyline filter, is `[longitude, latitude]`.
- **Array style.** The routing spec declares `waypoints` as `style: pipeDelimited`. openapi-fetch builds requests from the types, not from the spec's styles, so by default it sends `waypoints=a&waypoints=b`. Set it on the client:

  ```ts
  createClient<paths>({ baseUrl: "https://api.geoapify.com/v1", querySerializer: { array: { style: "pipeDelimited", explode: false } } });
  ```

- **The Places request body type.** The spec says a request needs `filter` or `bias` using an `anyOf` of `required` lists. openapi-typescript 7.13 turns that into `... | unknown`, which accepts anything. The app types its one body shape from the generated parts instead. Details are in [FEEDBACK.md](https://github.com/Joe-Simo/places-along/blob/main/FEEDBACK.md).

Both paths hand their places to the same planner ([`plan.ts`](https://github.com/Joe-Simo/places-along/blob/main/src/lib/plan.ts)). For each stop it picks the place that best balances closeness to the ideal time against distance off the road. So any difference you see between the columns comes from the data each path gathered, not from different planning.

## Part D: what the comparison shows

For the sample trip (coffee and EV charging, every two hours, four stops):

| | Agent (MCP) | Direct (OpenAPI client) |
| --- | --- | --- |
| Geoapify calls | 2 geocode + 1 route + 4 along + 8 searches = **15** | 2 geocode + 1 route + 4 places = **7** |
| Who decides the calls | the model (or the scripted plan) | the code |
| Search area per stop | a 20 km circle around one point | a 3 km band along the whole stretch where the stop may fall |
| Grows with | stops x categories | stops |
| Best for | open questions, exploring, changing the plan mid-conversation | a fixed product feature that has to be fast, cheap, and repeatable |

The call counts come from the tests in [`test/`](https://github.com/Joe-Simo/places-along/tree/main/test), which run both paths end to end. The difference in search area matters on empty stretches of road. Around Colby, Kansas, the agent's point at six hours lands 25 to 27 km from the four chargers in Colby, outside a 20 km circle, so that stop comes back empty, while the direct path's band along the road finds both a charger and a cafe there. In the sample run (scripted agent, sample data), all 5 of the agent's picks are among the direct path's 8. You can widen the agent's radius, but that costs more calls and more results to sift.

The honest summary: MCP makes the first answer fast to build and easy to change, and every step is visible. The typed REST client makes the answer cheaper and more predictable once you know the question.

## Run it yourself

```bash
git clone https://github.com/Joe-Simo/places-along
cd places-along
pnpm install
pnpm dev            # http://localhost:3000, sample mode
```

Without keys, the app runs in **sample mode**. The route comes from the public OSRM demo server and the places from OpenStreetMap, not from Geoapify, and the page says so. Both paths still run their real request code: the generated REST client and the official MCP client talk to small stand-ins that answer in Geoapify's documented response shapes.

Add keys to go live:

```bash
cp .env.example .env.local
# set GEOAPIFY_API_KEY (and optionally OPENROUTER_API_KEY), then:
pnpm dev
```

Checks: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| HTTP 401 from the MCP endpoint | The key is missing or wrong. The endpoint returns 401 even for `initialize` without one. |
| The client lists no tools | Transport must be HTTP / Streamable HTTP. Check the server is enabled and approved in the client. |
| Routing returns 400 | Waypoints must be `lat,lon` joined by `|`. Check your client's array style. |
| A category is rejected | Use exact keys from `list_place_categories`, such as `catering.cafe`. |
| The agent names a place that is not in the trace | Places Along drops it and lists it under the result. Ask the model to cite `place_id`s. |

## Further reading

- [Geoapify MCP server docs](https://apidocs.geoapify.com/docs/mcp/) and [client setup guide](https://apidocs.geoapify.com/how-to/api-tooling-ai/connect-ai-client-mcp/)
- [Geoapify OpenAPI specs](https://github.com/geoapify/geoapify-openapi-specs) and [how to generate clients](https://apidocs.geoapify.com/how-to/api-tooling-ai/generate-openapi-clients-sdks/)
- [Places API](https://apidocs.geoapify.com/docs/places/) and [Routing API](https://apidocs.geoapify.com/docs/routing/)
- In this repo: [README](https://github.com/Joe-Simo/places-along#readme), [LESSONS.md](https://github.com/Joe-Simo/places-along/blob/main/LESSONS.md), [FEEDBACK.md](https://github.com/Joe-Simo/places-along/blob/main/FEEDBACK.md), [prompts/](https://github.com/Joe-Simo/places-along/tree/main/prompts)
