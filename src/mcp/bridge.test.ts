import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { BrowserBridgeRegistry } from "@/mcp/bridge";
import { createCoreyMcpBridgeToken } from "@/server/mcp-token";

const secret = "a-bridge-secret-that-is-longer-than-thirty-two-characters";
const origin = "http://localhost:4000";

async function fixture() {
  const bridge = new BrowserBridgeRegistry(secret, new Set([origin]));
  const server = createServer();
  bridge.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address.");
  return {
    bridge,
    server,
    url: `ws://127.0.0.1:${address.port}/bridge`,
    async close() {
      bridge.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for bridge state.");
}

test("authenticated browser sessions receive correlated commands", async () => {
  const current = await fixture();
  const token = createCoreyMcpBridgeToken(
    {
      sessionId: "session-123",
      userId: "local",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    secret,
  );
  const socket = new WebSocket(`${current.url}?token=${encodeURIComponent(token)}`, {
    origin,
  });
  try {
    await once(socket, "open");
    socket.send(
      JSON.stringify({
        type: "hello",
        descriptor: {
          sessionId: "session-123",
          connectedAt: new Date().toISOString(),
          phase: "idle",
          model: null,
          selectedGlobalIds: [],
          hiddenItemCount: 0,
          revision: "r1",
        },
      }),
    );
    await waitFor(() => current.bridge.list("local").length === 1);

    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { requestId: string };
      socket.send(
        JSON.stringify({
          type: "result",
          requestId: message.requestId,
          ok: true,
          value: { ready: true },
        }),
      );
    });
    assert.deepEqual(
      await current.bridge.command("local", "session-123", {
        method: "get_model_summary",
        params: {},
      }),
      { ready: true },
    );
  } finally {
    socket.terminate();
    await current.close();
  }
});

test("the bridge rejects disallowed browser origins", async () => {
  const current = await fixture();
  const token = createCoreyMcpBridgeToken(
    {
      sessionId: "session-456",
      userId: "local",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    secret,
  );
  const socket = new WebSocket(`${current.url}?token=${encodeURIComponent(token)}`, {
    origin: "http://malicious.invalid",
  });
  const [error] = (await once(socket, "error")) as [Error];
  assert.match(error.message, /403/);
  await current.close();
});
