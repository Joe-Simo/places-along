# Lessons: what needed human guidance

Places Along was built by an AI coding agent working for Joe Simo, from a written brief. This file records, honestly, where a person had to decide or correct something and where the agent worked from the specs alone. It is updated as the project moves to live runs.

## Decided by people, not by the agent

- **The scope.** The first idea included fuel prices. Geoapify's acceptance mail (Oct 21, 2026) asked us to stay on stops along the way: coffee, EV charging, food, and rest. That narrowed the app and the tutorial.
- **What counts as done.** The deliverables (public MIT repo, Vercel demo, README with the key read from an environment variable, tutorial with prompts and lessons, link to geoapify.com) come from the program terms, not from the agent.
- **Keys and publishing.** Joe's standing rules: keys only in environment variables, never in git; the repo stays private until a live run with the program key has been verified; no em dashes anywhere.
- **Honesty about sample data.** The brief required sample mode to be clearly labeled. Every screen that shows it says "Sample data" and names its real sources.

## Worked out from the specs, then corrected by tests

These were found by the agent while building, not by a person, but each needed a correction the first draft did not have:

- **Pipe-delimited waypoints.** The first client sent `waypoints` the way openapi-fetch does by default (`waypoints=a&waypoints=b`). Reading the routing spec's `style: pipeDelimited` led to the explicit serializer, and a test now pins it.
- **MCP schemas that are not objects.** The sample MCP server first served Geoapify's published tool schemas verbatim, and the official MCP client refused the whole tool list. The fix (add `type: "object"`) is in the sample server, the agent harness, and FEEDBACK.md.
- **Generated types that do not compile.** One recursive Places schema produced TypeScript that `tsc` rejects. The generator script now patches it, and fails loudly if the output changes.
- **Context size.** Passing route geometry to the model on every call would waste most of the context. The harness shows the model a `{"ref":"route"}` handle and swaps the real line back in. This came from reading the tool schemas, before any model run.
- **A test that lied.** The first model-driver test searched at a point 190 km in, where the sample data has no cafe within 20 km, and failed for a reason unrelated to the code. Checking the data, not the code, found it.

## Where the agent was blocked and chose a path

- **Sample data source.** The Overpass API was unreachable from the build machine, so sample places come from Nominatim (one request per second, per its usage policy) and the route from the public OSRM demo server. Both are OpenStreetMap based, like Geoapify, and both are named on the page.
- **"Rest" stops.** Geoapify's category list has no highway rest area. The agent chose public toilets and picnic sites and documented the gap rather than guessing a category.

## Key day (Oct 22, 2026): what the live run changed

The program key arrived by email. The agent ran `pnpm smoke`, read the report, and fixed what the live service broke. No person was involved in these fixes; each is recorded in FEEDBACK.md with what was observed.

- **The route had the wrong shape for the next tool.** `calculate_route` returns a `MultiLineString`; `measure_geometry` `along` accepts only a `LineString`. The harness already flattened it, but the smoke check passed it through as is and got a 400, which is how it was found. The sample server now behaves the same way, and a test pins it.
- **The official client rejected real results.** Once the client has read `tools/list`, it validates every result against the tool's `outputSchema`, and EV charging results break Geoapify's own schema. The scripted driver never called `tools/list`, so it worked; the model driver did, and every charging search failed. The fix is a validator that records the mismatch in the trace and keeps the result. Lesson: test both drivers live, not just one.
- **A free model sent strings where the schema wanted objects and numbers.** With `measure_geometry`'s eight-branch `oneOf`, the model sent the geometry as a JSON string and the distance as a string. Showing it only the `along` branch, and tidying arguments before the call, fixed it.
- **The agent's search circle was too small for empty roads.** With a 20 km circle around each stop point, the four-hour stop in western Kansas came back with nothing (no cafe within 20 km at all, and no charger the planner could use). It is now 50 km, which brings in the Oakley Supercharger. The rest of the gap to the direct path is the tool's shape (a circle, not a corridor), and the tutorial and the page say so instead of hiding it.
- **The demo needed a real budget, not a run count.** The daily cap now counts the Geoapify requests the app actually makes (1,000 a day by default, against the free plan's 3,000), plus 12 live runs per visitor a day and a one-hour cache.
- **The hosted agent stays scripted.** Free OpenRouter models took 45 to 70 seconds per run and sometimes timed out, and their daily quota is shared with other projects, so the public demo uses the scripted driver and says so. The model driver works locally.

## Review (Oct 26, 2026): shared counters

Geoapify approved the project and suggested, as optional, that the demo's daily counters move out of memory, since each new Vercel instance started them at zero. The agent added a free Neon Postgres database through the Vercel Marketplace and moved the counters there, with an atomic per-visitor check and a fallback to memory if the database is slow or down. Tests cover both stores and the fallback, and one test ran against the real database: 8 concurrent runs with a limit of 3 let exactly 3 through.

## What was decided without a person, and what still could use one

- **Cursor and Claude Code were not run.** Neither is available on the machine the agent works from, and the agent has no accounts for them. The tutorial says this plainly, keeps the setup steps from Geoapify's guide, and shows real transcripts from the official MCP client and curl instead. Nothing in it claims a Cursor or Claude Code result.
- **Nobody reviewed the live results by hand.** The agent checked them against the trace and against each other (both paths agree on every stop the agent found).
