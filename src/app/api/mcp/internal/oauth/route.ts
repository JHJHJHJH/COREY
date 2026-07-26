import type { CoreyMcpOAuthClient } from "@/features/viewer/mcp/settings-contracts";
import { isMcpServiceRequest, noStoreJson } from "@/server/mcp-admin";
import {
  exchangeMcpOauthCode,
  getMcpOauthClient,
  getMcpOauthCodeChallenge,
  refreshMcpOauthToken,
  registerMcpOauthClient,
  revokeMcpOauthToken,
  startMcpOauthAuthorization,
} from "@/server/mcp-settings-store";

export async function POST(request: Request) {
  if (!isMcpServiceRequest(request)) {
    return noStoreJson({ error: "Invalid MCP service credentials." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    switch (body?.action) {
      case "getClient":
        return noStoreJson({
          client: await getMcpOauthClient(String(body.clientId ?? "")),
        });
      case "registerClient":
        return noStoreJson({
          client: await registerMcpOauthClient(body.client as CoreyMcpOAuthClient),
        });
      case "startAuthorization":
        return noStoreJson({
          requestId: await startMcpOauthAuthorization(
            body.input as Parameters<typeof startMcpOauthAuthorization>[0],
          ),
        });
      case "challenge":
        return noStoreJson({
          challenge: await getMcpOauthCodeChallenge(
            String(body.clientId ?? ""),
            String(body.code ?? ""),
          ),
        });
      case "exchangeCode":
        return noStoreJson({
          tokens: await exchangeMcpOauthCode(
            body.input as Parameters<typeof exchangeMcpOauthCode>[0],
          ),
        });
      case "refresh":
        return noStoreJson({
          tokens: await refreshMcpOauthToken(
            body.input as Parameters<typeof refreshMcpOauthToken>[0],
          ),
        });
      case "revoke":
        await revokeMcpOauthToken(String(body.token ?? ""));
        return noStoreJson({ ok: true });
      default:
        return noStoreJson({ error: "Unknown OAuth backend action." }, { status: 400 });
    }
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : "OAuth backend request failed." },
      { status: 400 },
    );
  }
}
