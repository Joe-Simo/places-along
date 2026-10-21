# Vendored Geoapify OpenAPI specs

Copied from [geoapify/geoapify-openapi-specs](https://github.com/geoapify/geoapify-openapi-specs)
at commit `dd07a5f8faafab533b067d5de6edeeda04daa5a3` (Oct 16, 2026). MIT licensed, copyright (c) 2024 Geoapify.

| File | Spec version | Used for |
| --- | --- | --- |
| `forward-geocoding.json` | 1.1.2 | Direct path: `GET /v1/geocode/search` |
| `routing.json` | 1.2.1 | Direct path: `GET /v1/routing` |
| `places.json` | 2.2.1 | Direct path: `POST /v2/places` with a polyline filter |
| `mcp/*.json` | 1.1.2 | Sample mode's `tools/list` (names, descriptions, input schemas) |

`pnpm gen:client` regenerates `src/lib/geoapify/generated/*.ts` and `src/lib/mcp/*.json` from these files.
To refresh, copy the newer files from the upstream repo and run it again.
