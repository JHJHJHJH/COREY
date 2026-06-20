import type {
  ViewerDataTableData,
  ViewerValidationClauseTableView,
  ViewerValidationFailureSeverity,
  ViewerValidationRunResult,
} from "@/features/viewer/types";

function compareValidationFailureSeverity(
  left: ViewerValidationFailureSeverity,
  right: ViewerValidationFailureSeverity,
) {
  const rank: Record<ViewerValidationFailureSeverity, number> = {
    warn: 1,
    error: 2,
  };

  return rank[right] - rank[left];
}

export function buildViewerValidationClauseTableViews(input: {
  data: ViewerDataTableData | null;
  result: ViewerValidationRunResult | null;
}): ViewerValidationClauseTableView[] {
  const { data, result } = input;
  if (!data || !result) {
    return [];
  }

  const rowKeyByElementId = new Map<string, string>();
  for (const row of data.rows) {
    rowKeyByElementId.set(`${row.modelId}:${row.localId}`, row.key);
  }

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
        compareValidationFailureSeverity(clauseFailure.result, existingClause.result) < 0
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
      const severityComparison = compareValidationFailureSeverity(left.result, right.result);
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
