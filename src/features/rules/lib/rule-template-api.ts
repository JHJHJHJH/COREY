import { parseStoredViewerValidationConfig } from "@/features/rules/lib/validation";
import type {
  ViewerRuleTemplateRecord,
  ViewerRuleTemplateSummary,
} from "@/features/viewer/types";

function ruleTemplateEndpoint(templateId: string) {
  return `/api/rule-templates/${encodeURIComponent(templateId)}`;
}

export function ruleTemplateConfigEndpoint(templateId: string) {
  return `${ruleTemplateEndpoint(templateId)}?format=config`;
}

export function ruleTemplateSourceEndpoint(templateId: string) {
  return `${ruleTemplateEndpoint(templateId)}?format=source`;
}

export async function listRuleTemplates(
  signal?: AbortSignal,
): Promise<ViewerRuleTemplateSummary[]> {
  const response = await fetch("/api/rule-templates", { cache: "no-store", signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Rule templates could not be listed (${response.status}).`);
  }

  const body = (await response.json()) as { templates: ViewerRuleTemplateSummary[] };
  return body.templates;
}

export async function readRuleTemplate(
  templateId: string,
  signal?: AbortSignal,
): Promise<ViewerRuleTemplateRecord> {
  const response = await fetch(ruleTemplateEndpoint(templateId), { cache: "no-store", signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Rule template could not be loaded (${response.status}).`);
  }

  const body = (await response.json()) as {
    template: Omit<ViewerRuleTemplateRecord, "config"> & { config: unknown };
  };

  return {
    ...body.template,
    config: parseStoredViewerValidationConfig(body.template.config),
  };
}
