import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseStoredViewerValidationConfig } from "@/features/rules/lib/validation";
import type {
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

const BUILT_IN_RULE_TEMPLATES = [
  {
    id: "starter-essential-elements",
    name: "Starter Essential Elements",
    description: "Basic required-field checks for common IFC element categories.",
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
  return value === "industry-mapping" ? "industry-mapping" : "starter";
}

function toSummary(row: RuleTemplateRow): ViewerRuleTemplateSummary {
  return {
    templateId: row.id,
    name: row.name,
    description: row.description,
    ruleCount: row.ruleCount,
    sourceKind: normalizeSourceKind(row.sourceKind),
    sourceFileName: row.sourceFileName,
    updatedAt: row.updatedAt.toISOString(),
  };
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
  const existingRows = await prisma.ruleTemplateRecord.findMany({
    where: { id: { in: BUILT_IN_RULE_TEMPLATES.map((template) => template.id) } },
    select: { id: true },
  });
  const existingIds = new Set(existingRows.map((row) => row.id));
  const missingTemplates = BUILT_IN_RULE_TEMPLATES.filter((template) => !existingIds.has(template.id));

  for (const template of missingTemplates) {
    const config = await readValidationConfig(template.configFileName);
    const sourceText = await readOptionalSourceText(template.sourceFileName);

    await prisma.ruleTemplateRecord.create({
      data: {
        id: template.id,
        name: template.name,
        description: template.description,
        sourceKind: template.sourceKind,
        sourceFileName: template.sourceFileName,
        sourceText,
        config: config as unknown as Prisma.InputJsonValue,
        ruleCount: countRules(config),
        sortOrder: template.sortOrder,
      },
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
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return rows.map(toSummary);
}

export async function getRuleTemplate(
  templateId: string,
): Promise<ViewerRuleTemplateRecord | null> {
  await ensureBuiltInRuleTemplates();

  const row = await prisma.ruleTemplateRecord.findUnique({ where: { id: templateId } });
  if (!row) {
    return null;
  }

  const config = parseStoredViewerValidationConfig(row.config);

  return {
    ...toSummary(row),
    ruleCount: countRules(config),
    config,
  };
}

export async function getRuleTemplateSource(
  templateId: string,
): Promise<RuleTemplateSource | null> {
  await ensureBuiltInRuleTemplates();

  const row = await prisma.ruleTemplateRecord.findUnique({ where: { id: templateId } });
  if (!row) {
    return null;
  }

  return {
    template: toSummary(row),
    sourceText: row.sourceText,
    sourceFileName: row.sourceFileName,
  };
}
