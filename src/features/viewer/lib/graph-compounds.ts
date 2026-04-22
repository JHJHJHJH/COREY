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

function normalizeIfcClass(category: string | null) {
  return category?.trim().toUpperCase() ?? "";
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
