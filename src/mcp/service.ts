import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BrowserBridgeRegistry } from "@/mcp/bridge";
import { CoreyApiClient } from "@/mcp/corey-api";
import { StoredModelService } from "@/mcp/model-service";
import { createCoreyMcpServer } from "@/mcp/tools";

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configuration() {
  const secret = process.env.COREY_MCP_BRIDGE_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error(
      "COREY_MCP_BRIDGE_SECRET must contain at least 32 characters; set it in the MCP env file and the COREY app environment.",
    );
  }
  const baseUrl = process.env.COREY_BASE_URL?.trim() || "http://host.docker.internal:4000";
  const allowedOrigins =
    process.env.COREY_MCP_ALLOWED_ORIGINS?.trim() || new URL(baseUrl).origin;
  return {
    secret,
    baseUrl,
    bind: process.env.COREY_MCP_BIND?.trim() || "0.0.0.0",
    port: positiveIntegerEnv("COREY_MCP_PORT", 4001),
    userId: process.env.COREY_USER_ID?.trim() || "local",
    userHeader:
      process.env.COREY_USER_HEADER?.trim().toLowerCase() || "x-forwarded-user",
    cacheEntries: positiveIntegerEnv("COREY_MCP_INDEX_CACHE_ENTRIES", 3),
    origins: new Set(
      allowedOrigins
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  };
}

async function closeMcp(server: McpServer) {
  await server.close().catch(() => undefined);
}

export async function runCoreyMcpStdio() {
  const config = configuration();
  const api = new CoreyApiClient({
    baseUrl: config.baseUrl,
    userHeader: config.userHeader,
  });
  const bridge = new BrowserBridgeRegistry(config.secret, config.origins);
  const models = new StoredModelService(api, config.cacheEntries);
  const mcp = createCoreyMcpServer(config.userId, { api, bridge, models });
  const transport = new StdioServerTransport();
  const bridgeServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", service: "corey-mcp-stdio" }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  bridge.attach(bridgeServer);
  await new Promise<void>((resolve, reject) => {
    bridgeServer.once("error", reject);
    bridgeServer.listen(config.port, config.bind, resolve);
  });
  await mcp.connect(transport);
  process.stderr.write(
    `COREY MCP ready on stdio; browser bridge listening on ${config.bind}:${config.port}\n`,
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    bridge.close();
    await closeMcp(mcp);
    await new Promise<void>((resolve) => bridgeServer.close(() => resolve()));
  };

  process.stdin.once("end", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  return { shutdown };
}
