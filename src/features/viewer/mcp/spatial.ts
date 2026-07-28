import type {
  CoreyMcpSpatialIndex,
  CoreyMcpSpatialNode,
  CoreyMcpSpatialRelation,
} from "@/features/viewer/mcp/contracts";
import { decodeMcpCursor, encodeMcpCursor, globalIdForRow } from "@/features/viewer/mcp/query";
import type { ViewerDataTableData, ViewerTreeNode } from "@/features/viewer/types";

const SPATIAL_CATEGORIES = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
  "IFCSPACE",
  "IFCFACILITY",
  "IFCFACILITYPART",
]);

function relationFor(parentType: string | null, childType: string | null): CoreyMcpSpatialRelation {
  return SPATIAL_CATEGORIES.has(childType?.toUpperCase() ?? "") &&
    SPATIAL_CATEGORIES.has(parentType?.toUpperCase() ?? "")
    ? "aggregates"
    : "contains";
}

export function buildMcpSpatialIndexFromViewerTree(
  tree: ViewerTreeNode[],
  data: ViewerDataTableData,
): CoreyMcpSpatialIndex {
  const globalIdByLocalId = new Map<number, string>();
  const rowByLocalId = new Map(data.rows.map((row) => [row.localId, row]));
  for (const row of data.rows) {
    const globalId = globalIdForRow(row);
    if (globalId) globalIdByLocalId.set(row.localId, globalId);
  }

  const nodes: Record<string, CoreyMcpSpatialNode> = {};
  const children: Record<string, string[]> = {};
  const roots: string[] = [];
  const representedChildren = (candidates: ViewerTreeNode[]): string[] =>
    candidates.flatMap((candidate) => {
      const globalId =
        candidate.localId === null ? null : globalIdByLocalId.get(candidate.localId) ?? null;
      return globalId ? [globalId] : representedChildren(candidate.children ?? []);
    });

  const visit = (
    node: ViewerTreeNode,
    parentGlobalId: string | null,
    parentType: string | null,
  ) => {
    const globalId = node.localId === null ? null : globalIdByLocalId.get(node.localId) ?? null;
    const row = node.localId === null ? null : rowByLocalId.get(node.localId) ?? null;
    const nextParent = globalId ?? parentGlobalId;
    const nextParentType = node.category ?? parentType;

    if (globalId && node.localId !== null) {
      const directChildren = representedChildren(node.children ?? []);
      nodes[globalId] = {
        globalId,
        expressId: node.localId,
        ifcType: row?.ifcType ?? node.category ?? "UNKNOWN",
        name: row?.cells.name?.state === "present" ? row.cells.name.text : node.label,
        parentGlobalId,
        relation: parentGlobalId
          ? relationFor(parentType, row?.ifcType ?? node.category)
          : null,
        childCount: directChildren.length,
        hasGeometry: Boolean(row),
      };
      children[globalId] = directChildren;
      if (!parentGlobalId) roots.push(globalId);
    }

    for (const child of node.children ?? []) {
      visit(child, nextParent, nextParentType);
    }
  };

  for (const root of tree) visit(root, null, null);
  return { nodes, children, roots };
}

export function getMcpSpatialPath(index: CoreyMcpSpatialIndex, globalId: string) {
  const path: CoreyMcpSpatialNode[] = [];
  const visited = new Set<string>();
  let current: string | null = globalId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const node: CoreyMcpSpatialNode | undefined = index.nodes[current];
    if (!node) break;
    path.push(node);
    current = node.parentGlobalId;
  }
  return path.reverse();
}

export function listMcpSpatialChildren(input: {
  spatial: CoreyMcpSpatialIndex;
  parentGlobalId?: string;
  revision: string;
  cursor?: string;
  limit?: number;
}) {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const offset = decodeMcpCursor(input.cursor, input.revision);
  if (input.parentGlobalId && !input.spatial.nodes[input.parentGlobalId]) {
    throw new Error(`Spatial node ${input.parentGlobalId} was not found.`);
  }
  const ids = input.parentGlobalId
    ? (input.spatial.children[input.parentGlobalId] ?? [])
    : input.spatial.roots;
  const items = ids
    .slice(offset, offset + limit)
    .map((globalId) => input.spatial.nodes[globalId])
    .filter((node): node is CoreyMcpSpatialNode => Boolean(node));
  const nextOffset = offset + items.length;
  return {
    parentGlobalId: input.parentGlobalId ?? null,
    total: ids.length,
    items,
    nextCursor:
      nextOffset < ids.length
        ? encodeMcpCursor({ revision: input.revision, offset: nextOffset })
        : null,
  };
}
