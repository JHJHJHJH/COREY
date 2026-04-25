import type { ViewerGraphNode, ViewerSelectionGraphContext } from "@/features/viewer/types";

type KeyedNode = {
  key: string;
};

type AdaptiveLabelVisibilityInput = {
  nodeKeys: ReadonlyArray<string>;
  sparseOverview: boolean;
  searchActive: boolean;
  focusNodeKey: string | null;
  deemphasizedNodeKeys: ReadonlySet<string>;
  selectedPathKeys: ReadonlySet<string>;
};

type SparseOverviewTuningInput = {
  visibleNodeCount: number;
  hasCompoundGroups: boolean;
  searchActive: boolean;
  focusNodeKey: string | null;
};

type GraphPanDirection = "up" | "down" | "left" | "right";

type GraphPanDeltaInput = {
  direction: GraphPanDirection;
  viewportWidth: number;
  viewportHeight: number;
};

type KeyedEdge = {
  sourceKey: string;
  targetKey: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function buildSelectionGraphContext(input: {
  nodes: ReadonlyArray<ViewerGraphNode>;
  selectedLocalId: number | null;
  matchedNodeKeys?: ReadonlySet<string>;
  orderedMatchedNodeKeys?: ReadonlyArray<string>;
  activeMatchNodeKey?: string | null;
  searchQuery?: string;
}): ViewerSelectionGraphContext | null {
  if (input.selectedLocalId === null) {
    return null;
  }

  const selectedNode = input.nodes.find((node) => node.localId === input.selectedLocalId);
  if (!selectedNode) {
    return null;
  }

  const nodeByKey = new Map(input.nodes.map((node) => [node.key, node]));
  const parentNode = selectedNode.parentKey ? nodeByKey.get(selectedNode.parentKey) ?? null : null;
  const normalizedSearchQuery = input.searchQuery?.trim() ?? "";
  const matchedNodeKeys = input.matchedNodeKeys ?? new Set<string>();
  const orderedMatchedNodeKeys = input.orderedMatchedNodeKeys ?? [];
  const activeMatchIndex =
    input.activeMatchNodeKey && orderedMatchedNodeKeys.includes(input.activeMatchNodeKey)
      ? orderedMatchedNodeKeys.indexOf(input.activeMatchNodeKey)
      : -1;

  return {
    directRelationshipCount: selectedNode.directChildCount + (selectedNode.parentKey ? 1 : 0),
    childCount: selectedNode.directChildCount,
    descendantCount: selectedNode.descendantCount,
    depth: selectedNode.depth,
    parentLabel: parentNode?.label ?? null,
    parentCategory: parentNode?.category ?? null,
    isSearchMatch: matchedNodeKeys.has(selectedNode.key),
    searchQuery: normalizedSearchQuery.length > 0 ? normalizedSearchQuery : null,
    matchCount: normalizedSearchQuery.length > 0 ? matchedNodeKeys.size : null,
    activeMatchIndex: activeMatchIndex >= 0 ? activeMatchIndex : null,
  };
}

export function getSparseOverviewTuning(input: SparseOverviewTuningInput) {
  const isSparseOverview =
    input.visibleNodeCount <= 8 &&
    !input.hasCompoundGroups &&
    !input.searchActive &&
    !input.focusNodeKey;

  if (isSparseOverview) {
    return {
      isSparseOverview: true,
      fitPadding: 28,
      breadthfirstSpacingFactor: 0.82,
    };
  }

  return {
    isSparseOverview: false,
    fitPadding: 56,
    breadthfirstSpacingFactor: 1.05,
  };
}

export function getGraphPanDelta(input: GraphPanDeltaInput) {
  const horizontalDistance = clamp(Math.round(input.viewportWidth * 0.18), 80, 220);
  const verticalDistance = clamp(Math.round(input.viewportHeight * 0.18), 80, 220);

  switch (input.direction) {
    case "left":
      return { x: -horizontalDistance, y: 0 };
    case "right":
      return { x: horizontalDistance, y: 0 };
    case "up":
      return { x: 0, y: -verticalDistance };
    case "down":
      return { x: 0, y: verticalDistance };
  }
}

export function getAdaptiveLabelVisibility(input: AdaptiveLabelVisibilityInput) {
  if (input.sparseOverview || (!input.searchActive && !input.focusNodeKey)) {
    return {
      priorityLabelNodeKeys: new Set<string>(),
      suppressedLabelNodeKeys: new Set<string>(),
    };
  }

  const priorityLabelNodeKeys = new Set<string>(input.selectedPathKeys);
  if (input.focusNodeKey) {
    priorityLabelNodeKeys.add(input.focusNodeKey);
  }

  const suppressedLabelNodeKeys = new Set(
    input.nodeKeys.filter(
      (nodeKey) => input.deemphasizedNodeKeys.has(nodeKey) && !priorityLabelNodeKeys.has(nodeKey),
    ),
  );

  return {
    priorityLabelNodeKeys,
    suppressedLabelNodeKeys,
  };
}

export function buildGraphFocusContext(input: {
  nodeKeys: ReadonlyArray<string>;
  edges: ReadonlyArray<KeyedEdge>;
  focusNodeKey: string | null;
}) {
  const contextNodeKeys = new Set<string>();
  if (input.focusNodeKey) {
    contextNodeKeys.add(input.focusNodeKey);
    for (const edge of input.edges) {
      if (edge.sourceKey === input.focusNodeKey) {
        contextNodeKeys.add(edge.targetKey);
      }
      if (edge.targetKey === input.focusNodeKey) {
        contextNodeKeys.add(edge.sourceKey);
      }
    }
  }

  const deemphasizedNodeKeys = new Set(
    input.focusNodeKey
      ? input.nodeKeys.filter((nodeKey) => !contextNodeKeys.has(nodeKey))
      : [],
  );

  return {
    contextNodeKeys,
    deemphasizedNodeKeys,
  };
}

export function getGraphSearchSummary(input: {
  query: string;
  matchCount: number;
  activeMatchIndex: number;
}) {
  const normalizedQuery = input.query.trim();
  if (input.matchCount <= 0) {
    return {
      label: `No matches for "${normalizedQuery}"`,
      detail: "Try IFC class, local ID, or partial element name.",
    };
  }

  return {
    label: `${input.matchCount} matches for "${normalizedQuery}"`,
    detail: `Viewing match ${input.activeMatchIndex + 1} of ${input.matchCount}`,
  };
}

export function getOrderedVisibleMatchedNodeKeys(
  visibleNodes: ReadonlyArray<KeyedNode>,
  matchedNodeKeys: ReadonlySet<string>,
) {
  return visibleNodes.filter((node) => matchedNodeKeys.has(node.key)).map((node) => node.key);
}

export function getWrappedMatchIndex(input: {
  currentIndex: number;
  totalCount: number;
  direction: 1 | -1;
}) {
  if (input.totalCount <= 0) {
    return -1;
  }

  return (input.currentIndex + input.direction + input.totalCount) % input.totalCount;
}

export function resolveActiveMatchNodeKey(
  orderedMatchedNodeKeys: ReadonlyArray<string>,
  currentActiveMatchNodeKey: string | null,
) {
  if (orderedMatchedNodeKeys.length === 0) {
    return null;
  }

  if (
    currentActiveMatchNodeKey &&
    orderedMatchedNodeKeys.includes(currentActiveMatchNodeKey)
  ) {
    return currentActiveMatchNodeKey;
  }

  return orderedMatchedNodeKeys[0] ?? null;
}
