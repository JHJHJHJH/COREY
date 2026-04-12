import type {
  ModelMetadata,
  ViewerDataTableData,
  ViewerValidationDiagnosisClause,
  ViewerValidationDiagnosisElement,
  ViewerValidationDiagnosisReport,
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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildViewerValidationDiagnosisReport(input: {
  metadata: ModelMetadata | null;
  data: ViewerDataTableData | null;
  result: ViewerValidationRunResult | null;
}): ViewerValidationDiagnosisReport | null {
  const { data, metadata, result } = input;
  if (!data || !result) {
    return null;
  }

  const rowByElementId = new Map<string, ViewerDataTableData["rows"][number]>();
  for (const row of data.rows) {
    rowByElementId.set(`${row.modelId}:${row.localId}`, row);
  }

  const clauses = new Map<
    string,
    {
      clauseId: string;
      clauseTitle: string;
      result: ViewerValidationFailureSeverity;
      ruleDescriptions: Set<string>;
      elements: ViewerValidationDiagnosisElement[];
    }
  >();
  let warnElementCount = 0;
  let errorElementCount = 0;

  for (const elementResult of result.results) {
    if (elementResult.result === "error") {
      errorElementCount += 1;
    } else {
      warnElementCount += 1;
    }

    const row = rowByElementId.get(`${elementResult.modelId}:${elementResult.localId}`);
    if (!row) {
      continue;
    }

    const globalId = row.cells.globalId?.state === "present" ? textValue(row.cells.globalId.text) : null;
    const name = row.cells.name?.state === "present" ? textValue(row.cells.name.text) : null;
    const label = name ?? row.selection.label ?? `#${row.localId}`;

    for (const clauseFailure of elementResult.failedClauses) {
      const existingClause = clauses.get(clauseFailure.clauseId);
      const element: ViewerValidationDiagnosisElement = {
        rowKey: row.key,
        modelId: row.modelId,
        localId: row.localId,
        label,
        category: row.selection.category,
        ifcType: row.ifcType,
        globalId,
        name,
        result: clauseFailure.result,
        failedRuleCount: clauseFailure.rules.length,
        failedRuleDescriptions: uniqueStrings(
          clauseFailure.rules.map((rule) => rule.description),
        ),
      };

      if (!existingClause) {
        clauses.set(clauseFailure.clauseId, {
          clauseId: clauseFailure.clauseId,
          clauseTitle: clauseFailure.clauseTitle,
          result: clauseFailure.result,
          ruleDescriptions: new Set(element.failedRuleDescriptions),
          elements: [element],
        });
        continue;
      }

      existingClause.result =
        compareValidationFailureSeverity(clauseFailure.result, existingClause.result) < 0
          ? clauseFailure.result
          : existingClause.result;

      for (const description of element.failedRuleDescriptions) {
        existingClause.ruleDescriptions.add(description);
      }
      existingClause.elements.push(element);
    }
  }

  const sortedClauses: ViewerValidationDiagnosisClause[] = [...clauses.values()]
    .map((clause) => ({
      clauseId: clause.clauseId,
      clauseTitle: clause.clauseTitle,
      result: clause.result,
      elementCount: clause.elements.length,
      ruleDescriptions: [...clause.ruleDescriptions],
      elements: [...clause.elements].sort((left, right) => {
        const severityComparison = compareValidationFailureSeverity(left.result, right.result);
        if (severityComparison !== 0) {
          return severityComparison;
        }

        const leftLabel = left.name ?? left.label;
        const rightLabel = right.name ?? right.label;
        const labelComparison = leftLabel.localeCompare(rightLabel, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (labelComparison !== 0) {
          return labelComparison;
        }

        return left.localId - right.localId;
      }),
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

  return {
    sourceId: result.sourceId,
    modelName: metadata?.name ?? null,
    flaggedElementCount: result.results.length,
    warnElementCount,
    errorElementCount,
    failedClauseCount: sortedClauses.length,
    clauses: sortedClauses,
  };
}
