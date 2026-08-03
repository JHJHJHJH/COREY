import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CoreyMcpCredentialInfo,
  CoreyMcpOAuthClient,
  CoreyMcpOAuthTokens,
  CoreyMcpSettings,
  CoreyMcpSettingsMutation,
} from "@/features/viewer/mcp/settings-contracts";
import { prisma } from "@/server/db";
import { getDefaultUserId } from "@/server/env";
import {
  getMcpAppPublicUrl,
  getMcpPublicUrl,
  isMcpDeploymentConfigured,
} from "@/server/mcp-config";

const CONFIG_ID = "deployment";
const MCP_SCOPE = "corey:mcp";
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function secret(prefix: string) {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseClient(value: unknown): CoreyMcpOAuthClient | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const clientId = typeof input.client_id === "string" ? input.client_id : "";
  const redirectUris = jsonStrings(input.redirect_uris);
  if (!clientId || redirectUris.length === 0) return null;
  return {
    client_id: clientId,
    client_id_issued_at:
      typeof input.client_id_issued_at === "number" ? input.client_id_issued_at : undefined,
    client_name: typeof input.client_name === "string" ? input.client_name : undefined,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: jsonStrings(input.grant_types),
    response_types: jsonStrings(input.response_types),
    scope: typeof input.scope === "string" ? input.scope : undefined,
  };
}

async function configRow() {
  return prisma.mcpDeploymentConfig.findUnique({ where: { id: CONFIG_ID } });
}

function settingsFromRow(
  row: Awaited<ReturnType<typeof configRow>>,
): CoreyMcpSettings {
  const deploymentReady = isMcpDeploymentConfigured();
  return {
    deploymentReady,
    enabled: deploymentReady && Boolean(row?.enabled),
    hasApiKey: Boolean(row?.apiKeyHash),
    apiKeyHint: row?.apiKeyHint ?? null,
    apiKeyRotatedAt: row?.apiKeyRotatedAt?.toISOString() ?? null,
    mcpUrl: getMcpPublicUrl(),
    appUrl: getMcpAppPublicUrl(),
    oauthAvailable: deploymentReady,
  };
}

export async function getMcpSettings() {
  return settingsFromRow(await configRow());
}

async function writeApiKey(enabled?: boolean): Promise<CoreyMcpSettingsMutation> {
  const apiKey = secret("corey_mcp_");
  const apiKeyRotatedAt = new Date();
  const row = await prisma.mcpDeploymentConfig.upsert({
    where: { id: CONFIG_ID },
    create: {
      id: CONFIG_ID,
      enabled: enabled ?? false,
      apiKeyHash: digest(apiKey),
      apiKeyHint: apiKey.slice(-6),
      apiKeyRotatedAt,
    },
    update: {
      ...(enabled === undefined ? {} : { enabled }),
      apiKeyHash: digest(apiKey),
      apiKeyHint: apiKey.slice(-6),
      apiKeyRotatedAt,
    },
  });
  return { settings: settingsFromRow(row), apiKey };
}

export async function setMcpEnabled(enabled: boolean): Promise<CoreyMcpSettingsMutation> {
  if (enabled && !isMcpDeploymentConfigured()) {
    throw new Error("The MCP deployment URLs and shared bridge secret are not configured.");
  }
  const existing = await configRow();
  if (enabled && !existing?.apiKeyHash) return writeApiKey(true);
  const row = await prisma.mcpDeploymentConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, enabled },
    update: { enabled },
  });
  return { settings: settingsFromRow(row) };
}

export async function rotateMcpApiKey() {
  return writeApiKey();
}

export async function isMcpEnabled() {
  const row = await configRow();
  return isMcpDeploymentConfigured() && Boolean(row?.enabled);
}

export async function registerMcpOauthClient(input: CoreyMcpOAuthClient) {
  if (
    !input ||
    typeof input.client_id !== "string" ||
    !input.client_id ||
    !Array.isArray(input.redirect_uris) ||
    input.redirect_uris.length === 0
  ) {
    throw new Error("Invalid OAuth client metadata.");
  }
  const client: CoreyMcpOAuthClient = {
    client_id: input.client_id,
    client_id_issued_at: input.client_id_issued_at,
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: input.scope,
  };
  await prisma.mcpOAuthClient.upsert({
    where: { id: client.client_id },
    create: {
      id: client.client_id,
      metadata: client as unknown as Prisma.InputJsonValue,
    },
    update: { metadata: client as unknown as Prisma.InputJsonValue },
  });
  return client;
}

export async function getMcpOauthClient(clientId: string) {
  const row = await prisma.mcpOAuthClient.findUnique({ where: { id: clientId } });
  return row ? parseClient(row.metadata) : null;
}

export async function startMcpOauthAuthorization(input: {
  clientId: string;
  redirectUri: string;
  state?: string;
  scopes: string[];
  codeChallenge: string;
  resource?: string;
}) {
  if (!(await isMcpEnabled())) throw new Error("MCP access is disabled.");
  const row = await prisma.mcpOAuthAuthorization.create({
    data: {
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      state: input.state,
      scopes: [MCP_SCOPE],
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      expiresAt: new Date(Date.now() + AUTHORIZATION_TTL_MS),
    },
  });
  return row.id;
}

export async function getMcpOauthConsent(requestId: string) {
  const row = await prisma.mcpOAuthAuthorization.findUnique({
    where: { id: requestId },
    include: { client: true },
  });
  if (!row || row.expiresAt <= new Date() || row.approvedAt || row.consumedAt) return null;
  return {
    requestId: row.id,
    clientName: parseClient(row.client.metadata)?.client_name ?? "MCP client",
    redirectUri: row.redirectUri,
    scopes: jsonStrings(row.scopes),
  };
}

export async function completeMcpOauthConsent(requestId: string, approved: boolean) {
  const row = await prisma.mcpOAuthAuthorization.findUnique({ where: { id: requestId } });
  if (!row || row.expiresAt <= new Date() || row.approvedAt || row.consumedAt) return null;
  if (!approved) {
    await prisma.mcpOAuthAuthorization.delete({ where: { id: requestId } });
    return { approved: false as const, redirectUri: row.redirectUri, state: row.state };
  }
  const code = secret("corey_ac_");
  const updated = await prisma.mcpOAuthAuthorization.update({
    where: { id: requestId },
    data: { approvedAt: new Date(), codeHash: digest(code) },
  });
  return {
    approved: true as const,
    code,
    redirectUri: updated.redirectUri,
    state: updated.state,
  };
}

export async function getMcpOauthCodeChallenge(clientId: string, code: string) {
  const row = await prisma.mcpOAuthAuthorization.findUnique({
    where: { codeHash: digest(code) },
  });
  if (!row || row.clientId !== clientId || !row.approvedAt || row.consumedAt || row.expiresAt <= new Date()) {
    return null;
  }
  return row.codeChallenge;
}

function tokenValues(scopes: string[], resource?: string | null) {
  const accessToken = secret("corey_at_");
  const refreshToken = secret("corey_rt_");
  return {
    accessToken,
    refreshToken,
    accessTokenHash: digest(accessToken),
    refreshTokenHash: digest(refreshToken),
    scopes: scopes.length > 0 ? scopes : [MCP_SCOPE],
    resource: resource ?? null,
    accessExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  };
}

function oauthResponse(values: ReturnType<typeof tokenValues>): CoreyMcpOAuthTokens {
  return {
    access_token: values.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: values.refreshToken,
    scope: values.scopes.join(" "),
  };
}

export async function exchangeMcpOauthCode(input: {
  clientId: string;
  code: string;
  redirectUri?: string;
  resource?: string;
}) {
  if (!(await isMcpEnabled())) return null;
  const row = await prisma.mcpOAuthAuthorization.findUnique({
    where: { codeHash: digest(input.code) },
  });
  if (
    !row ||
    row.clientId !== input.clientId ||
    !row.approvedAt ||
    row.consumedAt ||
    row.expiresAt <= new Date() ||
    (input.redirectUri && input.redirectUri !== row.redirectUri) ||
    (input.resource && input.resource !== row.resource)
  ) {
    return null;
  }
  const values = tokenValues(jsonStrings(row.scopes), row.resource);
  const consumed = await prisma.mcpOAuthAuthorization.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) return null;
  await prisma.mcpOAuthToken.create({
    data: {
      clientId: row.clientId,
      accessTokenHash: values.accessTokenHash,
      refreshTokenHash: values.refreshTokenHash,
      scopes: values.scopes,
      resource: values.resource,
      accessExpiresAt: values.accessExpiresAt,
      refreshExpiresAt: values.refreshExpiresAt,
    },
  });
  return oauthResponse(values);
}

export async function refreshMcpOauthToken(input: {
  clientId: string;
  refreshToken: string;
  scopes?: string[];
  resource?: string;
}) {
  if (!(await isMcpEnabled())) return null;
  const row = await prisma.mcpOAuthToken.findUnique({
    where: { refreshTokenHash: digest(input.refreshToken) },
  });
  const currentScopes = row ? jsonStrings(row.scopes) : [];
  const requestedScopes = input.scopes?.length ? input.scopes : currentScopes;
  if (
    !row ||
    row.clientId !== input.clientId ||
    row.revokedAt ||
    row.refreshExpiresAt <= new Date() ||
    requestedScopes.some((scope) => !currentScopes.includes(scope)) ||
    (input.resource && input.resource !== row.resource)
  ) {
    return null;
  }
  const values = tokenValues(requestedScopes, row.resource);
  const rotated = await prisma.mcpOAuthToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (rotated.count !== 1) return null;
  await prisma.mcpOAuthToken.create({
    data: {
      clientId: row.clientId,
      accessTokenHash: values.accessTokenHash,
      refreshTokenHash: values.refreshTokenHash,
      scopes: values.scopes,
      resource: values.resource,
      accessExpiresAt: values.accessExpiresAt,
      refreshExpiresAt: values.refreshExpiresAt,
    },
  });
  return oauthResponse(values);
}

export async function revokeMcpOauthToken(token: string) {
  const tokenHash = digest(token);
  await prisma.mcpOAuthToken.updateMany({
    where: {
      revokedAt: null,
      OR: [{ accessTokenHash: tokenHash }, { refreshTokenHash: tokenHash }],
    },
    data: { revokedAt: new Date() },
  });
}

export async function authenticateMcpCredential(
  token: string,
): Promise<CoreyMcpCredentialInfo | null> {
  const config = await configRow();
  if (!config?.enabled || !isMcpDeploymentConfigured()) return null;
  const tokenHash = digest(token);
  if (config.apiKeyHash === tokenHash) {
    return {
      userId: getDefaultUserId(),
      clientId: "corey-api-key",
      scopes: [MCP_SCOPE],
      expiresAt: 253402300799,
    };
  }
  const oauth = await prisma.mcpOAuthToken.findUnique({
    where: { accessTokenHash: tokenHash },
  });
  if (!oauth || oauth.revokedAt || oauth.accessExpiresAt <= new Date()) return null;
  return {
    userId: getDefaultUserId(),
    clientId: oauth.clientId,
    scopes: jsonStrings(oauth.scopes),
    expiresAt: Math.floor(oauth.accessExpiresAt.getTime() / 1000),
  };
}
