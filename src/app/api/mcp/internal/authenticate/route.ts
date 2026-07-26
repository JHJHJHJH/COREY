import { isMcpServiceRequest, noStoreJson } from "@/server/mcp-admin";
import { authenticateMcpCredential } from "@/server/mcp-settings-store";

export async function POST(request: Request) {
  if (!isMcpServiceRequest(request)) {
    return noStoreJson({ error: "Invalid MCP service credentials." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const auth = token ? await authenticateMcpCredential(token) : null;
  return auth
    ? noStoreJson(auth)
    : noStoreJson({ error: "The MCP credential is invalid or disabled." }, { status: 401 });
}
