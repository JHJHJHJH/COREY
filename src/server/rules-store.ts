import {
  createEmptyViewerValidationConfig,
  parseStoredViewerValidationConfig,
} from "@/features/rules/lib/validation";
import type { ViewerValidationConfig } from "@/features/viewer/types";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

// The app has a single logical rules document today; key it by a stable id so a
// per-project/per-user split can slot in later without a schema change.
const RULE_CONFIG_ID = "default";

export async function getRuleConfig(): Promise<ViewerValidationConfig> {
  const row = await prisma.ruleConfig.findUnique({ where: { id: RULE_CONFIG_ID } });
  if (!row) {
    return createEmptyViewerValidationConfig();
  }

  try {
    return parseStoredViewerValidationConfig(row.config);
  } catch {
    // Corrupt/legacy stored config — fall back to empty rather than 500.
    return createEmptyViewerValidationConfig();
  }
}

export async function saveRuleConfig(input: unknown): Promise<ViewerValidationConfig> {
  // Parses, migrates legacy shapes, and sanitizes in one step.
  const config = parseStoredViewerValidationConfig(input);
  const json = config as unknown as Prisma.InputJsonValue;

  await prisma.ruleConfig.upsert({
    where: { id: RULE_CONFIG_ID },
    create: { id: RULE_CONFIG_ID, config: json },
    update: { config: json },
  });

  return config;
}
