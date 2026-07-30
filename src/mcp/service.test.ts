import assert from "node:assert/strict";
import test from "node:test";
import { parseTrustProxy } from "@/mcp/service";

test("parseTrustProxy keeps direct deployments untrusted by default", () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy("0"), false);
  assert.equal(parseTrustProxy("false"), false);
});

test("parseTrustProxy accepts a hop count or trusted proxy network", () => {
  assert.equal(parseTrustProxy("1"), 1);
  assert.equal(parseTrustProxy(" 2 "), 2);
  assert.equal(parseTrustProxy("loopback, linklocal, uniquelocal"), "loopback, linklocal, uniquelocal");
});

test("parseTrustProxy rejects the permissive true setting", () => {
  assert.throws(
    () => parseTrustProxy("true"),
    /positive proxy-hop count or trusted proxy address\/subnet/,
  );
});
