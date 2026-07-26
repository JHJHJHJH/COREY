import { isMcpServiceRequest, noStoreJson } from "@/server/mcp-admin";
import { isMcpEnabled } from "@/server/mcp-settings-store";

export async function GET(request: Request) {
  if (!isMcpServiceRequest(request)) {
    return noStoreJson({ error: "Invalid MCP service credentials." }, { status: 401 });
  }
  return noStoreJson({ enabled: await isMcpEnabled() });
}
