import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedRuleTemplateInput } from "@/features/rules/lib/rule-template-input";
import {
  countViewerValidationRulesBySeverity,
  parseStoredViewerValidationConfig,
} from "@/features/rules/lib/validation";
import type {
  ViewerRuleTemplateKind,
  ViewerRuleTemplateRecord,
  ViewerRuleTemplateSourceKind,
  ViewerRuleTemplateSummary,
  ViewerValidationConfig,
} from "@/features/viewer/types";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

type BuiltInRuleTemplate = {
  id: string;
  name: string;
  description: string;
  sourceKind: ViewerRuleTemplateSourceKind;
  configFileName: string;
  sourceFileName: string | null;
  sortOrder: number;
};

type RuleTemplateRow = {
  id: string;
  name: string;
  description: string;
  sourceKind: string;
  templateKind: string;
  sourceFileName: string | null;
  sourceText: string | null;
  config: Prisma.JsonValue;
  ruleCount: number;
  updatedAt: Date;
};

export type RuleTemplateSource = {
  template: ViewerRuleTemplateSummary;
  sourceText: string | null;
  sourceFileName: string | null;
};

const RESOURCE_DIR = join(process.cwd(), "public", "resources");

// User templates sort below every built-in (10/20/30) so the starters stay put.
const USER_TEMPLATE_SORT_ORDER = 100;

// Soft-deleted rows are tombstones, never served.
const LIVE_TEMPLATE = { deletedAt: null } as const;

const BUILT_IN_RULE_TEMPLATES = [
  {
    id: "starter-essential-elements",
    name: "Demo IfcWall",
    description: "Demo wall checks for basic IFC wall identity and fire-rating metadata.",
    sourceKind: "starter",
    configFileName: "starter-essential-elements.json",
    sourceFileName: null,
    sortOrder: 10,
  },
  {
    id: "starter-structural-elements",
    name: "Starter Structural Elements",
    description: "Synthetic beam, column, and slab property checks for validation setup.",
    sourceKind: "starter",
    configFileName: "starter-structural-elements.json",
    sourceFileName: null,
    sortOrder: 20,
  },
  {
    id: "industry-mapping-bca-column-beam",
    name: "BCA - Column + Beam",
    description: "BCA industry mapping checks for column and beam SGPset requirements.",
    sourceKind: "industry-mapping",
    configFileName: "industry-mapping-bca-column-beam.json",
    sourceFileName: null,
    sortOrder: 30,
  },
] satisfies BuiltInRuleTemplate[];

let seedPromise: Promise<void> | null = null;

function countRules(config: ViewerValidationConfig) {
  return config.clauses.reduce((count, clause) => count + clause.rules.length, 0);
}

function normalizeSourceKind(value: string): ViewerRuleTemplateSourceKind {
  if (value === "industry-mapping") {
    return "industry-mapping";
  }

  return value === "user" ? "user" : "starter";
}

function normalizeTemplateKind(value: string): ViewerRuleTemplateKind {
  return value === "clause" ? "clause" : "config";
}

function toSummary(
  row: RuleTemplateRow,
  config: ViewerValidationConfig | null,
): ViewerRuleTemplateSummary {
  return {
    templateId: row.id,
    name: row.name,
    description: row.description,
    ruleCount: row.ruleCount,
    clauseCount: config ? config.clauses.length : 0,
    severityTally: config ? countViewerValidationRulesBySeverity(config) : [],
    kind: normalizeTemplateKind(row.templateKind),
    sourceKind: normalizeSourceKind(row.sourceKind),
    sourceFileName: row.sourceFileName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// A row whose stored config no longer parses still deserves a catalog entry rather than
// taking the whole listing down with it; only its counts are unknowable.
function toSummaryFromRow(row: RuleTemplateRow): ViewerRuleTemplateSummary {
  try {
    return toSummary(row, parseStoredViewerValidationConfig(row.config));
  } catch {
    return toSummary(row, null);
  }
}

async function readValidationConfig(fileName: string) {
  const text = await readFile(join(RESOURCE_DIR, fileName), "utf8");
  return parseStoredViewerValidationConfig(JSON.parse(text));
}

async function readOptionalSourceText(fileName: string | null) {
  if (!fileName) {
    return null;
  }

  return readFile(join(RESOURCE_DIR, fileName), "utf8");
}

async function seedBuiltInRuleTemplates() {
  const existing = await prisma.ruleTemplateRecord.findMany({
    where: { id: { in: BUILT_IN_RULE_TEMPLATES.map((template) => template.id) } },
    select: { id: true, deletedAt: true },
  });

  // A built-in the user deleted stays deleted. Upserting it here unconditionally would
  // silently resurrect it on the very next read.
  const deletedIds = new Set(
    existing.filter((row) => row.deletedAt !== null).map((row) => row.id),
  );

  for (const template of BUILT_IN_RULE_TEMPLATES) {
    if (deletedIds.has(template.id)) {
      continue;
    }

    const config = await readValidationConfig(template.configFileName);
    const sourceText = await readOptionalSourceText(template.sourceFileName);
    const templateData = {
      name: template.name,
      description: template.description,
      sourceKind: template.sourceKind,
      sourceFileName: template.sourceFileName,
      sourceText,
      templateKind: "config",
      config: config as unknown as Prisma.InputJsonValue,
      ruleCount: countRules(config),
      sortOrder: template.sortOrder,
    };

    await prisma.ruleTemplateRecord.upsert({
      where: { id: template.id },
      create: {
        id: template.id,
        ...templateData,
      },
      update: templateData,
    });
  }
}

async function ensureBuiltInRuleTemplates() {
  seedPromise ??= seedBuiltInRuleTemplates().catch((error) => {
    seedPromise = null;
    throw error;
  });

  return seedPromise;
}

export async function listRuleTemplates(): Promise<ViewerRuleTemplateSummary[]> {
  await ensureBuiltInRuleTemplates();

  const rows = await prisma.ruleTemplateRecord.findMany({
    where: LIVE_TEMPLATE,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return rows.map(toSummaryFromRow);
}

export async function getRuleTemplate(
  templateId: string,
): Promise<ViewerRuleTemplateRecord | null> {
  await ensureBuiltInRuleTemplates();

  const row = await prisma.ruleTemplateRecord.findFirst({
    where: { id: templateId, ...LIVE_TEMPLATE },
  });
  if (!row) {
    return null;
  }

  const config = parseStoredViewerValidationConfig(row.config);

  return {
    ...toSummary(row, config),
    ruleCount: countRules(config),
    config,
  };
}

export async function getRuleTemplateSource(
  templateId: string,
): Promise<RuleTemplateSource | null> {
  await ensureBuiltInRuleTemplates();

  const row = await prisma.ruleTemplateRecord.findFirst({
    where: { id: templateId, ...LIVE_TEMPLATE },
  });
  if (!row) {
    return null;
  }

  return {
    template: toSummaryFromRow(row),
    sourceText: row.sourceText,
    sourceFileName: row.sourceFileName,
  };
}

/** Saves a user-authored template into the shared catalog. */
export async function createRuleTemplate(
  input: ParsedRuleTemplateInput,
): Promise<ViewerRuleTemplateSummary> {
  await ensureBuiltInRuleTemplates();

  const row = await prisma.ruleTemplateRecord.create({
    data: {
      // A random id, so re-saving a name never lands on the tombstone of a deleted one.
      id: randomUUID(),
      name: input.name,
      description: input.description,
      sourceKind: "user",
      templateKind: input.kind,
      sourceFileName: null,
      sourceText: null,
      config: input.config as unknown as Prisma.InputJsonValue,
      ruleCount: countRules(input.config),
      sortOrder: USER_TEMPLATE_SORT_ORDER,
    },
  });

  return toSummary(row, input.config);
}

/**
 * Soft-deletes a template, returning whether one was live to delete.
 *
 * Built-ins are deletable too, which is why this is a tombstone rather than a row removal:
 * `seedBuiltInRuleTemplates` re-upserts the starters on every read and would otherwise
 * bring a deleted one straight back.
 */
export async function deleteRuleTemplate(templateId: string): Promise<boolean> {
  const { count } = await prisma.ruleTemplateRecord.updateMany({
    where: { id: templateId, ...LIVE_TEMPLATE },
    data: { deletedAt: new Date() },
  });

  // The seeder memoizes its success for the life of the process. Drop that memo so the
  // next read re-reads the tombstones instead of trusting a pre-delete snapshot.
  seedPromise = null;

  return count > 0;
}
