import { parseViewerValidationConfig } from "@/features/rules/lib/validation";
import type {
  ViewerRuleTemplateKind,
  ViewerValidationConfig,
} from "@/features/viewer/types";

export const MAX_RULE_TEMPLATE_NAME = 120;
export const MAX_RULE_TEMPLATE_DESCRIPTION = 500;

export type ParsedRuleTemplateInput = {
  name: string;
  description: string;
  kind: ViewerRuleTemplateKind;
  config: ViewerValidationConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseKind(value: unknown): ViewerRuleTemplateKind {
  if (value === undefined || value === null || value === "config") {
    return "config";
  }

  if (value === "clause") {
    return "clause";
  }

  throw new Error('Template kind must be "config" or "clause".');
}

function parseName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("A template needs a name.");
  }

  const name = value.trim();
  if (!name) {
    throw new Error("A template needs a name.");
  }

  if (name.length > MAX_RULE_TEMPLATE_NAME) {
    throw new Error(`A template name can be at most ${MAX_RULE_TEMPLATE_NAME} characters.`);
  }

  return name;
}

function parseDescription(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error("A template description must be text.");
  }

  const description = value.trim();
  if (description.length > MAX_RULE_TEMPLATE_DESCRIPTION) {
    throw new Error(
      `A template description can be at most ${MAX_RULE_TEMPLATE_DESCRIPTION} characters.`,
    );
  }

  return description;
}

/**
 * Validates a save-template request body. Kept apart from the Prisma store so the rules
 * here are unit-testable without a database.
 *
 * The config goes through the strict import parser rather than the forgiving stored-config
 * one: this input arrives from a client, so a legacy or malformed shape should be rejected
 * outright instead of silently migrated into the shared catalog.
 */
export function parseRuleTemplateInput(input: unknown): ParsedRuleTemplateInput {
  if (!isRecord(input)) {
    throw new Error("A template request must be an object.");
  }

  const name = parseName(input.name);
  const description = parseDescription(input.description);
  const kind = parseKind(input.kind);
  const config = parseViewerValidationConfig(input.config);

  if (kind === "clause" && config.clauses.length !== 1) {
    throw new Error("A clause template must hold exactly one clause.");
  }

  if (config.clauses.length === 0) {
    throw new Error("A template needs at least one clause.");
  }

  return { name, description, kind, config };
}
