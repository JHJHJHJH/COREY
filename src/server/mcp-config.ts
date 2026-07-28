function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getMcpBridgeUrl() {
  return optionalEnv("COREY_MCP_BRIDGE_URL");
}

export function getMcpBridgeSecret() {
  const secret = optionalEnv("COREY_MCP_BRIDGE_SECRET");
  return secret && secret.length >= 32 ? secret : null;
}

export function isMcpBridgeConfigured() {
  return Boolean(getMcpBridgeUrl() && getMcpBridgeSecret());
}
