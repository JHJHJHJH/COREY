import { getMcpAdminOrResponse, noStoreJson } from "@/server/mcp-admin";
import { rotateMcpApiKey } from "@/server/mcp-settings-store";

export async function POST(request: Request) {
  const admin = getMcpAdminOrResponse(request);
  if (admin instanceof Response) return admin;
  return noStoreJson(await rotateMcpApiKey());
}
