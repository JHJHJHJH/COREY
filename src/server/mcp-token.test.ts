import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoreyMcpBridgeToken,
  verifyCoreyMcpBridgeToken,
} from "@/server/mcp-token";

const secret = "a-secure-test-secret-that-is-longer-than-32";

test("bridge tokens verify and reject tampering", () => {
  const claims = {
    sessionId: "session-123",
    userId: "local",
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const token = createCoreyMcpBridgeToken(claims, secret);
  assert.deepEqual(verifyCoreyMcpBridgeToken(token, secret), claims);
  assert.equal(verifyCoreyMcpBridgeToken(`${token}x`, secret), null);
});

test("expired bridge tokens are rejected", () => {
  const token = createCoreyMcpBridgeToken(
    {
      sessionId: "session-123",
      userId: "local",
      exp: Math.floor(Date.now() / 1000) - 1,
    },
    secret,
  );
  assert.equal(verifyCoreyMcpBridgeToken(token, secret), null);
});

