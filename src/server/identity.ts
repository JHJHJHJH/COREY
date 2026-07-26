import { getDefaultUserId, getUserHeaderName, isUserRequired } from "@/server/env";

// Characters allowed in a normalized user id. Anything else (spaces, control
// chars, header-injection attempts) is stripped before the value is used as a
// database key.
const UNSAFE_USER_ID = /[^a-z0-9._@-]/g;
const MAX_USER_ID_LENGTH = 200;

export function normalizeUserId(raw: string): string {
  return raw.trim().toLowerCase().replace(UNSAFE_USER_ID, "").slice(0, MAX_USER_ID_LENGTH);
}

export function getUserIdFromHeaderValue(headerValue: string | null): string | null {
  const userId = headerValue ? normalizeUserId(headerValue) : "";
  if (userId) return userId;
  return isUserRequired() ? null : getDefaultUserId();
}

/**
 * Resolve the calling user's id from the trusted reverse-proxy identity header.
 *
 * Returns the normalized id, or a `401` Response when `COREY_REQUIRE_USER` is on
 * and no usable identity is present. When the header is absent and identity is
 * not required, falls back to the configured default user so single-tenant /
 * local-dev deployments keep working as one implicit user.
 *
 * Routes use it as a guard:
 *   const userId = getUserIdOrResponse(request);
 *   if (userId instanceof Response) return userId;
 */
export function getUserIdOrResponse(request: Request): string | Response {
  const userId = getUserIdFromHeaderValue(request.headers.get(getUserHeaderName()));
  if (!userId) {
    return Response.json(
      { error: "A user identity header is required for this deployment." },
      { status: 401 },
    );
  }
  return userId;
}
