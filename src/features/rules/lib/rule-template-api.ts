import { parseStoredViewerValidationConfig } from "@/features/rules/lib/validation";
import type {
  ViewerRuleTemplateKind,
  ViewerRuleTemplateRecord,
  ViewerRuleTemplateSummary,
  ViewerValidationConfig,
} from "@/features/viewer/types";

export type SaveRuleTemplateInput = {
  name: string;
  description: string;
  kind: ViewerRuleTemplateKind;
  config: ViewerValidationConfig;
};

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

export async function saveRuleTemplate(
  input: SaveRuleTemplateInput,
  signal?: AbortSignal,
): Promise<ViewerRuleTemplateSummary> {
  const response = await fetch("/api/rule-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Rule template could not be saved (${response.status}).`);
  }

  const body = (await response.json()) as { template: ViewerRuleTemplateSummary };
  return body.template;
}

export async function deleteRuleTemplate(templateId: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(ruleTemplateEndpoint(templateId), { method: "DELETE", signal });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Rule template could not be deleted (${response.status}).`);
  }
}
