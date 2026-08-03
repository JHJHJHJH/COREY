import { getDefaultUserId } from "@/server/env";
import { getUserIdOrResponse } from "@/server/identity";
import { getMcpBridgeUrl } from "@/server/mcp-config";
import { isMcpEnabled } from "@/server/mcp-settings-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;
  const enabled = userId === getDefaultUserId() && (await isMcpEnabled());
  return Response.json({
    enabled,
    bridgeUrl: enabled ? getMcpBridgeUrl() : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
