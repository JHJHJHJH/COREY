import type {
  ModelCompareResult,
  ModelCompareValidationDiff,
  ModelCompareValidationEntry,
  ViewerValidationClause,
  ViewerValidationElementResult,
  ViewerValidationSeverity,
} from "@/features/viewer/types";
import {
  buildIfcElementSnapshots,
  buildSnapshotValidationRows,
  COMPARE_MAX_ENTRIES_PER_LIST,
  diffIfcElementSnapshots,
  type IfcModelSnapshot,
} from "@/features/viewer/lib/ifc-compare-core";
import {
  defaultViewerValidationSeverities,
  evaluateViewerValidationPayload,
  VIEWER_VALIDATION_CONFIG_VERSION,
} from "@/features/rules/lib/validation";
import { getModelStore } from "@/server/model-store";

function toValidationEntry(
  result: ViewerValidationElementResult,
  side: IfcModelSnapshot,
  otherSide: IfcModelSnapshot,
  globalId: string,
  flags: { elementAdded?: boolean; elementRemoved?: boolean },
): ModelCompareValidationEntry {
  const element = side.elements.get(globalId) ?? null;
  const otherElement = otherSide.elements.get(globalId) ?? null;
  const baseElement = flags.elementAdded ? otherElement : element;
  const targetElement = flags.elementAdded ? element : otherElement;

  return {
    globalId,
    ifcType: element?.ifcType ?? otherElement?.ifcType ?? "",
    name: element?.name ?? otherElement?.name ?? null,
    baseExpressId: baseElement?.expressId ?? null,
    targetExpressId: targetElement?.expressId ?? null,
    severity: result.result,
    clauses: result.failedClauses,
    ...(flags.elementAdded ? { elementAdded: true } : {}),
    ...(flags.elementRemoved ? { elementRemoved: true } : {}),
  };
}

function indexResultsByGlobalId(
  results: ViewerValidationElementResult[],
  snapshot: IfcModelSnapshot,
): Map<string, ViewerValidationElementResult> {
  const globalIdsByExpressId = new Map<number, string>();
  for (const element of snapshot.elements.values()) {
    globalIdsByExpressId.set(element.expressId, element.globalId);
  }

  const indexed = new Map<string, ViewerValidationElementResult>();
  for (const result of results) {
    const globalId = globalIdsByExpressId.get(result.localId);
    if (globalId) {
      indexed.set(globalId, result);
    }
  }

  return indexed;
}

async function buildValidationDiff(
  modelId: string,
  baseSnapshot: IfcModelSnapshot,
  targetSnapshot: IfcModelSnapshot,
  clauses: ViewerValidationClause[],
  severities: ViewerValidationSeverity[],
  warnings: string[],
): Promise<ModelCompareValidationDiff> {
  const [baseRun, targetRun] = [
    await evaluateViewerValidationPayload({
      version: VIEWER_VALIDATION_CONFIG_VERSION,
      sourceId: modelId,
      severities,
      clauses,
      rows: buildSnapshotValidationRows(baseSnapshot, clauses, modelId),
    }),
    await evaluateViewerValidationPayload({
      version: VIEWER_VALIDATION_CONFIG_VERSION,
      sourceId: modelId,
      severities,
      clauses,
      rows: buildSnapshotValidationRows(targetSnapshot, clauses, modelId),
    }),
  ];

  const baseFailures = indexResultsByGlobalId(baseRun.results, baseSnapshot);
  const targetFailures = indexResultsByGlobalId(targetRun.results, targetSnapshot);

  const resolved: ModelCompareValidationEntry[] = [];
  const introduced: ModelCompareValidationEntry[] = [];
  const stillFailing: ModelCompareValidationEntry[] = [];

  for (const [globalId, result] of baseFailures) {
    if (targetFailures.has(globalId)) {
      continue;
    }

    resolved.push(
      toValidationEntry(result, baseSnapshot, targetSnapshot, globalId, {
        elementRemoved: !targetSnapshot.elements.has(globalId),
      }),
    );
  }

  for (const [globalId, result] of targetFailures) {
    const entryFlags = { elementAdded: !baseSnapshot.elements.has(globalId) };
    if (baseFailures.has(globalId)) {
      stillFailing.push(toValidationEntry(result, targetSnapshot, baseSnapshot, globalId, {}));
    } else {
      introduced.push(toValidationEntry(result, targetSnapshot, baseSnapshot, globalId, entryFlags));
    }
  }

  for (const [name, entries] of [
    ["resolved", resolved],
    ["introduced", introduced],
    ["still-failing", stillFailing],
  ] as const) {
    if (entries.length > COMPARE_MAX_ENTRIES_PER_LIST) {
      warnings.push(
        `The ${name} validation list was truncated to ${COMPARE_MAX_ENTRIES_PER_LIST} of ${entries.length} entries.`,
      );
      entries.length = COMPARE_MAX_ENTRIES_PER_LIST;
    }
  }

  return {
    base: {
      failedElementCount: baseRun.results.length,
      failedClauseCount: baseRun.failedClauseCount,
    },
    target: {
      failedElementCount: targetRun.results.length,
      failedClauseCount: targetRun.failedClauseCount,
    },
    resolved,
    introduced,
    stillFailing,
  };
}

/**
 * Compares two stored versions of a server-backed model by GlobalId. Returns
 * null when the model or either version is missing (or not owned by the user).
 * Both versions are parsed sequentially so peak memory stays at one open
 * model plus two element-snapshot maps.
 */
export async function compareModelVersions(input: {
  modelId: string;
  ownerId: string;
  baseVersion: number;
  targetVersion: number;
  clauses?: ViewerValidationClause[];
  severities?: ViewerValidationSeverity[];
}): Promise<ModelCompareResult | null> {
  const store = getModelStore();

  const baseBytes = await store.getVersionBytes(input.modelId, input.ownerId, input.baseVersion);
  if (!baseBytes) {
    return null;
  }
  const baseSnapshot = await buildIfcElementSnapshots(baseBytes);

  const targetBytes = await store.getVersionBytes(
    input.modelId,
    input.ownerId,
    input.targetVersion,
  );
  if (!targetBytes) {
    return null;
  }
  const targetSnapshot = await buildIfcElementSnapshots(targetBytes);

  const diff = diffIfcElementSnapshots(baseSnapshot, targetSnapshot);
  const warnings = [
    ...baseSnapshot.warnings.map((warning) => `Version ${input.baseVersion}: ${warning}`),
    ...targetSnapshot.warnings.map((warning) => `Version ${input.targetVersion}: ${warning}`),
  ];

  const clauses = input.clauses ?? [];
  // Callers that predate configurable severities still compare against the seeded warn/error set.
  const severities = input.severities ?? defaultViewerValidationSeverities();
  const validation =
    clauses.length > 0
      ? await buildValidationDiff(
          input.modelId,
          baseSnapshot,
          targetSnapshot,
          clauses,
          severities,
          warnings,
        )
      : null;

  return {
    modelId: input.modelId,
    baseVersion: input.baseVersion,
    targetVersion: input.targetVersion,
    summary: {
      baseElementCount: diff.baseElementCount,
      targetElementCount: diff.targetElementCount,
      addedCount: diff.addedCount,
      removedCount: diff.removedCount,
      changedCount: diff.changedCount,
      truncated: diff.truncated,
      warnings,
    },
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    validation,
  };
}
