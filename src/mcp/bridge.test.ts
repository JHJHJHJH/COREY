import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { BrowserBridgeRegistry } from "@/mcp/bridge";
import { createCoreyMcpBridgeToken } from "@/server/mcp-token";

const secret = "bridge-integration-secret-with-32-characters";

test("browser bridge authenticates, lists, and routes commands", async (context) => {
  const registry = new BrowserBridgeRegistry(secret, new Set(["http://localhost:4000"]));
  const server = createServer();
  let client: WebSocket | null = null;
  context.after(async () => {
    client?.terminate();
    registry.close();
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  registry.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const sessionId = "session-integration";
  const token = createCoreyMcpBridgeToken(
    {
      sessionId,
      userId: "local",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    secret,
  );
  client = new WebSocket(
    `ws://127.0.0.1:${address.port}/bridge?token=${encodeURIComponent(token)}`,
    { headers: { Origin: "http://localhost:4000" } },
  );
  await once(client, "open");
  client.send(
    JSON.stringify({
      type: "hello",
      descriptor: {
        sessionId,
        connectedAt: new Date().toISOString(),
        phase: "idle",
        model: null,
        selectedGlobalIds: [],
        hiddenItemCount: 0,
        revision: 1,
      },
    }),
  );
  for (let attempt = 0; attempt < 20 && registry.list("local").length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(registry.list("local")[0]?.sessionId, sessionId);
  assert.equal(registry.list("another-user").length, 0);

  client.on("message", (data) => {
    const message = JSON.parse(data.toString()) as {
      type: string;
      requestId: string;
      command: { method: string };
    };
    client.send(
      JSON.stringify({
        type: "result",
        requestId: message.requestId,
        ok: true,
        value: { method: message.command.method },
      }),
    );
  });
  const response = await registry.command("local", sessionId, {
    method: "get_model_summary",
    params: {},
  });
  assert.deepEqual(response, { method: "get_model_summary" });

});
