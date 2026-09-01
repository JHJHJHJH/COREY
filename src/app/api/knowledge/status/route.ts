import { getUserIdOrResponse } from "@/server/identity";
import { getKnowledgeStatus } from "@/server/knowledge-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;
  return Response.json(await getKnowledgeStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
