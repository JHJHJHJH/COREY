import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { McpAuthBackend } from "@/mcp/auth-backend";

test("auth backend verifies app-managed credentials and reports disabled keys", async (context) => {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
      : {};
    response.setHeader("Content-Type", "application/json");
    if (request.headers["x-corey-mcp-service-secret"] !== "shared-secret") {
      response.writeHead(401).end(JSON.stringify({ error: "bad service secret" }));
      return;
    }
    if (request.url === "/api/mcp/internal/status") {
      response.end(JSON.stringify({ enabled: true }));
      return;
    }
    if (request.url === "/api/mcp/internal/authenticate" && body.token === "valid-key") {
      response.end(
        JSON.stringify({
          userId: "local",
          clientId: "corey-api-key",
          scopes: ["corey:mcp"],
          expiresAt: 253402300799,
        }),
      );
      return;
    }
    response.writeHead(401).end(JSON.stringify({ error: "disabled" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address() as AddressInfo;
  const backend = new McpAuthBackend({
    baseUrl: `http://127.0.0.1:${address.port}`,
    appPublicUrl: "http://localhost:4000",
    serviceSecret: "shared-secret",
  });

  assert.equal(await backend.enabled(), true);
  const auth = await backend.verifyAccessToken("valid-key");
  assert.equal(auth.extra?.userId, "local");
  assert.deepEqual(auth.scopes, ["corey:mcp"]);
  await assert.rejects(() => backend.verifyAccessToken("disabled-key"), /invalid or disabled/i);
});

test("dynamic client registration is forced to public PKCE-compatible metadata", async (context) => {
  let storedClientSecret: unknown = "not-called";
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      action: string;
      client: Record<string, unknown>;
    };
    storedClientSecret = body.client.client_secret;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ client: body.client }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address() as AddressInfo;
  const backend = new McpAuthBackend({
    baseUrl: `http://127.0.0.1:${address.port}`,
    appPublicUrl: "http://localhost:4000",
    serviceSecret: "shared-secret",
  });

  const registered = await backend.registerClient({
    client_id: "generated-client",
    client_id_issued_at: 1,
    client_secret: "must-not-be-stored",
    redirect_uris: ["https://client.example/callback"],
    token_endpoint_auth_method: "client_secret_post",
  } as OAuthClientInformationFull);

  assert.equal(registered.token_endpoint_auth_method, "none");
  assert.deepEqual(registered.grant_types, ["authorization_code", "refresh_token"]);
  assert.equal(storedClientSecret, undefined);
});
