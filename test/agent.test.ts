import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, forModel, runAgent } from "@/lib/agent";
import type { ChatMessage, ToolChat } from "@/lib/llm";
import { connectGeoapifyMcp, rawToolsList } from "@/lib/mcp/connect";
import { sampleMcpFetch } from "@/lib/mcp/sample-server";
import { parseTrip } from "@/lib/parse";
import { SAMPLE_QUESTION } from "@/lib/sample";
import type { Trip } from "@/lib/types";
import { readFileSync } from "node:fs";

const trip = (parseTrip(SAMPLE_QUESTION) as { ok: true; trip: Trip }).trip;
const systemPrompt = readFileSync("prompts/agent-system.md", "utf8");

describe("MCP session (official client against the sample server)", () => {
  it("lists Geoapify's eleven tools with their published input schemas", async () => {
    const mcp = await connectGeoapifyMcp(null);
    const tools = await mcp.tools();
    expect(tools.map((t) => t.name).sort()).toContain("search_places");
    expect(tools).toHaveLength(11);
    for (const name of AGENT_TOOLS) expect(tools.find((t) => t.name === name)?.inputSchema).toBeTruthy();
    const search = tools.find((t) => t.name === "search_places")!;
    expect((search.inputSchema as { required: string[] }).required).toEqual(["category", "lat", "lon"]);
    await mcp.close();
  });

  it("can read tools/list directly and normalize every input schema to an object", async () => {
    const tools = await rawToolsList(null, sampleMcpFetch);
    expect(tools).toHaveLength(11);
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
  });
});

describe("agent path", () => {
  it("scripted driver: every stop is backed by a search_places result in the trace", async () => {
    const mcp = await connectGeoapifyMcp(null);
    const r = await runAgent({ question: SAMPLE_QUESTION, trip, mcp, data: "sample", chat: null, systemPrompt });
    await mcp.close();
    expect(r.error).toBeUndefined();
    expect(r.driver).toBe("scripted");
    const names = r.trace.map((t) => t.name);
    expect(names.slice(0, 3)).toEqual(["geocode_address", "geocode_address", "calculate_route"]);
    expect(names.filter((n) => n === "measure_geometry")).toHaveLength(4);
    expect(names.filter((n) => n === "search_places")).toHaveLength(8);
    expect(r.stops.length).toBeGreaterThan(0);
    const traced = JSON.stringify(r.trace);
    expect(r.trace.every((t) => t.ok)).toBe(true);
    expect(traced).not.toMatch(/apiKey|x-api-key/i);
  });

  it("model driver: runs the model's tool calls, resolves the route reference, drops invented stops", async () => {
    const mcp = await connectGeoapifyMcp(null);
    const seen: ChatMessage[][] = [];
    let turn = 0;
    let placeId = "";
    const chat: ToolChat = async (messages) => {
      seen.push([...messages]);
      turn++;
      const call = (id: string, name: string, args: object) => ({ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });
      if (turn === 1) return { content: null, model: "fake/model", toolCalls: [call("a", "geocode_address", { query: "Lawrence, KS" }), call("b", "geocode_address", { query: "Denver, CO" })] };
      if (turn === 2) return { content: null, model: "fake/model", toolCalls: [call("c", "calculate_route", { waypoints: [{ lat: 38.97191, lon: -95.23594 }, { lat: 39.73924, lon: -104.98486 }], mode: "drive" })] };
      if (turn === 3) return { content: null, model: "fake/model", toolCalls: [call("d", "measure_geometry", { operation: "along", geometry: { ref: "route" }, distance: 370, units: "kilometers" })] };
      if (turn === 4) {
        const pt = JSON.parse((messages.at(-1) as { content: string }).content) as { lat: number; lon: number };
        return { content: null, model: "fake/model", toolCalls: [call("e", "search_places", { category: "catering.cafe", lat: pt.lat, lon: pt.lon, radius_meters: 20000, limit: 20 })] };
      }
      const found = JSON.parse((messages.at(-1) as { content: string }).content) as { results: { place_id: string; name: string }[] };
      placeId = found.results[0].place_id;
      return { content: JSON.stringify({ stops: [{ n: 1, category: "coffee", place_id: placeId, name: found.results[0].name }, { n: 1, category: "charging", place_id: "made-up", name: "Imaginary Chargers" }] }), model: "fake/model", toolCalls: [] };
    };
    const r = await runAgent({ question: SAMPLE_QUESTION, trip, mcp, data: "sample", chat, systemPrompt });
    await mcp.close();
    expect(r.error).toBeUndefined();
    expect(r.note).toBeUndefined();
    expect(r.driver).toBe("fake/model");
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0].picks.map((p) => p.place.id)).toEqual([placeId]);
    expect(r.stops[0].missing).toEqual(["charging"]);
    expect(r.unsupported).toEqual(["Imaginary Chargers"]);
    // The model saw a reference, not 200 coordinates.
    const routeReply = seen[2].at(-1) as { content: string };
    expect(routeReply.content).toContain('"ref":"route"');
    expect(routeReply.content.length).toBeLessThan(400);
  });

  it("falls back to the planner, and says so, when the model answer is unusable", async () => {
    const mcp = await connectGeoapifyMcp(null);
    let turn = 0;
    const chat: ToolChat = async () => {
      turn++;
      if (turn === 1) return { content: null, model: "fake/model", toolCalls: [{ id: "a", type: "function", function: { name: "calculate_route", arguments: JSON.stringify({ waypoints: [{ lat: 38.97191, lon: -95.23594 }, { lat: 39.73924, lon: -104.98486 }] }) } }] };
      return { content: "Sorry, I am not sure.", model: "fake/model", toolCalls: [] };
    };
    const r = await runAgent({ question: SAMPLE_QUESTION, trip, mcp, data: "sample", chat, systemPrompt });
    await mcp.close();
    expect(r.note).toMatch(/shared planner/);
    expect(r.route).not.toBeNull();
  });

  it("shows the model only the useful part of a search result", () => {
    const s = { category: "catering.cafe", count: 1, results: [{ place_id: "p1", name: "Cafe", formatted: "Cafe, Main St", lat: 1, lon: 2, distance: 30, website: "x", opening_hours: "y" }] };
    expect(JSON.parse(forModel("search_places", true, s, ""))).toEqual({ category: "catering.cafe", count: 1, results: [{ place_id: "p1", name: "Cafe", formatted: "Cafe, Main St", lat: 1, lon: 2, distance: 30 }] });
  });
});
