import type { ViewerGraphData, ViewerGraphNode } from "../types";

export type CompoundGroupDefinition = {
  id: string;
  anchorNodeId: string;
  label: string;
  childNodeKeys: string[];
  parentNodeKey: string;
};

export type CompoundLayoutGraph = {
  groups: CompoundGroupDefinition[];
  nodeKeyToCompoundId: Map<string, string>;
  layoutEdges: ViewerGraphData["edges"];
  visibleNodes: ViewerGraphNode[];
};

export type GraphPoint = {
  x: number;
  y: number;
};

const COMPOUND_PACKING_COLUMN_GAP = 108;
const COMPOUND_PACKING_ROW_GAP = 92;
const COMPOUND_PACKING_HEADER_OFFSET_Y = 78;
const COMPOUND_PACKING_MAX_COLUMNS = 6;

function normalizeIfcClass(category: string | null) {
  return category?.trim().toUpperCase() ?? "";
}

function getCompoundPackingColumnCount(childCount: number) {
  if (childCount <= 1) {
    return 1;
  }

  if (childCount <= 6) {
    return childCount;
  }

  return Math.min(COMPOUND_PACKING_MAX_COLUMNS, Math.max(3, Math.ceil(Math.sqrt(childCount))));
}

function collectVisibleSubtreeKeys(input: {
  rootKey: string;
  nodeByKey: Map<string, ViewerGraphNode>;
  visibleNodeKeySet: ReadonlySet<string>;
}): string[] {
  const { rootKey, nodeByKey, visibleNodeKeySet } = input;
  const subtreeKeys: string[] = [];
  const stack = [rootKey];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const currentKey = stack.pop();
    if (!currentKey || seen.has(currentKey) || !visibleNodeKeySet.has(currentKey)) {
      continue;
    }

    seen.add(currentKey);
    subtreeKeys.push(currentKey);

    const node = nodeByKey.get(currentKey);
    if (!node) {
      continue;
    }

    for (let index = node.childKeys.length - 1; index >= 0; index -= 1) {
      stack.push(node.childKeys[index] as string);
    }
  }

  return subtreeKeys;
}

function collectMovableCompoundSubtreeKeys(input: {
  rootKey: string;
  nodeByKey: Map<string, ViewerGraphNode>;
  visibleNodeKeySet: ReadonlySet<string>;
  groupsByParentNodeKey: ReadonlyMap<string, CompoundGroupDefinition[]>;
}): string[] {
  const visibleSubtreeKeys = collectVisibleSubtreeKeys(input);
  const movableKeys = [...visibleSubtreeKeys];

  for (const subtreeKey of visibleSubtreeKeys) {
    for (const group of input.groupsByParentNodeKey.get(subtreeKey) ?? []) {
      movableKeys.push(group.anchorNodeId);
    }
  }

  return movableKeys;
}

export function buildCompoundNodePositionOverrides(input: {
  groups: CompoundGroupDefinition[];
  visibleNodes: ViewerGraphNode[];
  nodePositions: ReadonlyMap<string, GraphPoint>;
}): Map<string, GraphPoint> {
  const { groups, visibleNodes, nodePositions } = input;
  const nodeByKey = new Map(visibleNodes.map((node) => [node.key, node]));
  const visibleNodeKeySet = new Set(visibleNodes.map((node) => node.key));
  const groupsByParentNodeKey = new Map<string, CompoundGroupDefinition[]>();
  const nextPositions = new Map<string, GraphPoint>();

  for (const group of groups) {
    const siblingGroups = groupsByParentNodeKey.get(group.parentNodeKey) ?? [];
    siblingGroups.push(group);
    groupsByParentNodeKey.set(group.parentNodeKey, siblingGroups);
  }

  const getCurrentPosition = (nodeKey: string) => nextPositions.get(nodeKey) ?? nodePositions.get(nodeKey);

  for (const group of groups) {
    const anchorPosition = getCurrentPosition(group.anchorNodeId);
    if (!anchorPosition) {
      continue;
    }

    const childRootKeys = group.childNodeKeys.filter((childKey) => visibleNodeKeySet.has(childKey));
    if (childRootKeys.length === 0) {
      continue;
    }

    const columnCount = getCompoundPackingColumnCount(childRootKeys.length);
    const totalWidth = (Math.min(columnCount, childRootKeys.length) - 1) * COMPOUND_PACKING_COLUMN_GAP;
    const startX = anchorPosition.x - totalWidth / 2;

    childRootKeys.forEach((childRootKey, index) => {
      const currentPosition = getCurrentPosition(childRootKey);
      if (!currentPosition) {
        return;
      }

      const columnIndex = index % columnCount;
      const rowIndex = Math.floor(index / columnCount);
      const targetPosition = {
        x: startX + columnIndex * COMPOUND_PACKING_COLUMN_GAP,
        y: anchorPosition.y + COMPOUND_PACKING_HEADER_OFFSET_Y + rowIndex * COMPOUND_PACKING_ROW_GAP,
      } satisfies GraphPoint;
      const deltaX = targetPosition.x - currentPosition.x;
      const deltaY = targetPosition.y - currentPosition.y;

      for (const subtreeKey of collectMovableCompoundSubtreeKeys({
        rootKey: childRootKey,
        nodeByKey,
        visibleNodeKeySet,
        groupsByParentNodeKey,
      })) {
        const subtreePosition = getCurrentPosition(subtreeKey);
        if (!subtreePosition) {
          continue;
        }

        nextPositions.set(subtreeKey, {
          x: subtreePosition.x + deltaX,
          y: subtreePosition.y + deltaY,
        });
      }
    });
  }

  return nextPositions;
}

export function buildCompoundLayoutGraph(input: {
  nodes: ViewerGraphNode[];
  edges: ViewerGraphData["edges"];
  denseChildThreshold: number;
  collapsedGroupIds: ReadonlySet<string>;
}): CompoundLayoutGraph {
  const { nodes, edges, denseChildThreshold, collapsedGroupIds } = input;
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const groups: CompoundGroupDefinition[] = [];
  const nodeKeyToCompoundId = new Map<string, string>();

  for (const parentNode of nodes) {
    const visibleChildNodes = parentNode.childKeys
      .map((childKey) => nodeByKey.get(childKey) ?? null)
      .filter((node): node is ViewerGraphNode => Boolean(node && node.localId !== null));

    if (visibleChildNodes.length <= denseChildThreshold) {
      continue;
    }

    const childNodesByIfcClass = new Map<string, ViewerGraphNode[]>();
    for (const childNode of visibleChildNodes) {
      const ifcClass = normalizeIfcClass(childNode.category) || childNode.kind.toUpperCase();
      const siblings = childNodesByIfcClass.get(ifcClass) ?? [];
      siblings.push(childNode);
      childNodesByIfcClass.set(ifcClass, siblings);
    }

    for (const ifcClass of [...childNodesByIfcClass.keys()].sort()) {
      const groupedNodes = childNodesByIfcClass.get(ifcClass);
      if (!groupedNodes || groupedNodes.length === 0) {
        continue;
      }

      const compoundId = `${parentNode.key}::compound::${ifcClass}`;
      groups.push({
        id: compoundId,
        anchorNodeId: `${compoundId}::anchor`,
        label: ifcClass,
        childNodeKeys: groupedNodes.map((node) => node.key),
        parentNodeKey: parentNode.key,
      });

      for (const groupedNode of groupedNodes) {
        nodeKeyToCompoundId.set(groupedNode.key, compoundId);
      }
    }
  }

  const visibleNodes = nodes.filter((node) => {
    const compoundId = nodeKeyToCompoundId.get(node.key);
    return !compoundId || !collapsedGroupIds.has(compoundId);
  });
  const visibleNodeKeySet = new Set(visibleNodes.map((node) => node.key));
  const groupAnchorEdges = groups
    .filter((group) => visibleNodeKeySet.has(group.parentNodeKey))
    .map((group) => ({
      key: `${group.parentNodeKey}->${group.anchorNodeId}`,
      sourceKey: group.parentNodeKey,
      targetKey: group.anchorNodeId,
      relation: "groups" as const,
    }));
  const layoutEdges = [
    ...groupAnchorEdges,
    ...edges.filter((edge) => visibleNodeKeySet.has(edge.sourceKey) && visibleNodeKeySet.has(edge.targetKey)),
  ];

  return {
    groups,
    nodeKeyToCompoundId,
    layoutEdges,
    visibleNodes,
  };
}
