import { status } from "@/lib/run";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(status());
}
