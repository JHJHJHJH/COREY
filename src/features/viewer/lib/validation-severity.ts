import { buildViewerSeverityScale, type ViewerSeverityScale } from "@/features/viewer/lib/severity-scale";
import type {
  ViewerElementIdMap,
  ViewerValidationElementResult,
  ViewerValidationFailureSeverity,
  ViewerValidationSeverity,
  ViewerValidationSeverityElements,
  ViewerValidationSeverityFilter,
  ViewerValidationSeverityRowKeys,
} from "@/features/viewer/types";

export interface ViewerSeverityFilterOption {
  value: ViewerValidationSeverityFilter;
  label: string;
  /** Short form used in the data table's active-filter chip strip. */
  chipLabel: string;
  /** Base colour for the option, or `null` for the aggregate options. */
  color: string | null;
}

/**
 * Filter options for a configured severity list: the two aggregates first, then one option per
 * severity most-severe first.
 */
export function buildViewerSeverityFilterOptions(
  severities: ViewerValidationSeverity[],
): ViewerSeverityFilterOption[] {
  const scale = buildViewerSeverityScale(severities);

  return [
    { value: "all", label: "Any severity", chipLabel: "Any severity", color: null },
    { value: "issues", label: "Any issue", chipLabel: "Any issue", color: null },
    ...scale.descending.map((severity) => ({
      value: severity.id,
      label: severity.label,
      chipLabel: severity.label,
      color: severity.color,
    })),
  ];
}

export function viewerSeverityFilterLabel(
  severities: ViewerValidationSeverity[],
  filter: ViewerValidationSeverityFilter,
) {
  return (
    buildViewerSeverityFilterOptions(severities).find((option) => option.value === filter)?.label ??
    "Any severity"
  );
}

export function viewerSeverityFilterChipLabel(
  severities: ViewerValidationSeverity[],
  filter: ViewerValidationSeverityFilter,
) {
  return (
    buildViewerSeverityFilterOptions(severities).find((option) => option.value === filter)
      ?.chipLabel ?? "Any severity"
  );
}

export function createEmptyViewerValidationSeverityElements(
  severities: ViewerValidationSeverity[],
): ViewerValidationSeverityElements {
  return Object.fromEntries(severities.map((severity) => [severity.id, {} as ViewerElementIdMap]));
}

export function createEmptyViewerValidationSeverityRowKeys(
  severities: ViewerValidationSeverity[],
): ViewerValidationSeverityRowKeys {
  return Object.fromEntries(severities.map((severity) => [severity.id, new Set<string>()]));
}

/** The severity ids a filter selects. `"all"` is handled by callers, which skip filtering. */
function severityBuckets(scale: ViewerSeverityScale, filter: ViewerValidationSeverityFilter) {
  if (filter === "issues") {
    return scale.ids;
  }

  return scale.ids.includes(filter) ? [filter] : [];
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
  severities: ViewerValidationSeverity[],
  results: ViewerValidationElementResult[] | null,
): ViewerValidationSeverityElements {
  const elements = createEmptyViewerValidationSeverityElements(severities);
  if (!results) {
    return elements;
  }

  for (const elementResult of results) {
    for (const severity of collectElementResultSeverities(elementResult)) {
      const bucket = elements[severity];
      // A failure naming a severity the config no longer has is dropped from the filter buckets
      // rather than folded into an unrelated one.
      if (!bucket) {
        continue;
      }

      const existing = bucket[elementResult.modelId] ?? new Set<number>();
      existing.add(elementResult.localId);
      bucket[elementResult.modelId] = existing;
    }
  }

  return elements;
}

export function matchesViewerValidationSeverityRowKey(
  severities: ViewerValidationSeverity[],
  rowKey: string,
  rowKeys: ViewerValidationSeverityRowKeys,
  filter: ViewerValidationSeverityFilter,
) {
  if (filter === "all") {
    return true;
  }

  const scale = buildViewerSeverityScale(severities);
  return severityBuckets(scale, filter).some((bucket) => rowKeys[bucket]?.has(rowKey));
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
  severities: ViewerValidationSeverity[],
  elements: ViewerValidationSeverityElements,
  filter: ViewerValidationSeverityFilter,
): Set<number> | null {
  if (filter === "all") {
    return null;
  }

  const scale = buildViewerSeverityScale(severities);
  const localIds = new Set<number>();
  for (const bucket of severityBuckets(scale, filter)) {
    for (const ids of Object.values(elements[bucket] ?? {})) {
      for (const localId of ids) {
        localIds.add(localId);
      }
    }
  }

  return localIds;
}

/**
 * Element counts per severity, plus the `issues` total. An element failing at several severities
 * is counted under each, so the per-severity counts can sum to more than `issues` — that is the
 * point of the filter.
 */
export function countViewerValidationSeverities(
  severities: ViewerValidationSeverity[],
  elements: ViewerValidationSeverityElements,
): Record<string, number> {
  const count = (map: ViewerElementIdMap | undefined) =>
    Object.values(map ?? {}).reduce((total, ids) => total + ids.size, 0);

  return {
    ...Object.fromEntries(severities.map((severity) => [severity.id, count(elements[severity.id])])),
    issues: collectViewerValidationLocalIds(severities, elements, "issues")?.size ?? 0,
  };
}
