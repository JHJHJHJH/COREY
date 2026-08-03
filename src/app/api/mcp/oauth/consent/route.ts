import { getMcpAdminOrResponse } from "@/server/mcp-admin";
import { completeMcpOauthConsent, isMcpEnabled } from "@/server/mcp-settings-store";

export async function POST(request: Request) {
  const admin = getMcpAdminOrResponse(request);
  if (admin instanceof Response) return admin;
  const form = await request.formData();
  const requestId = String(form.get("requestId") ?? "");
  const approved = form.get("decision") === "approve";
  if (approved && !(await isMcpEnabled())) {
    return Response.json({ error: "MCP access is disabled." }, { status: 409 });
  }
  const result = await completeMcpOauthConsent(requestId, approved);
  if (!result) return Response.json({ error: "The authorization request expired." }, { status: 400 });
  const redirect = new URL(result.redirectUri);
  if (result.approved) redirect.searchParams.set("code", result.code);
  else redirect.searchParams.set("error", "access_denied");
  if (result.state) redirect.searchParams.set("state", result.state);
  return Response.redirect(redirect, 303);
}
