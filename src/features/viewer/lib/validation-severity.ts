import type {
  ViewerElementIdMap,
  ViewerValidationElementResult,
  ViewerValidationFailureSeverity,
  ViewerValidationSeverityElements,
  ViewerValidationSeverityFilter,
  ViewerValidationSeverityRowKeys,
} from "@/features/viewer/types";

export const VIEWER_SEVERITY_FILTER_OPTIONS: ReadonlyArray<{
  value: ViewerValidationSeverityFilter;
  label: string;
  /** Short form used in the data table's active-filter chip strip. */
  chipLabel: string;
}> = [
  { value: "all", label: "Any severity", chipLabel: "Any severity" },
  { value: "issues", label: "Any issue", chipLabel: "Any issue" },
  { value: "error", label: "Error", chipLabel: "Errors" },
  { value: "warn", label: "Warn", chipLabel: "Warnings" },
];

export function viewerSeverityFilterLabel(filter: ViewerValidationSeverityFilter) {
  return (
    VIEWER_SEVERITY_FILTER_OPTIONS.find((option) => option.value === filter)?.label ??
    "Any severity"
  );
}

export function viewerSeverityFilterChipLabel(filter: ViewerValidationSeverityFilter) {
  return (
    VIEWER_SEVERITY_FILTER_OPTIONS.find((option) => option.value === filter)?.chipLabel ??
    "Any severity"
  );
}

export function createEmptyViewerValidationSeverityElements(): ViewerValidationSeverityElements {
  return { warn: {}, error: {} };
}

export function createEmptyViewerValidationSeverityRowKeys(): ViewerValidationSeverityRowKeys {
  return { warn: new Set(), error: new Set() };
}

function severityBuckets(filter: ViewerValidationSeverityFilter) {
  if (filter === "issues") {
    return ["error", "warn"] as const;
  }

  return filter === "error" ? (["error"] as const) : (["warn"] as const);
}

/**
 * Severities an element actually failed at.
 *
 * Read from the individual *rule* failures, because both levels above them are max-severity
 * rollups: `elementResult.result` is the worst across the element, and `clauseFailure.result`
 * is the worst across that clause's failed rules (see `aggregateClauseFailures` in
 * `features/rules/lib/validation.ts`). Reading either one loses the warning on any element —
 * or any clause — that also has an error.
 */
export function collectElementResultSeverities(elementResult: ViewerValidationElementResult) {
  const severities = new Set<ViewerValidationFailureSeverity>();
  for (const clauseFailure of elementResult.failedClauses) {
    for (const ruleFailure of clauseFailure.rules) {
      severities.add(ruleFailure.result);
    }

    // Defensive: a clause carrying no rule detail still counts at its own severity.
    if (clauseFailure.rules.length === 0) {
      severities.add(clauseFailure.result);
    }
  }

  if (severities.size === 0) {
    severities.add(elementResult.result);
  }

  return severities;
}

export function buildViewerValidationSeverityElements(
  results: ViewerValidationElementResult[] | null,
): ViewerValidationSeverityElements {
  const elements = createEmptyViewerValidationSeverityElements();
  if (!results) {
    return elements;
  }

  for (const elementResult of results) {
    for (const severity of collectElementResultSeverities(elementResult)) {
      const bucket = elements[severity];
      const existing = bucket[elementResult.modelId] ?? new Set<number>();
      existing.add(elementResult.localId);
      bucket[elementResult.modelId] = existing;
    }
  }

  return elements;
}

export function matchesViewerValidationSeverityRowKey(
  rowKey: string,
  rowKeys: ViewerValidationSeverityRowKeys,
  filter: ViewerValidationSeverityFilter,
) {
  if (filter === "all") {
    return true;
  }

  return severityBuckets(filter).some((bucket) => rowKeys[bucket].has(rowKey));
}

/**
 * Flattens the matching severity buckets across every model key. Tree nodes carry no model id,
 * so a flat set is the only shape the tree can consume; the app is single-model today and this
 * stays correct if that changes.
 *
 * Returns `null` when the filter is inactive, which callers use to mean "no filtering". An empty
 * set is meaningful and distinct: the filter is on and nothing matches.
 */
export function collectViewerValidationLocalIds(
  elements: ViewerValidationSeverityElements,
  filter: ViewerValidationSeverityFilter,
): Set<number> | null {
  if (filter === "all") {
    return null;
  }

  const localIds = new Set<number>();
  for (const bucket of severityBuckets(filter)) {
    for (const ids of Object.values(elements[bucket])) {
      for (const localId of ids) {
        localIds.add(localId);
      }
    }
  }

  return localIds;
}

export function collectViewerValidationElementIdMap(
  elements: ViewerValidationSeverityElements,
  filter: ViewerValidationSeverityFilter,
): ViewerElementIdMap {
  const merged: ViewerElementIdMap = {};
  if (filter === "all") {
    return merged;
  }

  for (const bucket of severityBuckets(filter)) {
    for (const [modelId, ids] of Object.entries(elements[bucket])) {
      const existing = merged[modelId] ?? new Set<number>();
      for (const localId of ids) {
        existing.add(localId);
      }
      merged[modelId] = existing;
    }
  }

  return merged;
}

export function isViewerElementIdMapEmpty(elements: ViewerElementIdMap) {
  return Object.values(elements).every((ids) => ids.size === 0);
}

/**
 * Element counts per severity. An element failing at both severities is counted under both, so
 * `warn + error` can exceed the "any issue" total — that is the point of the filter.
 */
export function countViewerValidationSeverities(elements: ViewerValidationSeverityElements) {
  const count = (map: ViewerElementIdMap) =>
    Object.values(map).reduce((total, ids) => total + ids.size, 0);

  return {
    warn: count(elements.warn),
    error: count(elements.error),
    issues: collectViewerValidationLocalIds(elements, "issues")?.size ?? 0,
  };
}
