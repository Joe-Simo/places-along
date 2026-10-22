import { plan } from "@/lib/run";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: unknown; path?: unknown };
  const question = typeof body.question === "string" ? body.question.slice(0, 300) : "";
  const which = body.path === "agent" ? "agent" : body.path === "direct" ? "direct" : null;
  if (!question.trim() || !which) return Response.json({ error: "Send a question and a path (agent or direct)." }, { status: 400 });
  const visitor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const out = await plan(which, question, visitor);
  if ("error" in out) return Response.json({ error: out.error }, { status: out.status });
  return Response.json(out);
}
