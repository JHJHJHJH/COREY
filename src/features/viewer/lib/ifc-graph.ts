import type {
  ViewerGraphEdge,
  ViewerGraphNeighborhood,
  ViewerGraphNode,
  ViewerGraphNodeKind,
  ViewerGraphRelationGroup,
} from "@/features/viewer/types";

export const VIEWER_GRAPH_PAGE_SIZE = 100;
export const VIEWER_GRAPH_MAX_NODES = 500;

export type ViewerGraphRelationRecord = {
  relation: string;
  targetLocalId: number;
};

type RelationSemantics = {
  family: string;
  label: string;
  group: ViewerGraphRelationGroup;
  direction: "forward" | "inverse";
};

const relationSemantics: Record<string, RelationSemantics> = {
  ContainsElements: {
    family: "spatial-containment",
    label: "Contains",
    group: "spatial",
    direction: "forward",
  },
  ContainedInStructure: {
    family: "spatial-containment",
    label: "Contains",
    group: "spatial",
    direction: "inverse",
  },
  IsDecomposedBy: {
    family: "aggregation",
    label: "Aggregates",
    group: "spatial",
    direction: "forward",
  },
  Decomposes: {
    family: "aggregation",
    label: "Aggregates",
    group: "spatial",
    direction: "inverse",
  },
  IsNestedBy: {
    family: "nesting",
    label: "Nests",
    group: "spatial",
    direction: "forward",
  },
  Nests: {
    family: "nesting",
    label: "Nests",
    group: "spatial",
    direction: "inverse",
  },
  ReferencesElements: {
    family: "spatial-reference",
    label: "References",
    group: "spatial",
    direction: "forward",
  },
  ReferencedInStructures: {
    family: "spatial-reference",
    label: "References",
    group: "spatial",
    direction: "inverse",
  },
  DefinesOccurrence: {
    family: "definition",
    label: "Defines",
    group: "definition",
    direction: "forward",
  },
  ObjectTypeOf: {
    family: "definition",
    label: "Defines",
    group: "definition",
    direction: "forward",
  },
  IsDefinedBy: {
    family: "definition",
    label: "Defines",
    group: "definition",
    direction: "inverse",
  },
  AssociatedTo: {
    family: "material-association",
    label: "Material",
    group: "material",
    direction: "forward",
  },
  HasAssociations: {
    family: "material-association",
    label: "Material",
    group: "material",
    direction: "inverse",
  },
};

export function viewerGraphNodeId(modelId: string, localId: number) {
  return `${modelId}::${localId}`;
}

export function classifyViewerGraphNode(ifcType: string | null): ViewerGraphNodeKind {
  const category = ifcType?.trim().toUpperCase() ?? "";
  if (!category) return "other";

  if (
    /^(IFC)?(PROJECT|SITE|BUILDING|BUILDINGSTOREY|SPACE|FACILITY|FACILITYPART|ZONE)$/.test(
      category,
    )
  ) {
    return "spatial";
  }
  if (category.endsWith("TYPE")) return "type";
  if (category.includes("PROPERTY") || category.includes("QUANTITY")) return "property";
  if (category.includes("MATERIAL")) return "material";
  if (category.startsWith("IFC")) return "element";
  return "other";
}

export function flattenViewerGraphRelations(
  relations: Record<string, number[]> | null | undefined,
): ViewerGraphRelationRecord[] {
  if (!relations) return [];

  return Object.entries(relations)
    .flatMap(([relation, localIds]) =>
      localIds
        .filter((localId) => Number.isInteger(localId) && localId >= 0)
        .map((targetLocalId) => ({ relation, targetLocalId })),
    )
    .sort(
      (left, right) =>
        left.relation.localeCompare(right.relation) || left.targetLocalId - right.targetLocalId,
    );
}

export function paginateViewerGraphRelations(
  relations: ViewerGraphRelationRecord[],
  requestedOffset: number,
  requestedLimit: number,
) {
  const offset = Math.min(relations.length, Math.max(0, Math.floor(requestedOffset)));
  const limit = Math.min(
    VIEWER_GRAPH_PAGE_SIZE,
    Math.max(1, Math.floor(requestedLimit)),
  );
  const page = relations.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    page,
    offset,
    nextOffset: nextOffset < relations.length ? nextOffset : null,
    totalRelationCount: relations.length,
  };
}

export function buildViewerGraphEdge(input: {
  modelId: string;
  anchorLocalId: number;
  relation: string;
  relatedLocalId: number;
}): ViewerGraphEdge {
  const semantics = relationSemantics[input.relation] ?? {
    family: input.relation.toLowerCase(),
    label: input.relation,
    group: "other" as const,
    direction: "forward" as const,
  };
  const sourceLocalId =
    semantics.direction === "forward" ? input.anchorLocalId : input.relatedLocalId;
  const targetLocalId =
    semantics.direction === "forward" ? input.relatedLocalId : input.anchorLocalId;

  return {
    id: `${input.modelId}::${semantics.family}::${sourceLocalId}::${targetLocalId}`,
    source: viewerGraphNodeId(input.modelId, sourceLocalId),
    target: viewerGraphNodeId(input.modelId, targetLocalId),
    sourceLocalId,
    targetLocalId,
    relation: semantics.label,
    relationGroup: semantics.group,
    rawRelations: [input.relation],
  };
}

export function mergeViewerGraphEdge(
  current: ViewerGraphEdge | undefined,
  incoming: ViewerGraphEdge,
): ViewerGraphEdge {
  if (!current) return incoming;

  return {
    ...current,
    rawRelations: [...new Set([...current.rawRelations, ...incoming.rawRelations])].sort(),
  };
}

export function mergeViewerGraphNeighborhood(input: {
  neighborhood: ViewerGraphNeighborhood;
  nodes: Map<number, ViewerGraphNode>;
  edges: Map<string, ViewerGraphEdge>;
  maxNodes?: number;
}) {
  const { neighborhood, nodes, edges, maxNodes = VIEWER_GRAPH_MAX_NODES } = input;
  for (const node of neighborhood.nodes) {
    if (nodes.has(node.localId) || nodes.size < maxNodes) {
      nodes.set(node.localId, nodes.get(node.localId) ?? node);
    }
  }

  for (const edge of neighborhood.edges) {
    if (!nodes.has(edge.sourceLocalId) || !nodes.has(edge.targetLocalId)) continue;
    edges.set(edge.id, mergeViewerGraphEdge(edges.get(edge.id), edge));
  }

  return { atNodeLimit: nodes.size >= maxNodes };
}
