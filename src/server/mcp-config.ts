const MIN_BRIDGE_SECRET_LENGTH = 32;

function validUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).toString();
  } catch {
    return null;
  }
}

export function getMcpBridgeUrl() {
  return validUrl(process.env.COREY_MCP_BRIDGE_URL);
}

export function getMcpBridgeSecret() {
  const value = process.env.COREY_MCP_BRIDGE_SECRET?.trim() ?? "";
  return value.length >= MIN_BRIDGE_SECRET_LENGTH ? value : null;
}

export function isMcpBridgeConfigured() {
  return Boolean(getMcpBridgeUrl() && getMcpBridgeSecret());
}

export function getMcpPublicUrl() {
  const configured = validUrl(process.env.COREY_MCP_PUBLIC_URL);
  if (configured) return configured;
  const bridgeUrl = getMcpBridgeUrl();
  if (!bridgeUrl) return null;
  const derived = new URL(bridgeUrl);
  derived.protocol = derived.protocol === "wss:" ? "https:" : "http:";
  derived.pathname = derived.pathname.replace(/\/bridge\/?$/, "/mcp");
  derived.search = "";
  derived.hash = "";
  return derived.toString();
}

export function getMcpAppPublicUrl() {
  return validUrl(process.env.COREY_APP_PUBLIC_URL) ?? "http://localhost:4000/";
}

export function getMcpInternalUrl() {
  const configured = validUrl(process.env.COREY_MCP_INTERNAL_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const publicUrl = getMcpPublicUrl();
  return publicUrl ? new URL("/", publicUrl).toString().replace(/\/+$/, "") : null;
}

export function isMcpDeploymentConfigured() {
  return Boolean(
    isMcpBridgeConfigured() &&
      getMcpPublicUrl() &&
      getMcpAppPublicUrl() &&
      getMcpInternalUrl(),
  );
}
