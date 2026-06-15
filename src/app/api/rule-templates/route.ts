import { listRuleTemplates } from "@/server/rule-template-store";

export async function GET() {
  try {
    const templates = await listRuleTemplates();
    return Response.json({ templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rule templates could not be listed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
