import { getMcpBridgeUrl, isMcpBridgeConfigured } from "@/server/mcp-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    configured: isMcpBridgeConfigured(),
    bridgeUrl: isMcpBridgeConfigured() ? getMcpBridgeUrl() : null,
  });
}
