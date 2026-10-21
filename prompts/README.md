# Prompts and agent instructions

| File | Used by | Purpose |
| --- | --- | --- |
| [`agent-system.md`](agent-system.md) | The app's agent path (`src/lib/run.ts` loads it) | System prompt for the model that drives the Geoapify MCP tools. `{{categories}}` is filled in from `src/lib/types.ts`. |
| [`client-prompts.md`](client-prompts.md) | People using Cursor or Claude Code | The exact prompts from the tutorial, for a Geoapify MCP connection in an AI client. |
| [`build-brief.md`](build-brief.md) | The coding agent that built this repo | The brief it worked from, condensed. |
