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

## Still needs a person or a key

- The Geoapify API key for live runs (requested from Geoapify by email on Oct 21, 2026).
- Screenshots and transcripts of the Geoapify MCP server in Cursor and Claude Code, with the key hidden.
- A review of the live results by a person before the repo goes public.
