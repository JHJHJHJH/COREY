import type { ViewerKnowledgeContext } from "@/features/viewer/types";

export type RankableKnowledgeRow = {
  id: string;
  content: string;
  metadata: unknown;
};

export function viewerKnowledgeContextTerms(context: ViewerKnowledgeContext | undefined) {
  if (!context) return [];
  return [
    context.ifcType,
    context.subtype,
    ...context.properties.flatMap((property) => [property.group, property.name, property.value]),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 2);
}

export function reciprocalRankFuse<T extends RankableKnowledgeRow>(
  vectorRows: T[],
  keywordRows: T[],
  terms: string[],
) {
  const results = new Map<string, T & { fused: number }>();
  const add = (rows: T[], weight: number) => {
    rows.forEach((row, index) => {
      const current = results.get(row.id) ?? { ...row, fused: 0 };
      current.fused += weight / (60 + index + 1);
      results.set(row.id, current);
    });
  };
  add(vectorRows, 1);
  add(keywordRows, 0.85);
  for (const row of results.values()) {
    const haystack = `${row.content} ${JSON.stringify(row.metadata)}`.toLowerCase();
    const matches = terms.filter((term) => haystack.includes(term)).length;
    row.fused += Math.min(matches, 6) * 0.003;
  }
  return [...results.values()].sort((left, right) => right.fused - left.fused);
}
