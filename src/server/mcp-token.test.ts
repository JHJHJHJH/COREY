import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoreyMcpBridgeToken,
  verifyCoreyMcpBridgeToken,
} from "@/server/mcp-token";

const secret = "a-bridge-secret-that-is-longer-than-thirty-two-characters";

test("bridge tokens round-trip valid claims", () => {
  const claims = {
    sessionId: "session-123",
    userId: "local",
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  assert.deepEqual(verifyCoreyMcpBridgeToken(createCoreyMcpBridgeToken(claims, secret), secret), claims);
});

test("bridge tokens reject tampering and expiration", () => {
  const expired = createCoreyMcpBridgeToken(
    {
      sessionId: "session-123",
      userId: "local",
      exp: Math.floor(Date.now() / 1000) - 1,
    },
    secret,
  );
  assert.equal(verifyCoreyMcpBridgeToken(expired, secret), null);
  assert.equal(verifyCoreyMcpBridgeToken(`${expired}x`, secret), null);
});
