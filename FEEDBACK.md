# Feedback on Geoapify's OpenAPI specs and MCP tools

Written while building Places Along (Oct 21, 2026). Each item says how we know it:

- **Observed**: we saw it ourselves, in the spec files, in generated code, in a test, or in an HTTP response.
- **Unverified**: an assumption the code makes that still needs a live run with a key. These are listed separately at the end and will be checked on key day.

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

5. **`pipeDelimited` arrays and type-only clients** (observed in our code; server behavior unverified). openapi-fetch builds requests from types, not from the spec's parameter styles, so by default it sends `waypoints=a&waypoints=b`. Our test checks that we send one `waypoints=lat,lon|lat,lon` after setting `querySerializer: { array: { style: "pipeDelimited", explode: false } }`. A note in the routing docs or the generation guide would help. Whether the API also accepts repeated `waypoints` parameters is unverified.

6. **Coordinate order changes between APIs** (observed in spec). Routing `waypoints` are `latitude,longitude`; Places filters and GeoJSON are `[longitude, latitude]`; the MCP tools use named `lat` and `lon` (the clearest of the three). The routing description says it plainly, which helped; a short "coordinate order" box across the docs would catch more people.

7. **No highway rest area category** (observed in spec; live list unverified). The `PlaceCategory` enum in Places 2.2.1 has 833 values and none for a highway rest area or service area. For "rest" stops we used `amenity.toilet` and `leisure.picnic.picnic_site`. For road-trip use, a `highway.rest_area` (or similar) category would be valuable. `pnpm smoke` checks the live `list_place_categories` output for this.

8. **Response types are a union of every media type** (observed). The geocoding and routing 200 responses list GeoJSON, JSON, and XML bodies, so the generated success type is their union even when the request sets `format=json`. That is correct OpenAPI, but callers must narrow by hand. Not a bug; worth a sentence in the generation guide.

## MCP tools

1. **Four tool input schemas are not `type: "object"`** (observed in the specs and in a test). In the focused MCP tool specs, `combine_geometries`, `evaluate_spatial_relation`, `measure_geometry`, and `transform_geometry` have an input schema that is a top-level `oneOf` with no `type`. The MCP specification requires a tool's `inputSchema` to be an object schema, and the official TypeScript client (`@modelcontextprotocol/client` 2.3.1) rejects the whole `tools/list` response with `Invalid input: expected "object"` at `tools[n].inputSchema.type`. We hit this when our sample server served the schemas verbatim. OpenAI-style function calling also expects `type: "object"` at the top. Adding `"type": "object"` beside the `oneOf` fixes both. Whether the live server sends the same schemas is unverified; Places Along normalizes them either way and falls back to a direct `tools/list` if the client rejects the list.

2. **`search_places` takes one category and one point** (observed in spec). There is no categories list and no polyline or along-route filter, although the Places API has both. A route question therefore costs stops x categories calls over MCP (8 for our sample) against stops over REST (4). Accepting `categories` as an array, and a `polyline` filter with a buffer, would make the MCP tool match the API's best feature.

3. **Route geometry has to travel through the model** (observed in spec design). `calculate_route` returns the full geometry, and `measure_geometry` needs it passed back as an argument. In a chat client the model must copy hundreds of coordinates between calls. Two ideas: let tools accept a reference to an earlier result, or add a route-sampling option (for example, "points every N km along the route") to `calculate_route`. Places Along works around it by swapping geometry for a `{"ref":"route"}` handle in what the model sees.

4. **Discovery needs a key** (observed with curl, Oct 21, 2026). `initialize` and `tools/list` without a key return HTTP 401 `{"statusCode":401,"error":"Unauthorized","message":"Invalid apiKey"}`. The docs say both cost zero credits; allowing them without a key would let MCP clients, registries, and reviewers see the tool schemas before signing up.

5. **`calculate_route` geometry type is not pinned down** (observed in spec). The output schema says "Optional route geometry in the requested geometry format" and the input says "GeoJSON geometry object", but not whether it is a `LineString` or `MultiLineString` (the REST API returns `MultiLineString`). Our harness accepts both. Naming the type in the output schema would help clients that validate.

## Unverified until a live run (checked by `pnpm smoke`)

- The live `tools/list` input schemas (item MCP 1) and whether tools also send `outputSchema`.
- Protocol version negotiation between the 2.3.1 client and the server (Geoapify's docs say the endpoint defaults to `2025-06-18`).
- The live shapes of `calculate_route` geometry and `measure_geometry` `along` output (our harness reads a Point, a Feature, or `{type:"geojson", data}`).
- That `POST /v2/places` with a 3 km polyline buffer and `limit: 500` returns places across the whole stretch, not just one end.
- Real latency and credit use per run for each path.
