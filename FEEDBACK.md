# Feedback on Geoapify's OpenAPI specs and MCP tools

Written while building Places Along (Oct 21 and 22, 2026). Each item says how we know it:

- **Observed**: we saw it ourselves, in the spec files, in generated code, in a test, or in a response from the live API. Live items carry the date we saw them.
- **Unverified**: something we did not test. Listed at the end.

The live checks ran on Oct 22, 2026 with the program key, through `pnpm smoke` (`scripts/smoke.ts`) plus a few direct curl calls.

Spec versions: Forward Geocoding 1.1.2, Routing 1.2.1, Places 2.2.1, Static Maps 1.1.1, MCP tool specs 1.1.2, from [geoapify-openapi-specs](https://github.com/geoapify/geoapify-openapi-specs) commit `dd07a5f` (Oct 16, 2026). Generator: openapi-typescript 7.13.0 with openapi-fetch 0.17.0. MCP client: `@modelcontextprotocol/client` 2.3.1.

## What worked well

- **The focused MCP tool specs and `api-specs/mcp/tools/index.json`** (observed). One small file per tool, with "use this, not that" guidance in each description, is exactly what an agent needs. We built sample mode's whole `tools/list` from these files.
- **The Places API polyline filter** (observed in spec, Places 2.2.1). `POST /v2/places` with `filter: { type: "polyline", geometry, buffer }` and several categories in one request is the single most useful thing for a route app. Our direct path needs one Places request per stop, whatever the number of categories.
- **Clear security schemes and servers** (observed). Every spec declares both `x-api-key` and `apiKey` and both the default and EU servers, so a generated client is configured once.
- **Routing's `waypoints` declares its real wire format** (observed): `style: pipeDelimited, explode: false`. The spec is right; see the generator note below.

## OpenAPI specs

1. **`PlacesPostRequest` loses its type in generated TypeScript** (observed). The "filter or bias" rule is written as `anyOf: [{ required: ["filter"] }, { required: ["bias"] }]` on an object schema. openapi-typescript 7.13.0 renders that as `{ ...properties } | unknown | unknown`, so the request body accepts anything and type checking of the body is lost. `StaticMapRequest` has the same pattern with five `required` branches and becomes `{ ... } | unknown x5`. A shape generators handle, such as `oneOf` of two complete object schemas (one with `filter` required, one with `bias`), or keeping the rule in the description and a validator, would keep the types. We typed our one body shape by hand from the generated parts (`src/lib/geoapify/client.ts`).

2. **`PlaceDetailValue` generates TypeScript that does not compile** (observed). The schema is a valid recursive `oneOf` (string, number, boolean, null, array of itself, map of itself). openapi-typescript 7.13.0 emits it as a property of the `components` interface that references itself, and `tsc` 5 fails with TS2502 ("referenced directly or indirectly in its own type annotation"). The spec is valid, so this is a generator limitation, but since Geoapify's own article recommends openapi-typescript, a note in the guide (or a non-recursive `PlaceDetailValue`) would save people a failed build. Our generator script patches it to a top-level recursive type alias.

3. **Discriminator mapping points at a `oneOf`** (observed). In `PlacesFilter`, the discriminator maps `polyline` to `PlacesPolylineFilter`, which is itself a `oneOf` of the raw and encoded polyline filters. openapi-typescript warns: `Discriminator mapping has an invalid schema (neither an object schema nor an allOf array)`. The generated union is still usable. Mapping `polyline` directly to the two concrete schemas is not possible with one discriminator value, so a small restructure (for example, one polyline schema whose `geometry` is a `oneOf` of line object and encoded string) would make it clean.

4. **Defaults become required fields in openapi-typescript's default mode** (observed). Request fields with a `default`, such as `limit`, `offset`, and `lang` on `PlacesPostRequest`, or `zoom`, `width`, `height` on `StaticMapRequest`, come out as required unless you pass `--default-non-nullable=false`. Worth one line in the [client generation guide](https://apidocs.geoapify.com/how-to/api-tooling-ai/generate-openapi-clients-sdks/).

5. **`pipeDelimited` arrays and type-only clients** (observed). openapi-fetch builds requests from types, not from the spec's parameter styles, so by default it sends `waypoints=a&waypoints=b`. Our test checks that we send one `waypoints=lat,lon|lat,lon` after setting `querySerializer: { array: { style: "pipeDelimited", explode: false } }`. Live on Oct 22, 2026, the Routing API accepted both forms and returned the same two waypoints, so the default is forgiving. The spec could say so, or the docs could note that repeated parameters also work.

6. **Coordinate order changes between APIs** (observed in spec). Routing `waypoints` are `latitude,longitude`; Places filters and GeoJSON are `[longitude, latitude]`; the MCP tools use named `lat` and `lon` (the clearest of the three). The routing description says it plainly, which helped; a short "coordinate order" box across the docs would catch more people.

7. **No highway rest area category** (observed in spec, and live on Oct 22, 2026). The `PlaceCategory` enum in Places 2.2.1 has 833 values and none for a highway rest area or service area. The live `list_place_categories` tool also returns 833 categories, and the only rest-like ones are `amenity.toilet` (and `.changing_table`), `building.toilet`, and the `leisure.picnic.*` family. For "rest" stops we used `amenity.toilet` and `leisure.picnic.picnic_site`. For road-trip use, a `highway.rest_area` (or similar) category would be valuable.

8. **Response types are a union of every media type** (observed). The geocoding and routing 200 responses list GeoJSON, JSON, and XML bodies, so the generated success type is their union even when the request sets `format=json`. That is correct OpenAPI, but callers must narrow by hand. Not a bug; worth a sentence in the generation guide.

## MCP tools

1. **Four tool input schemas are not `type: "object"` in the published specs** (observed in the specs and in a test; the live server is fine). In the focused MCP tool specs, `combine_geometries`, `evaluate_spatial_relation`, `measure_geometry`, and `transform_geometry` have an input schema that is a top-level `oneOf` with no `type`. The MCP specification requires a tool's `inputSchema` to be an object schema, and the official TypeScript client (`@modelcontextprotocol/client` 2.3.1) rejects the whole `tools/list` response with `Invalid input: expected "object"` at `tools[n].inputSchema.type`. We hit this when our sample server served the schemas verbatim. OpenAI-style function calling also expects `type: "object"` at the top. Adding `"type": "object"` beside the `oneOf` fixes both. Live on Oct 22, 2026, the server's `tools/list` (11 tools) sends `"type": "object"` on all of them, and the official client accepts the list, so only the files in `geoapify-openapi-specs` lag behind the server. Places Along still normalizes schemas, in case a client reads the files.

2. **`search_places` takes one category and one point** (observed in spec). There is no categories list and no polyline or along-route filter, although the Places API has both. A route question therefore costs stops x categories calls over MCP (8 for our sample) against stops over REST (4). Accepting `categories` as an array, and a `polyline` filter with a buffer, would make the MCP tool match the API's best feature.

3. **Route geometry has to travel through the model** (observed in spec design). `calculate_route` returns the full geometry, and `measure_geometry` needs it passed back as an argument. In a chat client the model must copy hundreds of coordinates between calls. Two ideas: let tools accept a reference to an earlier result, or add a route-sampling option (for example, "points every N km along the route") to `calculate_route`. Places Along works around it by swapping geometry for a `{"ref":"route"}` handle in what the model sees.

4. **Discovery needs a key** (observed with curl, Oct 21, 2026). `initialize` and `tools/list` without a key return HTTP 401 `{"statusCode":401,"error":"Unauthorized","message":"Invalid apiKey"}`. The docs say both cost zero credits; allowing them without a key would let MCP clients, registries, and reviewers see the tool schemas before signing up.

5. **`calculate_route` returns a `MultiLineString`, and `measure_geometry` `along` refuses one** (observed live, Oct 22, 2026). With `geometry_format: "geojson"`, the route geometry is a `MultiLineString` with one part. Passing it straight to `measure_geometry` with `operation: "along"` fails with HTTP 400 `geometry.type must be one of LineString`. So the obvious two-step plan (route, then points along the route) breaks unless the client flattens the geometry first, and a model in a chat client has no way to do that. Either accepting a single-part `MultiLineString` in `along`, or naming the geometry type in `calculate_route`'s output schema (and offering `LineString` output), would fix it. Places Along flattens the route before every `along` call.

6. **`search_places` results do not match their own output schema** (observed live, Oct 22, 2026). All 11 tools now publish an `outputSchema`, and the official TypeScript client checks every structured result against it once it has read `tools/list`. EV charging results fail that check: for a search near Salina, KS, the client reported `data/results/0/ele must be string, data/results/0/ref_other/plugshare must be string, data/results/2/ref must be string`. The OpenStreetMap tags arrive as numbers where the schema says string. The client turns that into a hard error, so any MCP client that validates loses the whole call. Loosening those fields to `["string", "number"]` (or leaving raw OSM tags untyped) would fix it. Places Along now runs the same check but only reports the mismatch in its trace and keeps the result.

7. **Top-level `oneOf` schemas confuse free models** (observed live with OpenRouter free models, Oct 22, 2026). Even with `"type": "object"` present, a model given `measure_geometry`'s eight-branch `oneOf` sent `geometry` as a JSON string (`"{\"ref\": \"route\"}"`) and `distance` as a string (`"235992"`), and the server rejected all six calls with `geometry must be a GeoJSON geometry object`. Giving the model only the `along` branch, as a flat object schema with Geoapify's own descriptions, fixed it on the next run. Splitting multi-operation tools into one tool per operation (for example `measure_along`) would help every client, not just ours. Places Along also parses JSON-in-a-string arguments and numeric strings before calling.

8. **The server always answers protocol version `2025-06-18`** (observed live, Oct 22, 2026). `initialize` requests for `2024-11-05`, `2025-06-18`, and `2025-11-25` all got `protocolVersion: "2025-06-18"` back (server `geoapify-api-gateway-mcp` 0.1.0). The 2.3.1 TypeScript client accepts that and works. This matches the docs; we note it so client authors know newer protocol features are not available yet.

9. **No usage or rate-limit headers** (observed live, Oct 22, 2026). Neither the REST APIs nor the MCP endpoint return headers such as `X-RateLimit-Remaining` or credits used. With a 3,000 requests a day free plan, an app that wants to stay under it has to count its own calls, which is what Places Along does. A remaining-credits header would make that exact.

## Live run numbers (Oct 22, 2026)

From `pnpm smoke` on the sample trip (Lawrence, KS to Denver, CO, coffee and EV charging every two hours; 567 mi, 7 h 44 min, 3 stops):

- **Direct path**: 6 requests (2 geocodes, 1 route, 3 `POST /v2/places`), about 4 to 6 s end to end, 6 of 6 stop slots filled. Each Places polyline request (3 km buffer, `limit: 500`) returned places spread across its whole 190 km stretch of road, all within the buffer (farthest 1.5 km off the line), so the polyline filter does what the spec says.
- **Agent path, scripted driver**: 12 MCP tool calls (2 geocodes, 1 route, 3 `along`, 6 searches), about 5 s, 4 of 6 slots filled. The gap is the tool shape in MCP 2: `search_places` searches a circle around one point, so a cafe 60 km down the road from the stop point is out of reach, while the REST polyline filter covers the whole stretch.
- **Agent path, model driver** (OpenRouter free models, local run only): the tool calls work after the fixes above, but free models took 45 to 70 s per run and sometimes timed out before a final answer. The hosted demo therefore uses the scripted driver.

## Unverified

- How many credits each run used. The API returns no usage headers (MCP 9) and we did not open the project dashboard, so we count requests, not credits.
- The model driver with paid or larger models. We only tried free OpenRouter models.
- The EU server, Static Maps, and every MCP tool we did not call (`geocode_structured_address`, `reverse_geocode_coordinates`, `calculate_route_matrix`, `combine_geometries`, `evaluate_spatial_relation`, `transform_geometry`).
