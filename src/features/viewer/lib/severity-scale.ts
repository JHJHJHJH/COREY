import type {
  ViewerValidationResult,
  ViewerValidationSeverity,
} from "@/features/viewer/types";
import { VIEWER_VALIDATION_OK_RESULT } from "@/features/viewer/types";

/**
 * Runtime replacement for the compile-time severity union.
 *
 * Severities are user-configurable, so ordering can no longer live in a module constant. Build a
 * scale once from the config and pass it to anything that ranks, sorts, or buckets severities.
 */
export interface ViewerSeverityScale {
  /** Configured severities, least severe first. Never empty. */
  list: ViewerValidationSeverity[];
  /** Same list, most severe first — the order severity pickers and tables present. */
  descending: ViewerValidationSeverity[];
  ids: string[];
  byId: Map<string, ViewerValidationSeverity>;
  get(id: string): ViewerValidationSeverity | null;
  /** `"ok"` always ranks below every severity; an unknown id ranks as the most severe. */
  rank(result: ViewerValidationResult): number;
  /** The worst of the given results, or `"ok"` when none are supplied. */
  worst(results: Iterable<ViewerValidationResult>): ViewerValidationResult;
  /** Where an unrecognised `failSeverity` lands: the most severe level, never a downgrade. */
  fallbackId: string;
  /** Resolves a stored id to a configured one, falling back to `fallbackId`. */
  resolve(id: string): string;
}

const OK_RANK = -1;

export function buildViewerSeverityScale(
  severities: ViewerValidationSeverity[],
): ViewerSeverityScale {
  const list = [...severities].sort((left, right) => left.order - right.order);
  const byId = new Map(list.map((severity) => [severity.id, severity]));
  const rankById = new Map(list.map((severity, index) => [severity.id, index]));
  // An unknown id must outrank every real severity so a dangling reference is never silently
  // treated as the mildest problem.
  const unknownRank = list.length;
  const fallbackId = list[list.length - 1]?.id ?? "";

  function rank(result: ViewerValidationResult) {
    if (result === VIEWER_VALIDATION_OK_RESULT) {
      return OK_RANK;
    }

    return rankById.get(result) ?? unknownRank;
  }

  return {
    list,
    descending: [...list].reverse(),
    ids: list.map((severity) => severity.id),
    byId,
    get: (id) => byId.get(id) ?? null,
    rank,
    worst(results) {
      let worst: ViewerValidationResult = VIEWER_VALIDATION_OK_RESULT;
      let worstRank = OK_RANK;
      for (const result of results) {
        const candidate = rank(result);
        if (candidate > worstRank) {
          worst = result;
          worstRank = candidate;
        }
      }

      return worst;
    },
    fallbackId,
    resolve: (id) => (byId.has(id) ? id : fallbackId),
  };
}

/** Descending-severity comparator, matching how failures are presented worst-first. */
export function compareBySeverityDesc(
  scale: ViewerSeverityScale,
  left: ViewerValidationResult,
  right: ViewerValidationResult,
) {
  return scale.rank(right) - scale.rank(left);
}
