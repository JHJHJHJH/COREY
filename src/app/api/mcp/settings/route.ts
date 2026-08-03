import { getMcpAdminOrResponse, noStoreJson } from "@/server/mcp-admin";
import {
  getMcpSettings,
  setMcpEnabled,
} from "@/server/mcp-settings-store";
import { notifyMcpRuntime } from "@/server/mcp-runtime-notify";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = getMcpAdminOrResponse(request);
  if (admin instanceof Response) return admin;
  return noStoreJson(await getMcpSettings());
}

export async function PATCH(request: Request) {
  const admin = getMcpAdminOrResponse(request);
  if (admin instanceof Response) return admin;
  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return noStoreJson({ error: "enabled must be a boolean." }, { status: 400 });
  }
  try {
    const result = await setMcpEnabled(body.enabled);
    await notifyMcpRuntime();
    return noStoreJson(result);
  } catch (error) {
    return noStoreJson(
      { error: error instanceof Error ? error.message : "MCP settings could not be saved." },
      { status: 409 },
    );
  }
}
