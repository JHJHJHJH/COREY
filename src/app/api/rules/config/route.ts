import { getRuleConfig, saveRuleConfig } from "@/server/rules-store";

export async function GET() {
  try {
    const config = await getRuleConfig();
    return Response.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rules config could not be read.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const config = await saveRuleConfig(body);
    return Response.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rules config could not be saved.";
    return Response.json({ error: message }, { status: 400 });
  }
}
