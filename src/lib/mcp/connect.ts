import { Client, StreamableHTTPClientTransport, type JsonSchemaValidator, type jsonSchemaValidator } from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { asObjectSchema, sampleMcpFetch } from "./sample-server";

export const GEOAPIFY_MCP_URL = "https://api.geoapify.com/v1/mcp";

export interface McpTool { name: string; description?: string; inputSchema: Record<string, unknown> }
export interface McpOutcome {
  ok: boolean;
  structured: Record<string, unknown> | null;
  text: string;
  ms: number;
  /** Set when the result did not match the tool's published outputSchema. The result is still used. */
  schemaMismatch?: string;
}

/**
 * The official client checks every structured result against the tool's outputSchema once it has
 * seen tools/list. Live on Oct 22, 2026, Geoapify's search_places results broke their own schema
 * (fields such as ref, ele and ref_other.* declared as strings arrive as numbers), which the
 * client turns into a hard error. This validator runs the same Ajv check, records what failed,
 * and lets the result through, so the mismatch shows in the trace instead of killing the run.
 */
class ReportingValidator implements jsonSchemaValidator {
  private inner = new AjvJsonSchemaValidator();
  last: string | null = null;
  getValidator<T>(schema: Parameters<jsonSchemaValidator["getValidator"]>[0]): JsonSchemaValidator<T> {
    const check = this.inner.getValidator<T>(schema);
    return (input: unknown): ReturnType<JsonSchemaValidator<T>> => {
      const r = check(input);
      if (!r.valid) this.last = r.errorMessage;
      return { valid: true as const, data: input as T, errorMessage: undefined };
    };
  }
}
export interface McpSession {
  tools(): Promise<McpTool[]>;
  call(name: string, args: Record<string, unknown>): Promise<McpOutcome>;
  close(): Promise<void>;
}

/**
 * Opens an MCP session with Geoapify through the official MCP TypeScript client over Streamable
 * HTTP. The key goes in the x-api-key header (Geoapify has no OAuth). Without a key, the same
 * client talks to the in-process sample server instead.
 */
export async function connectGeoapifyMcp(apiKey: string | null, fetchImpl?: typeof fetch): Promise<McpSession> {
  const transport = new StreamableHTTPClientTransport(new URL(GEOAPIFY_MCP_URL), {
    requestInit: { headers: apiKey ? { "x-api-key": apiKey } : {} },
    fetch: fetchImpl ?? (apiKey ? fetch : sampleMcpFetch),
  });
  const validator = new ReportingValidator();
  const client = new Client({ name: "places-along", version: "0.1.0" }, { jsonSchemaValidator: validator });
  await client.connect(transport);
  return {
    async tools() {
      try {
        const { tools } = await client.listTools();
        return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> }));
      } catch (err) {
        // The official client rejects a tools/list response whose input schemas are not
        // `type: "object"` (four of Geoapify's published schemas are a bare oneOf). If that
        // happens live, read the list directly and normalize it. See FEEDBACK.md.
        console.warn("[places-along] listTools failed, reading tools/list directly:", err instanceof Error ? err.message : err);
        return rawToolsList(apiKey, fetchImpl ?? (apiKey ? fetch : sampleMcpFetch));
      }
    },
    async call(name, args) {
      const started = Date.now();
      validator.last = null;
      try {
        const r = await client.callTool({ name, arguments: args });
        const text = (r.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? "";
        let structured = (r.structuredContent as Record<string, unknown> | undefined) ?? null;
        if (!structured && text.startsWith("{")) structured = JSON.parse(text) as Record<string, unknown>;
        const schemaMismatch = validator.last ?? undefined;
        return { ok: !r.isError, structured, text, ms: Date.now() - started, ...(schemaMismatch ? { schemaMismatch } : {}) };
      } catch (err) {
        return { ok: false, structured: null, text: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
      }
    },
    close: () => client.close(),
  };
}

/** tools/list as a single JSON-RPC request, without the client's schema validation. */
export async function rawToolsList(apiKey: string | null, fetchImpl: typeof fetch): Promise<McpTool[]> {
  const res = await fetchImpl(GEOAPIFY_MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(apiKey ? { "x-api-key": apiKey } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const text = await res.text();
  const body = text.trim().startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}");
  const tools = (JSON.parse(body) as { result?: { tools?: McpTool[] } }).result?.tools ?? [];
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: asObjectSchema(t.inputSchema ?? {}) }));
}
