import { getUserIdOrResponse } from "@/server/identity";
import {
  getMcpBridgeSecret,
  isMcpBridgeConfigured,
} from "@/server/mcp-config";
import { createCoreyMcpBridgeToken } from "@/server/mcp-token";

const SESSION_TOKEN_TTL_SECONDS = 5 * 60;

export async function POST(request: Request) {
  if (!isMcpBridgeConfigured()) {
    return Response.json({ error: "The MCP browser bridge is not configured." }, { status: 503 });
  }
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const body = (await request.json().catch(() => null)) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (!/^[a-zA-Z0-9._-]{8,128}$/.test(sessionId)) {
    return Response.json({ error: "A valid viewer session id is required." }, { status: 400 });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TOKEN_TTL_SECONDS;
  const token = createCoreyMcpBridgeToken(
    { sessionId, userId, exp: expiresAt },
    getMcpBridgeSecret()!,
  );
  return Response.json({ token, expiresAt });
}
