import { getRuleTemplate, getRuleTemplateSource } from "@/server/rule-template-store";

type RuleTemplateRouteContext = {
  params: Promise<{ id: string }>;
};

function attachmentFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-") || "rule-template";
}

async function getRuleTemplateConfigResponse(templateId: string) {
  const template = await getRuleTemplate(templateId);

  if (!template) {
    return Response.json({ error: "Rule template not found." }, { status: 404 });
  }

  return Response.json(template.config, {
    headers: {
      "Content-Disposition": `attachment; filename="${attachmentFileName(template.templateId)}.json"`,
    },
  });
}

async function getRuleTemplateSourceResponse(templateId: string) {
  const source = await getRuleTemplateSource(templateId);

  if (!source) {
    return Response.json({ error: "Rule template not found." }, { status: 404 });
  }

  if (!source.sourceText || !source.sourceFileName) {
    return Response.json({ error: "Rule template source not found." }, { status: 404 });
  }

  return new Response(source.sourceText, {
    headers: {
      "Content-Disposition": `attachment; filename="${attachmentFileName(source.sourceFileName)}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}

export async function GET(request: Request, { params }: RuleTemplateRouteContext) {
  try {
    const { id } = await params;
    const format = new URL(request.url).searchParams.get("format");

    if (format === "config") {
      return getRuleTemplateConfigResponse(id);
    }

    if (format === "source") {
      return getRuleTemplateSourceResponse(id);
    }

    const template = await getRuleTemplate(id);

    if (!template) {
      return Response.json({ error: "Rule template not found." }, { status: 404 });
    }

    return Response.json({ template });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rule template could not be read.";
    return Response.json({ error: message }, { status: 500 });
  }
}
