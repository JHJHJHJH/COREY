import { parseRuleTemplateInput } from "@/features/rules/lib/rule-template-input";
import { getUserIdOrResponse } from "@/server/identity";
import { createRuleTemplate, listRuleTemplates } from "@/server/rule-template-store";

export async function GET() {
  try {
    const templates = await listRuleTemplates();
    return Response.json({ templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rule templates could not be listed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

// The catalog is shared across the deployment, so nothing here is user-scoped. The identity
// guard still runs: a deployment with COREY_REQUIRE_USER on should not accept anonymous
// writes to state everyone sees.
export async function POST(request: Request) {
  try {
    const userId = getUserIdOrResponse(request);
    if (userId instanceof Response) return userId;

    const input = parseRuleTemplateInput(await request.json());
    const template = await createRuleTemplate(input);

    return Response.json({ template }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rule template could not be saved.";
    return Response.json({ error: message }, { status: 400 });
  }
}
