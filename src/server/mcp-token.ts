import { createHmac, timingSafeEqual } from "node:crypto";

export type CoreyMcpBridgeTokenClaims = {
  sessionId: string;
  userId: string;
  exp: number;
};

function encode(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createCoreyMcpBridgeToken(
  claims: CoreyMcpBridgeTokenClaims,
  secret: string,
) {
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyCoreyMcpBridgeToken(token: string, secret: string) {
  const [payload, providedSignature, ...extra] = token.split(".");
  if (!payload || !providedSignature || extra.length > 0) return null;
  const expected = signature(payload, secret);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.byteLength !== expectedBuffer.byteLength ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as CoreyMcpBridgeTokenClaims;
    if (
      !claims ||
      typeof claims.sessionId !== "string" ||
      !claims.sessionId ||
      typeof claims.userId !== "string" ||
      !claims.userId ||
      typeof claims.exp !== "number" ||
      claims.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

