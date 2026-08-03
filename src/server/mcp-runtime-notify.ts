import { getMcpBridgeSecret, getMcpInternalUrl } from "@/server/mcp-config";

export async function notifyMcpRuntime() {
  const internalUrl = getMcpInternalUrl();
  const secret = getMcpBridgeSecret();
  if (!internalUrl || !secret) return;
  await fetch(`${internalUrl}/internal/reload`, {
    method: "POST",
    headers: { "x-corey-mcp-service-secret": secret },
    cache: "no-store",
  }).catch(() => undefined);
}
