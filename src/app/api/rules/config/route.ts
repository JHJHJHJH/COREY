import { getUserIdOrResponse } from "@/server/identity";
import { getRuleConfig, saveRuleConfig } from "@/server/rules-store";

export async function GET(request: Request) {
  try {
    const userId = getUserIdOrResponse(request);
    if (userId instanceof Response) return userId;

    const config = await getRuleConfig(userId);
    return Response.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rules config could not be read.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = getUserIdOrResponse(request);
    if (userId instanceof Response) return userId;

    const body = (await request.json()) as unknown;
    const config = await saveRuleConfig(userId, body);
    return Response.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rules config could not be saved.";
    return Response.json({ error: message }, { status: 400 });
  }
}
