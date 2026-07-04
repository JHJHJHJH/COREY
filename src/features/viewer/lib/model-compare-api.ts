"use client";

import type {
  ModelCompareResult,
  ServerModelVersionSummary,
  ViewerDataTableData,
  ViewerDataTableIssue,
  ViewerValidationClause,
} from "@/features/viewer/types";

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export async function compareModelVersionsViaApi(
  input: {
    modelId: string;
    baseVersion: number;
    targetVersion: number;
    clauses?: ViewerValidationClause[];
  },
  signal?: AbortSignal,
): Promise<ModelCompareResult> {
  const response = await fetch(`/api/models/${encodeURIComponent(input.modelId)}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseVersion: input.baseVersion,
      targetVersion: input.targetVersion,
      clauses: input.clauses && input.clauses.length > 0 ? input.clauses : undefined,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readError(response, `Model compare failed (${response.status}).`));
  }

  return (await response.json()) as ModelCompareResult;
}

export type SaveWritebackVersionResult = {
  version: ServerModelVersionSummary;
  appliedCount: number;
  message: string;
  issues: ViewerDataTableIssue[];
};

export async function saveWritebackAsVersion(input: {
  modelId: string;
  data: ViewerDataTableData;
  label?: string | null;
}): Promise<SaveWritebackVersionResult> {
  const response = await fetch(`/api/models/${encodeURIComponent(input.modelId)}/writeback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: input.data,
      saveAsVersion: true,
      label: input.label ?? undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readError(response, `Saving the edited IFC as a version failed (${response.status}).`),
    );
  }

  return (await response.json()) as SaveWritebackVersionResult;
}
