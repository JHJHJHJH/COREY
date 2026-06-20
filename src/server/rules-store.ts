import {
  createEmptyViewerValidationConfig,
  parseStoredViewerValidationConfig,
} from "@/features/rules/lib/validation";
import type { ViewerValidationConfig } from "@/features/viewer/types";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

// Each user has one rules document, keyed by their user id.
export async function getRuleConfig(userId: string): Promise<ViewerValidationConfig> {
  const row = await prisma.ruleConfig.findUnique({ where: { id: userId } });
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

export async function saveRuleConfig(
  userId: string,
  input: unknown,
): Promise<ViewerValidationConfig> {
  // Parses, migrates legacy shapes, and sanitizes in one step.
  const config = parseStoredViewerValidationConfig(input);
  const json = config as unknown as Prisma.InputJsonValue;

  await prisma.ruleConfig.upsert({
    where: { id: userId },
    create: { id: userId, config: json },
    update: { config: json },
  });

  return config;
}
