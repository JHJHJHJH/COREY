import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { BrowserBridgeRegistry } from "@/mcp/bridge";
import { McpAuthBackend } from "@/mcp/auth-backend";
import { CoreyApiClient } from "@/mcp/corey-api";
import { StoredModelService } from "@/mcp/model-service";
import { createCoreyMcpServer } from "@/mcp/tools";

function numberEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseTrustProxy(value: string | undefined): false | number | string {
  const normalized = value?.trim();
  if (!normalized || normalized === "0" || normalized.toLowerCase() === "false") {
    return false;
  }
  if (normalized.toLowerCase() === "true") {
    throw new Error(
      "COREY_MCP_TRUST_PROXY must be a positive proxy-hop count or trusted proxy address/subnet, not true.",
    );
  }
  if (/^\d+$/.test(normalized)) {
    const hops = Number(normalized);
    if (Number.isSafeInteger(hops) && hops > 0) return hops;
  }
  return normalized;
}

function sameSecret(supplied: string | undefined, expected: string) {
  if (!supplied || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function configuration() {
  const secret = process.env.COREY_MCP_BRIDGE_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error(
      "COREY_MCP_BRIDGE_SECRET must contain at least 32 characters; set it in .env or the process environment.",
    );
  }
  const baseUrl = process.env.COREY_BASE_URL?.trim() || "http://127.0.0.1:4000";
  const publicUrl = new URL(
    process.env.COREY_MCP_PUBLIC_URL?.trim() || "http://localhost:4001/mcp",
  );
  const appPublicUrl =
    process.env.COREY_APP_PUBLIC_URL?.trim() || "http://localhost:4000";
  const origins = new Set(
    (process.env.COREY_MCP_ALLOWED_ORIGINS ?? new URL(baseUrl).origin)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return {
    secret,
    baseUrl,
    publicUrl,
    appPublicUrl,
    origins,
    bind: process.env.COREY_MCP_BIND?.trim() || "127.0.0.1",
    port: numberEnv("COREY_MCP_PORT", 4001),
    userHeader: process.env.COREY_USER_HEADER?.trim().toLowerCase() || "x-forwarded-user",
    cacheEntries: numberEnv("COREY_MCP_INDEX_CACHE_ENTRIES", 3),
    trustProxy: parseTrustProxy(process.env.COREY_MCP_TRUST_PROXY),
  };
}

async function handleMcpHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  createServerForUser: (userId: string) => McpServer,
) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcp = createServerForUser(userId);
  response.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(request, response);
}

export async function runCoreyMcp() {
  const config = configuration();
  const api = new CoreyApiClient({
    baseUrl: config.baseUrl,
    userHeader: config.userHeader,
  });
  const bridge = new BrowserBridgeRegistry(config.secret, config.origins);
  const models = new StoredModelService(api, config.cacheEntries);
  const deps = { api, bridge, models };
  const auth = new McpAuthBackend({
    baseUrl: config.baseUrl,
    appPublicUrl: config.appPublicUrl,
    serviceSecret: config.secret,
  });
  const app = express();
  if (config.trustProxy !== false) app.set("trust proxy", config.trustProxy);
  const issuerUrl = new URL("/", config.publicUrl);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.publicUrl);

  app.use(
    mcpAuthRouter({
      provider: auth,
      issuerUrl,
      baseUrl: issuerUrl,
      resourceServerUrl: config.publicUrl,
      resourceName: "COREY IFC",
      scopesSupported: ["corey:mcp"],
      serviceDocumentationUrl: new URL("/docs", config.appPublicUrl),
    }),
  );
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "corey-mcp" });
  });
  app.post("/internal/reload", async (request, response) => {
    if (!sameSecret(request.get("x-corey-mcp-service-secret"), config.secret)) {
      response.status(401).json({ error: "Invalid MCP service credentials." });
      return;
    }
    if (!(await auth.enabled().catch(() => false))) bridge.disconnectAll();
    response.json({ ok: true });
  });
  app.all(
    "/mcp",
    requireBearerAuth({
      verifier: auth,
      requiredScopes: ["corey:mcp"],
      resourceMetadataUrl,
    }),
    async (request, response) => {
      const userId = request.auth?.extra?.userId;
      if (typeof userId !== "string" || !userId) {
        response.status(401).json({ error: "A valid MCP credential is required." });
        return;
      }
      try {
        await handleMcpHttpRequest(request, response, userId, (id) =>
          createCoreyMcpServer(id, deps),
        );
      } catch (error) {
        if (response.headersSent) return;
        response.status(500).json({
          error: error instanceof Error ? error.message : "MCP request failed.",
        });
      }
    },
  );

  const httpServer = createServer(app);
  bridge.attach(httpServer);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.bind, () => resolve());
  });
  process.stderr.write(`COREY MCP HTTP and browser bridge listening on ${config.bind}:${config.port}\n`);

  const statusTimer = setInterval(() => {
    void auth
      .enabled()
      .then((enabled) => {
        if (!enabled) bridge.disconnectAll();
      })
      .catch(() => undefined);
  }, 30_000);
  statusTimer.unref();

  const shutdown = async () => {
    clearInterval(statusTimer);
    bridge.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}
