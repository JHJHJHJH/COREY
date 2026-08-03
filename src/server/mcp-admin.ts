import { timingSafeEqual } from "node:crypto";
import { getMcpAdminUserIds } from "@/server/env";
import { getUserIdOrResponse, normalizeUserId } from "@/server/identity";
import { getMcpBridgeSecret } from "@/server/mcp-config";

export function getMcpAdminOrResponse(request: Request): string | Response {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;
  if (!getMcpAdminUserIds().includes(normalizeUserId(userId))) {
    return Response.json({ error: "MCP administrator access is required." }, { status: 403 });
  }
  return userId;
}

export function isMcpServiceRequest(request: Request) {
  const expected = getMcpBridgeSecret();
  const supplied = request.headers.get("x-corey-mcp-service-secret") ?? "";
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export function noStoreJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(value, { ...init, headers });
}
