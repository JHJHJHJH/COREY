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

/**
 * IFC inverse-attribute pairs collapse onto a shared `family` so that expanding either endpoint
 * produces the same edge id. `direction: "forward"` means the anchor is the edge source.
 */
const relationSemantics: Record<string, RelationSemantics> = {
  // Spatial structure
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
  ServicesBuildings: {
    family: "services",
    label: "Serves",
    group: "spatial",
    direction: "forward",
  },
  ServicedBySystems: {
    family: "services",
    label: "Serves",
    group: "spatial",
    direction: "inverse",
  },

  // Type definition. IFC4 pairs IsTypedBy with TypesObject; IFC2x3 names the type side
  // ObjectTypeOf. Kept apart from the property family below so the two can be filtered
  // separately — IFC2x3's IsDefinedBy carries both, and psets are the common case.
  IsTypedBy: {
    family: "typing",
    label: "Type of",
    group: "type",
    direction: "inverse",
  },
  TypesObject: {
    family: "typing",
    label: "Type of",
    group: "type",
    direction: "forward",
  },
  ObjectTypeOf: {
    family: "typing",
    label: "Type of",
    group: "type",
    direction: "forward",
  },

  // Property and quantity set definition.
  IsDefinedBy: {
    family: "definition",
    label: "Defines",
    group: "property",
    direction: "inverse",
  },
  DefinesOccurrence: {
    family: "definition",
    label: "Defines",
    group: "property",
    direction: "forward",
  },

  // Associations. The relation name alone cannot tell a material from a classification or a
  // document, so the concrete family and label come from the source item's IFC class — see
  // `resolveAssociationSemantics`.
  AssociatedTo: {
    family: "association",
    label: "Association",
    group: "association",
    direction: "forward",
  },
  HasAssociations: {
    family: "association",
    label: "Association",
    group: "association",
    direction: "inverse",
  },

  // Connectivity: voids, fillings, connections, coverings and ports.
  HasOpenings: {
    family: "voiding",
    label: "Opening",
    group: "connection",
    direction: "forward",
  },
  VoidsElements: {
    family: "voiding",
    label: "Opening",
    group: "connection",
    direction: "inverse",
  },
  HasFillings: {
    family: "filling",
    label: "Fills",
    group: "connection",
    direction: "forward",
  },
  FillsVoids: {
    family: "filling",
    label: "Fills",
    group: "connection",
    direction: "inverse",
  },
  ConnectedTo: {
    family: "connectivity",
    label: "Connected",
    group: "connection",
    direction: "forward",
  },
  ConnectedFrom: {
    family: "connectivity",
    label: "Connected",
    group: "connection",
    direction: "inverse",
  },
  HasCoverings: {
    family: "covering",
    label: "Covering",
    group: "connection",
    direction: "forward",
  },
  CoversElements: {
    family: "covering",
    label: "Covering",
    group: "connection",
    direction: "inverse",
  },
  CoversSpaces: {
    family: "covering",
    label: "Covering",
    group: "connection",
    direction: "inverse",
  },
  HasPorts: {
    family: "ports",
    label: "Port",
    group: "connection",
    direction: "forward",
  },
  ContainedIn: {
    family: "ports",
    label: "Port",
    group: "connection",
    direction: "inverse",
  },

  // Assignments: groups, systems, actors, controls, processes and resources.
  IsGroupedBy: {
    family: "assignment",
    label: "Assigned",
    group: "other",
    direction: "forward",
  },
  HasAssignments: {
    family: "assignment",
    label: "Assigned",
    group: "other",
    direction: "inverse",
  },
};

export function viewerGraphNodeId(modelId: string, localId: number) {
  return `${modelId}::${localId}`;
}

export function classifyViewerGraphNode(ifcType: string | null): ViewerGraphNodeKind {
  const category = ifcType?.trim().toUpperCase() ?? "";
  if (!category) return "other";

  // Anchored so that element classes merely *containing* a keyword — IFCSYSTEMFURNITUREELEMENT,
  // for one — are not mistaken for spatial containers.
  if (
    /^(IFC)?(PROJECT|SITE|BUILDING|BUILDINGSTOREY|SPACE|FACILITY|FACILITYPART|ZONE|GROUP|SYSTEM|BUILDINGSYSTEM|DISTRIBUTIONSYSTEM)$/.test(
      category,
    )
  ) {
    return "spatial";
  }
  if (category.endsWith("TYPE")) return "type";
  if (category.includes("PROPERTY") || category.includes("QUANTITY")) return "property";
  if (category.includes("MATERIAL")) return "material";
  // External resources reached through IfcRelAssociates*. Without this they would fall through to
  // the `IFC` prefix test below and paint as building elements.
  if (
    category.includes("CLASSIFICATION") ||
    category.includes("DOCUMENT") ||
    category.includes("LIBRARY") ||
    category.includes("CONSTRAINT")
  ) {
    return "other";
  }
  if (category.startsWith("IFC")) return "element";
  return "other";
}

/**
 * `HasAssociations`/`AssociatedTo` carries materials, classifications, documents, libraries and
 * constraints alike, so the relation name cannot label the edge on its own. The association
 * resource is always the edge *source*, so its IFC class decides both the label and the family —
 * the family has to vary too, or a material and a classification on the same pair would collide
 * on one edge id.
 */
export function resolveAssociationSemantics(sourceIfcType: string | null) {
  const category = sourceIfcType?.trim().toUpperCase() ?? "";
  if (category.includes("CLASSIFICATION")) {
    return { family: "association-classification", label: "Classification" };
  }
  if (category.includes("DOCUMENT")) {
    return { family: "association-document", label: "Document" };
  }
  if (category.includes("LIBRARY")) {
    return { family: "association-library", label: "Library" };
  }
  if (category.includes("CONSTRAINT")) {
    return { family: "association-constraint", label: "Constraint" };
  }
  if (category.includes("MATERIAL")) {
    return { family: "association-material", label: "Material" };
  }
  return { family: "association", label: "Association" };
}

/**
 * IFC2x3 routes both property sets and the type through `IsDefinedBy`, so — as with associations
 * — the relation name alone cannot say which. The definition source is the edge source, and its
 * class decides. Without this an IFC2x3 type link built from the occupant (`IsDefinedBy`) and the
 * same link built from the type (`ObjectTypeOf`) would land in different families and draw twice.
 */
export function resolveDefinitionSemantics(sourceIfcType: string | null) {
  return classifyViewerGraphNode(sourceIfcType) === "type"
    ? { family: "typing", label: "Type of", group: "type" as const }
    : { family: "definition", label: "Defines", group: "property" as const };
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
  /** The anchor's IFC class. Only needed to label association edges. */
  anchorIfcType?: string | null;
  relation: string;
  relatedLocalId: number;
  /** The related item's IFC class. Only needed to label association edges. */
  relatedIfcType?: string | null;
}): ViewerGraphEdge {
  const semantics = relationSemantics[input.relation] ?? {
    family: input.relation.toLowerCase(),
    label: input.relation,
    group: "other" as const,
    direction: "forward" as const,
  };
  const forward = semantics.direction === "forward";
  const sourceLocalId = forward ? input.anchorLocalId : input.relatedLocalId;
  const targetLocalId = forward ? input.relatedLocalId : input.anchorLocalId;

  let { family, label, group } = semantics;
  // Both of these families are ambiguous by name; the edge source always carries the class that
  // resolves them, whichever endpoint the caller happened to expand from.
  const sourceIfcType = (forward ? input.anchorIfcType : input.relatedIfcType) ?? null;
  if (family === "association") {
    const resolved = resolveAssociationSemantics(sourceIfcType);
    family = resolved.family;
    label = resolved.label;
  } else if (family === "definition") {
    const resolved = resolveDefinitionSemantics(sourceIfcType);
    family = resolved.family;
    label = resolved.label;
    group = resolved.group;
  }

  return {
    id: `${input.modelId}::${family}::${sourceLocalId}::${targetLocalId}`,
    source: viewerGraphNodeId(input.modelId, sourceLocalId),
    target: viewerGraphNodeId(input.modelId, targetLocalId),
    sourceLocalId,
    targetLocalId,
    relation: label,
    relationGroup: group,
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
  // The nodes that were not on screen before. They are the ones with no layout position yet, so
  // the panel seeds them next to the hub they were expanded from rather than letting d3 drop them
  // on a spiral around the world origin.
  const addedLocalIds: number[] = [];
  for (const node of neighborhood.nodes) {
    if (nodes.has(node.localId)) continue;
    if (nodes.size >= maxNodes) continue;
    nodes.set(node.localId, node);
    addedLocalIds.push(node.localId);
  }

  for (const edge of neighborhood.edges) {
    if (!nodes.has(edge.sourceLocalId) || !nodes.has(edge.targetLocalId)) continue;
    edges.set(edge.id, mergeViewerGraphEdge(edges.get(edge.id), edge));
  }

  return { atNodeLimit: nodes.size >= maxNodes, addedLocalIds };
}

/**
 * Removes everything a hub node brought into the graph, leaving the hub itself in place.
 *
 * A neighbour survives only if it is still reachable from the anchor *without passing through*
 * `localId`, so collapsing a storey drops the elements it contributed but keeps any of them that
 * are also, say, aggregated under something else still on screen.
 */
export function collapseViewerGraphNode(input: {
  localId: number;
  anchorLocalId: number;
  nodes: Map<number, ViewerGraphNode>;
  edges: Map<string, ViewerGraphEdge>;
  /** Never removed, whatever the reachability result — the current selection, typically. */
  keepLocalIds?: Iterable<number>;
}): { removedLocalIds: number[] } {
  const { localId, anchorLocalId, nodes, edges } = input;
  if (localId === anchorLocalId || !nodes.has(localId)) return { removedLocalIds: [] };

  const adjacency = new Map<number, number[]>();
  const link = (from: number, to: number) => {
    const neighbours = adjacency.get(from);
    if (neighbours) neighbours.push(to);
    else adjacency.set(from, [to]);
  };
  for (const edge of edges.values()) {
    link(edge.sourceLocalId, edge.targetLocalId);
    link(edge.targetLocalId, edge.sourceLocalId);
  }

  const kept = new Set<number>([anchorLocalId, localId, ...(input.keepLocalIds ?? [])]);
  const queue = [anchorLocalId];
  const visited = new Set<number>([anchorLocalId]);
  while (queue.length > 0) {
    const current = queue.shift() as number;
    // The collapsed node is reachable but is not a route to anything else.
    if (current === localId) continue;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (visited.has(neighbour)) continue;
      visited.add(neighbour);
      kept.add(neighbour);
      queue.push(neighbour);
    }
  }

  const removedLocalIds = [...nodes.keys()].filter((candidate) => !kept.has(candidate));
  if (removedLocalIds.length === 0) return { removedLocalIds };

  const removed = new Set(removedLocalIds);
  for (const candidate of removedLocalIds) nodes.delete(candidate);
  for (const [edgeId, edge] of edges) {
    if (removed.has(edge.sourceLocalId) || removed.has(edge.targetLocalId)) edges.delete(edgeId);
  }

  return { removedLocalIds };
}
