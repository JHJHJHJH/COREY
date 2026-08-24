import {
  buildViewerSeverityScale,
  compareBySeverityDesc,
} from "@/features/viewer/lib/severity-scale";
import {
  collectElementResultSeverities,
  createEmptyViewerValidationSeverityRowKeys,
} from "@/features/viewer/lib/validation-severity";
import type {
  ViewerDataTableData,
  ViewerValidationClauseTableView,
  ViewerValidationFailureSeverity,
  ViewerValidationRunResult,
  ViewerValidationSeverityRowKeys,
} from "@/features/viewer/types";



function buildRowKeyByElementId(data: ViewerDataTableData) {
  const rowKeyByElementId = new Map<string, string>();
  for (const row of data.rows) {
    rowKeyByElementId.set(`${row.modelId}:${row.localId}`, row.key);
  }

  return rowKeyByElementId;
}

/**
 * Data table row keys bucketed by every severity they failed at, so an element with both a
 * warn and an error failure appears in both sets. See
 * `collectElementResultSeverities` for why `elementResult.result` is not used here.
 */
export function buildViewerValidationSeverityRowKeys(input: {
  data: ViewerDataTableData | null;
  result: ViewerValidationRunResult | null;
}): ViewerValidationSeverityRowKeys {
  const { data, result } = input;
  const rowKeys = createEmptyViewerValidationSeverityRowKeys(result?.severities ?? []);
  if (!data || !result) {
    return rowKeys;
  }

  const rowKeyByElementId = buildRowKeyByElementId(data);
  for (const elementResult of result.results) {
    const rowKey = rowKeyByElementId.get(`${elementResult.modelId}:${elementResult.localId}`);
    if (!rowKey) {
      continue;
    }

    for (const severity of collectElementResultSeverities(elementResult)) {
      rowKeys[severity]?.add(rowKey);
    }
  }

  return rowKeys;
}

export function buildViewerValidationClauseTableViews(input: {
  data: ViewerDataTableData | null;
  result: ViewerValidationRunResult | null;
}): ViewerValidationClauseTableView[] {
  const { data, result } = input;
  if (!data || !result) {
    return [];
  }

  const scale = buildViewerSeverityScale(result.severities);
  const rowKeyByElementId = buildRowKeyByElementId(data);

  const clauses = new Map<
    string,
    {
      clauseId: string;
      clauseTitle: string;
      result: ViewerValidationFailureSeverity;
      rowKeys: Set<string>;
    }
  >();

  for (const elementResult of result.results) {
    const rowKey = rowKeyByElementId.get(`${elementResult.modelId}:${elementResult.localId}`);
    if (!rowKey) {
      continue;
    }

    for (const clauseFailure of elementResult.failedClauses) {
      const existingClause = clauses.get(clauseFailure.clauseId);
      if (!existingClause) {
        clauses.set(clauseFailure.clauseId, {
          clauseId: clauseFailure.clauseId,
          clauseTitle: clauseFailure.clauseTitle,
          result: clauseFailure.result,
          rowKeys: new Set([rowKey]),
        });
        continue;
      }

      existingClause.result =
        compareBySeverityDesc(scale, clauseFailure.result, existingClause.result) < 0
          ? clauseFailure.result
          : existingClause.result;
      existingClause.rowKeys.add(rowKey);
    }
  }

  return [...clauses.values()]
    .map((clause) => ({
      clauseId: clause.clauseId,
      clauseTitle: clause.clauseTitle,
      result: clause.result,
      elementCount: clause.rowKeys.size,
      rowKeys: [...clause.rowKeys],
    }))
    .sort((left, right) => {
      const severityComparison = compareBySeverityDesc(scale, left.result, right.result);
      if (severityComparison !== 0) {
        return severityComparison;
      }

      if (left.elementCount !== right.elementCount) {
        return right.elementCount - left.elementCount;
      }

      return left.clauseTitle.localeCompare(right.clauseTitle, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
}
