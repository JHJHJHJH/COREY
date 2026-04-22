"use client";

import cytoscape from "cytoscape";
import { Focus, LocateFixed, Search, Workflow, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { PropertiesPanel } from "@/features/viewer/components/properties-panel";
import {
  buildViewerGraphView,
  formatBytes,
  getDefaultViewerGraphCollapsedKeys,
  getViewerGraphExpandableNodeKeys,
  getViewerGraphNodePathKeys,
  getViewerGraphSelectedNodeKey,
} from "@/features/viewer/lib/ifc-data";
import { buildCompoundLayoutGraph } from "@/features/viewer/lib/graph-compounds";
import type {
  ModelMetadata,
  ViewerGraphData,
  ViewerGraphNode,
  ViewerSelection,
  ViewerSelectionDetails,
} from "@/features/viewer/types";

type ElementRelationshipGraphProps = {
  metadata: ModelMetadata | null;
  graph: ViewerGraphData;
  activeSelection: ViewerSelection | null;
  selectionDetails: ViewerSelectionDetails;
  onSelectElement: (localId: number) => void;
  onClose: () => void;
};

type GraphToolButtonProps = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

type CytoscapeGraphNodeData = {
  id: string;
  label: string;
  detailLabel: string;
  localId: number | null;
  kind: ViewerGraphNode["kind"] | "compound" | "compound-group";
  category: string;
  color: string;
  borderColor: string;
  textColor: string;
  width: number;
  height: number;
  selectableElement: "yes" | "no";
  compoundGroupId?: string;
};

const GRAPH_MAX_VISIBLE_NODES = 900;
const MIN_GRAPH_ZOOM = 0.35;
const MAX_GRAPH_ZOOM = 2.5;
const GRAPH_ZOOM_STEP = 1.18;

const STRUCTURAL_NODE_COLORS = {
  model: { fill: "#334155", border: "#1e293b", text: "#ffffff" },
  spatial: { fill: "#2f6f73", border: "#1f5558", text: "#ffffff" },
  category: { fill: "#5d6f94", border: "#405075", text: "#ffffff" },
  element: { fill: "#62748e", border: "#475569", text: "#ffffff" },
} satisfies Record<ViewerGraphNode["kind"], { fill: string; border: string; text: string }>;

const IFC_CLASS_COLORS: Record<string, { fill: string; border: string; text: string }> = {
  IFCBEAM: { fill: "#8f5f34", border: "#704820", text: "#ffffff" },
  IFCBUILDING: { fill: "#52677a", border: "#374b5d", text: "#ffffff" },
  IFCBUILDINGELEMENTPROXY: { fill: "#68758f", border: "#4b5770", text: "#ffffff" },
  IFCBUILDINGSTOREY: { fill: "#2f6f73", border: "#1f5558", text: "#ffffff" },
  IFCCOLUMN: { fill: "#98624d", border: "#733f2e", text: "#ffffff" },
  IFCCOVERING: { fill: "#7b6aa0", border: "#5c4b81", text: "#ffffff" },
  IFCCURTAINWALL: { fill: "#2d7f9b", border: "#145f78", text: "#ffffff" },
  IFCDOOR: { fill: "#a15f2b", border: "#7d4215", text: "#ffffff" },
  IFCFURNISHINGELEMENT: { fill: "#8a687b", border: "#644557", text: "#ffffff" },
  IFCMEMBER: { fill: "#716246", border: "#514633", text: "#ffffff" },
  IFCOPENINGELEMENT: { fill: "#7c8797", border: "#596372", text: "#ffffff" },
  IFCPLATE: { fill: "#537080", border: "#38515f", text: "#ffffff" },
  IFCPROJECT: { fill: "#334155", border: "#1e293b", text: "#ffffff" },
  IFCRAILING: { fill: "#6d7b46", border: "#4c582c", text: "#ffffff" },
  IFCRAMP: { fill: "#847a3d", border: "#625a25", text: "#ffffff" },
  IFCROOF: { fill: "#9b5554", border: "#743333", text: "#ffffff" },
  IFCSITE: { fill: "#48724a", border: "#305833", text: "#ffffff" },
  IFCSLAB: { fill: "#8a6f2d", border: "#675218", text: "#ffffff" },
  IFCSPACE: { fill: "#3f7c6a", border: "#285f50", text: "#ffffff" },
  IFCSTAIR: { fill: "#7f6744", border: "#5c492a", text: "#ffffff" },
  IFCSTAIRFLIGHT: { fill: "#886f48", border: "#634f2d", text: "#ffffff" },
  IFCWALL: { fill: "#9a5b68", border: "#743746", text: "#ffffff" },
  IFCWALLSTANDARDCASE: { fill: "#a06370", border: "#7a3e4d", text: "#ffffff" },
  IFCWINDOW: { fill: "#2d7693", border: "#145772", text: "#ffffff" },
};

const FALLBACK_IFC_COLORS = [
  { fill: "#3f6f8f", border: "#264f69", text: "#ffffff" },
  { fill: "#7c5f91", border: "#5d4271", text: "#ffffff" },
  { fill: "#8a6c3f", border: "#654d28", text: "#ffffff" },
  { fill: "#4f7a56", border: "#355c3c", text: "#ffffff" },
  { fill: "#936348", border: "#6f452e", text: "#ffffff" },
  { fill: "#607142", border: "#46542d", text: "#ffffff" },
  { fill: "#40706d", border: "#2a5451", text: "#ffffff" },
  { fill: "#87596f", border: "#653b50", text: "#ffffff" },
  { fill: "#6e6a91", border: "#504d72", text: "#ffffff" },
  { fill: "#71705d", border: "#525141", text: "#ffffff" },
];

const CYTOSCAPE_STYLE = [
  {
    selector: "node",
    style: {
      width: "data(width)",
      height: "data(height)",
      "background-color": "data(color)",
      "border-color": "data(borderColor)",
      "border-width": 1.5,
      color: "data(textColor)",
      content: "data(label)",
      "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
      "font-size": 10,
      "font-weight": 700,
      "text-halign": "center",
      "text-valign": "center",
      "text-wrap": "wrap",
      "text-max-width": 124,
      "text-events": "no",
      "overlay-padding": 7,
      "overlay-opacity": 0,
      "transition-property": "background-color, border-color, border-width, opacity",
      "transition-duration": 140,
    },
  },
  {
    selector: "node[kind = 'model']",
    style: {
      shape: "round-rectangle",
      "font-size": 12,
      "text-max-width": 110,
    },
  },
  {
    selector: "node[kind = 'category']",
    style: {
      shape: "round-tag",
    },
  },
  {
    selector: "node[kind = 'compound']",
    style: {
      shape: "round-rectangle",
      padding: 20,
      "background-opacity": 0.14,
      "border-style": "dashed",
      "border-width": 1.5,
      content: "",
      "z-compound-depth": "top",
    },
  },
  {
    selector: "node[kind = 'compound-group']",
    style: {
      shape: "round-rectangle",
      width: 96,
      height: 34,
      "background-opacity": 1,
      "border-width": 2,
      "text-valign": "center",
      "text-halign": "center",
      "font-size": 11,
      "font-weight": 800,
      "text-wrap": "wrap",
      "text-max-width": 86,
      "z-index": 12,
    },
  },
  {
    selector: "node.compound-collapsed",
    style: {
      "background-opacity": 0.18,
      "border-width": 2.5,
    },
  },
  {
    selector: "node[kind = 'spatial']",
    style: {
      shape: "round-diamond",
    },
  },
  {
    selector: "node[selectableElement = 'yes']",
    style: {
      "border-width": 2,
    },
  },
  {
    selector: "node.matched-node",
    style: {
      "border-color": "#d8af80",
      "border-width": 4,
    },
  },
  {
    selector: "node.path-node",
    style: {
      "border-color": "#0a5cff",
      "border-width": 3,
    },
  },
  {
    selector: "node.selected-node",
    style: {
      "background-color": "#e7f3ee",
      "border-color": "#15803d",
      "border-width": 5,
      color: "#123524",
      "z-index": 20,
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.25,
      "line-color": "rgba(71,85,105,0.34)",
      "target-arrow-color": "rgba(71,85,105,0.34)",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      "arrow-scale": 0.72,
      "overlay-opacity": 0,
    },
  },
  {
    selector: "edge[relation = 'groups']",
    style: {
      width: 1.6,
      "line-style": "dashed",
      "line-color": "rgba(37,99,235,0.45)",
      "target-arrow-color": "rgba(37,99,235,0.45)",
    },
  },
  {
    selector: "edge.path-edge",
    style: {
      width: 2.5,
      "line-color": "rgba(10,92,255,0.55)",
      "target-arrow-color": "rgba(10,92,255,0.55)",
      "z-index": 10,
    },
  },
] as cytoscape.StylesheetStyle[];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getGraphLayoutOptions(hasCompoundGroups: boolean): cytoscape.LayoutOptions {
  if (hasCompoundGroups) {
    return {
      name: "cose",
      animate: false,
      fit: true,
      padding: 40,
      randomize: false,
      nodeDimensionsIncludeLabels: true,
      nestingFactor: 0.38,
      componentSpacing: 72,
      nodeRepulsion: 260000,
      idealEdgeLength: 68,
      edgeElasticity: 130,
      gravity: 1.2,
      numIter: 2000,
      initialTemp: 120,
      coolingFactor: 0.94,
      minTemp: 1,
    };
  }

  return {
    name: "breadthfirst",
    directed: true,
    fit: true,
    padding: 40,
    spacingFactor: 1.05,
    animate: false,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
  };
}

function runGraphLayout(cy: cytoscape.Core, hasCompoundGroups: boolean) {
  if (hasCompoundGroups) {
    cy.layout({
      name: "breadthfirst",
      directed: true,
      fit: false,
      padding: 40,
      spacingFactor: 1,
      animate: false,
      avoidOverlap: true,
      nodeDimensionsIncludeLabels: true,
    }).run();
  }

  cy.layout(getGraphLayoutOptions(hasCompoundGroups)).run();
}

function normalizeIfcClass(category: string | null) {
  return category?.trim().toUpperCase() ?? "";
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getNodeColors(node: ViewerGraphNode) {
  const ifcClass = normalizeIfcClass(node.category);
  if (ifcClass) {
    return IFC_CLASS_COLORS[ifcClass] ?? FALLBACK_IFC_COLORS[hashString(ifcClass) % FALLBACK_IFC_COLORS.length];
  }

  return STRUCTURAL_NODE_COLORS[node.kind];
}

function nodeKindLabel(kind: ViewerGraphNode["kind"]) {
  switch (kind) {
    case "model":
      return "Model";
    case "category":
      return "Category";
    case "element":
      return "Element";
    default:
      return "Spatial";
  }
}

function getVisibleNodeLabel(node: ViewerGraphNode) {
  if (node.localId !== null) {
    const ifcClass = node.category?.trim() || nodeKindLabel(node.kind);
    return `${ifcClass} #${node.localId}`;
  }

  const fallback = node.label.trim() || node.category?.trim() || nodeKindLabel(node.kind);
  return fallback.length > 28 ? `${fallback.slice(0, 27)}...` : fallback;
}

function getNodeDetailLabel(node: ViewerGraphNode) {
  const parts = [
    node.category ?? nodeKindLabel(node.kind),
    node.localId !== null ? `#${node.localId}` : null,
    node.descendantCount > 0 ? `${node.descendantCount} below` : null,
  ];

  return parts.filter(Boolean).join(" - ");
}

function getNodeSize(node: ViewerGraphNode) {
  if (node.kind === "model") {
    return { width: 110, height: 60 };
  }

  if (node.kind === "category") {
    return { width: 88, height: 42 };
  }

  if (node.kind === "spatial") {
    return { width: 82, height: 56 };
  }

  return { width: 70, height: 44 };
}

function buildGraphSignature(graph: ViewerGraphData) {
  return `${graph.totalNodeCount}:${graph.totalEdgeCount}:${graph.rootKeys.join("|")}`;
}

const DENSE_COMPOUND_CHILD_THRESHOLD = 4;

function isIfcClassGroupingNode(node: ViewerGraphNode) {
  if (node.kind === "category") {
    return true;
  }

  if (node.localId !== null) {
    return false;
  }

  const normalizedLabel = node.label.trim().toUpperCase();
  const normalizedCategory = normalizeIfcClass(node.category);
  if (!normalizedLabel || !normalizedCategory) {
    return false;
  }

  return normalizedLabel === normalizedCategory;
}

function removeCategoryGrouping(graph: ViewerGraphData): ViewerGraphData {
  const originalByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const visibleNodes = graph.nodes.filter((node) => !isIfcClassGroupingNode(node));
  const visibleKeySet = new Set(visibleNodes.map((node) => node.key));
  const flattenedNodes = new Map<string, ViewerGraphNode>(
    visibleNodes.map((node) => [
      node.key,
      {
        ...node,
        parentKey: null,
        childKeys: [],
        directChildCount: 0,
        descendantCount: 0,
        depth: 0,
      } satisfies ViewerGraphNode,
    ]),
  );

  const rootKeys: string[] = [];
  for (const node of visibleNodes) {
    let parentKey = node.parentKey;
    while (parentKey && !visibleKeySet.has(parentKey)) {
      parentKey = originalByKey.get(parentKey)?.parentKey ?? null;
    }

    const flattenedNode = flattenedNodes.get(node.key);
    if (!flattenedNode) {
      continue;
    }

    flattenedNode.parentKey = parentKey;
    if (parentKey) {
      flattenedNodes.get(parentKey)?.childKeys.push(node.key);
    } else {
      rootKeys.push(node.key);
    }
  }

  const queue = rootKeys.map((key) => ({ key, depth: 0 }));
  let maxDepth = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const node = flattenedNodes.get(current.key);
    if (!node) {
      continue;
    }

    node.depth = current.depth;
    maxDepth = Math.max(maxDepth, current.depth);
    for (const childKey of node.childKeys) {
      queue.push({ key: childKey, depth: current.depth + 1 });
    }
  }

  const flattenedNodeList = [...flattenedNodes.values()];
  const nodeByKey = new Map(flattenedNodeList.map((node) => [node.key, node]));
  for (let index = flattenedNodeList.length - 1; index >= 0; index -= 1) {
    const node = flattenedNodeList[index];
    node.directChildCount = node.childKeys.length;
    node.descendantCount = node.childKeys.reduce((count, childKey) => {
      const child = nodeByKey.get(childKey);
      return count + (child ? child.descendantCount + 1 : 0);
    }, 0);
  }

  const edges = flattenedNodeList
    .filter((node) => node.parentKey)
    .map((node) => ({
      key: `${node.parentKey}->${node.key}`,
      sourceKey: node.parentKey as string,
      targetKey: node.key,
      relation: "contains" as const,
    }));

  return {
    nodes: flattenedNodeList,
    edges,
    rootKeys,
    totalNodeCount: flattenedNodeList.length,
    totalEdgeCount: edges.length,
    maxDepth,
  } satisfies ViewerGraphData;
}

function buildCytoscapeElements(input: {
  compoundLayoutGraph: ReturnType<typeof buildCompoundLayoutGraph>;
  matchedNodeKeys: ReadonlySet<string>;
  collapsedCompoundIds: ReadonlySet<string>;
}) {
  const compoundElements: cytoscape.ElementDefinition[] = input.compoundLayoutGraph.groups.map((group) => {
    const representativeNode = input.compoundLayoutGraph.visibleNodes.find(
      (node) => group.childNodeKeys.includes(node.key),
    ) ?? null;
    const colors = representativeNode ? getNodeColors(representativeNode) : STRUCTURAL_NODE_COLORS.category;
    const classes = [input.collapsedCompoundIds.has(group.id) ? "compound-collapsed" : null]
      .filter(Boolean)
      .join(" ");

    return {
      data: {
        id: group.id,
        label: "",
        detailLabel: `${group.label} group`,
        localId: null,
        kind: "compound",
        category: group.label,
        color: colors.fill,
        borderColor: colors.border,
        textColor: colors.text,
        width: 0,
        height: 0,
        selectableElement: "no",
        compoundGroupId: group.id,
      } satisfies CytoscapeGraphNodeData,
      classes,
      grabbable: false,
      selectable: false,
    };
  });
  const compoundGroupNodeElements: cytoscape.ElementDefinition[] = input.compoundLayoutGraph.groups.map((group) => {
    const representativeNode = input.compoundLayoutGraph.visibleNodes.find(
      (node) => group.childNodeKeys.includes(node.key),
    ) ?? null;
    const colors = representativeNode ? getNodeColors(representativeNode) : STRUCTURAL_NODE_COLORS.category;
    const classes = [input.collapsedCompoundIds.has(group.id) ? "compound-collapsed" : null]
      .filter(Boolean)
      .join(" ");

    return {
      data: {
        id: group.anchorNodeId,
        label: group.label,
        detailLabel: `${group.label} group`,
        localId: null,
        kind: "compound-group",
        category: group.label,
        color: colors.fill,
        borderColor: colors.border,
        textColor: colors.text,
        width: 96,
        height: 34,
        selectableElement: "no",
        parent: group.id,
        compoundGroupId: group.id,
      } satisfies CytoscapeGraphNodeData & { parent?: string },
      classes,
      grabbable: false,
      selectable: false,
    };
  });

  const nodeElements: cytoscape.ElementDefinition[] = input.compoundLayoutGraph.visibleNodes.map((node) => {
    const colors = getNodeColors(node);
    const size = getNodeSize(node);
    const selectableElement = node.localId !== null;
    const classes = [input.matchedNodeKeys.has(node.key) ? "matched-node" : null].filter(Boolean).join(" ");

    return {
      data: {
        id: node.key,
        label: getVisibleNodeLabel(node),
        detailLabel: getNodeDetailLabel(node),
        localId: node.localId,
        kind: node.kind,
        category: normalizeIfcClass(node.category) || nodeKindLabel(node.kind),
        color: colors.fill,
        borderColor: colors.border,
        textColor: colors.text,
        width: size.width,
        height: size.height,
        selectableElement: selectableElement ? "yes" : "no",
        parent: input.compoundLayoutGraph.nodeKeyToCompoundId.get(node.key),
      } satisfies CytoscapeGraphNodeData & { parent?: string },
      classes,
      grabbable: false,
      selectable: selectableElement,
    };
  });

  const edgeElements: cytoscape.ElementDefinition[] = input.compoundLayoutGraph.layoutEdges.map((edge) => ({
    data: {
      id: edge.key,
      source: edge.sourceKey,
      target: edge.targetKey,
      relation: edge.relation,
    },
    selectable: false,
  }));

  return [...compoundElements, ...compoundGroupNodeElements, ...nodeElements, ...edgeElements];
}

function GraphToolButton({ label, disabled = false, onClick, children }: GraphToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

export function ElementRelationshipGraph({
  metadata,
  graph,
  activeSelection,
  selectionDetails,
  onSelectElement,
  onClose,
}: ElementRelationshipGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const relayoutFrameRef = useRef<number | null>(null);
  const onSelectElementRef = useRef(onSelectElement);
  const graphSignatureRef = useRef<string | null>(null);
  const shouldAutoFitRef = useRef(true);
  const lastTapRef = useRef<{ nodeKey: string; at: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const graphSignature = useMemo(() => buildGraphSignature(graph), [graph]);
  const [queryState, setQueryState] = useState(() => ({
    graphSignature,
    value: "",
  }));
  const [collapsedState, setCollapsedState] = useState(() => ({
    [graphSignature]: getDefaultViewerGraphCollapsedKeys(removeCategoryGrouping(graph), 2),
  }));
  const [collapsedCompoundState, setCollapsedCompoundState] = useState<Record<string, Set<string>>>(() => ({
    [graphSignature]: new Set<string>(),
  }));
  const query = queryState.graphSignature === graphSignature ? queryState.value : "";
  const deferredQuery = useDeferredValue(query);
  const setGraphQuery = useCallback(
    (value: string) => {
      setQueryState({ graphSignature, value });
    },
    [graphSignature],
  );
  const collapsedKeys =
    collapsedState[graphSignature] ?? getDefaultViewerGraphCollapsedKeys(removeCategoryGrouping(graph), 2);
  const collapsedCompoundIds = useMemo(
    () => collapsedCompoundState[graphSignature] ?? new Set<string>(),
    [collapsedCompoundState, graphSignature],
  );
  const updateCollapsedKeys = useCallback(
    (updater: (current: Set<string>) => Set<string>) => {
      setCollapsedState((current) => {
        const base = current[graphSignature] ?? getDefaultViewerGraphCollapsedKeys(removeCategoryGrouping(graph), 2);
        return {
          ...current,
          [graphSignature]: updater(base),
        };
      });
    },
    [graph, graphSignature],
  );
  const updateCollapsedCompoundIds = useCallback(
    (updater: (current: Set<string>) => Set<string>) => {
      setCollapsedCompoundState((current) => {
        const base = current[graphSignature] ?? new Set<string>();
        return {
          ...current,
          [graphSignature]: updater(base),
        };
      });
    },
    [graphSignature],
  );

  useEffect(() => {
    onSelectElementRef.current = onSelectElement;
    graphSignatureRef.current = graphSignature;
    shouldAutoFitRef.current = true;
  }, [graphSignature, onSelectElement]);

  const flattenedGraph = useMemo(() => removeCategoryGrouping(graph), [graph]);

  const selectedNodeKey = useMemo(
    () => getViewerGraphSelectedNodeKey(flattenedGraph, activeSelection?.localId),
    [activeSelection?.localId, flattenedGraph],
  );
  const selectedPathKeys = useMemo(
    () => getViewerGraphNodePathKeys(flattenedGraph, selectedNodeKey),
    [flattenedGraph, selectedNodeKey],
  );
  const expandedCollapsedKeys = useMemo(() => {
    if (selectedPathKeys.size === 0) {
      return collapsedKeys;
    }

    const next = new Set(collapsedKeys);
    for (const pathKey of selectedPathKeys) {
      if (pathKey !== selectedNodeKey) {
        next.delete(pathKey);
      }
    }
    return next;
  }, [collapsedKeys, selectedNodeKey, selectedPathKeys]);

  const graphView = useMemo(
    () =>
      buildViewerGraphView(flattenedGraph, {
        collapsedKeys: expandedCollapsedKeys,
        query: deferredQuery,
        maxVisibleNodes: GRAPH_MAX_VISIBLE_NODES,
      }),
    [deferredQuery, expandedCollapsedKeys, flattenedGraph],
  );
  const compoundLayoutGraph = useMemo(
    () =>
      buildCompoundLayoutGraph({
        nodes: graphView.nodes,
        edges: graphView.edges,
        denseChildThreshold: DENSE_COMPOUND_CHILD_THRESHOLD,
        collapsedGroupIds: new Set<string>(),
      }),
    [graphView.edges, graphView.nodes],
  );
  const selectedAndMatchedCompoundIds = useMemo(() => {
    const next = new Set<string>();
    for (const nodeKey of selectedPathKeys) {
      const compoundId = compoundLayoutGraph.nodeKeyToCompoundId.get(nodeKey);
      if (compoundId) {
        next.add(compoundId);
      }
    }
    for (const nodeKey of graphView.matchedNodeKeys) {
      const compoundId = compoundLayoutGraph.nodeKeyToCompoundId.get(nodeKey);
      if (compoundId) {
        next.add(compoundId);
      }
    }
    return next;
  }, [compoundLayoutGraph.nodeKeyToCompoundId, graphView.matchedNodeKeys, selectedPathKeys]);
  const expandedCollapsedCompoundIds = useMemo(() => {
    if (selectedAndMatchedCompoundIds.size === 0) {
      return collapsedCompoundIds;
    }

    const next = new Set(collapsedCompoundIds);
    for (const compoundId of selectedAndMatchedCompoundIds) {
      next.delete(compoundId);
    }
    return next;
  }, [collapsedCompoundIds, selectedAndMatchedCompoundIds]);
  const renderCompoundLayoutGraph = useMemo(
    () =>
      buildCompoundLayoutGraph({
        nodes: graphView.nodes,
        edges: graphView.edges,
        denseChildThreshold: DENSE_COMPOUND_CHILD_THRESHOLD,
        collapsedGroupIds: expandedCollapsedCompoundIds,
      }),
    [expandedCollapsedCompoundIds, graphView.edges, graphView.nodes],
  );

  const elements = useMemo(
    () =>
      buildCytoscapeElements({
        compoundLayoutGraph: renderCompoundLayoutGraph,
        matchedNodeKeys: graphView.matchedNodeKeys,
        collapsedCompoundIds: expandedCollapsedCompoundIds,
      }),
    [expandedCollapsedCompoundIds, graphView.matchedNodeKeys, renderCompoundLayoutGraph],
  );
  const hasCompoundGroups = renderCompoundLayoutGraph.groups.length > 0;

  const activeNode = useMemo(
    () =>
      activeSelection
        ? graph.nodes.find((node) => node.localId === activeSelection.localId) ?? null
        : null,
    [activeSelection, graph.nodes],
  );
  const expandableNodeCount = useMemo(() => getViewerGraphExpandableNodeKeys(flattenedGraph).size, [flattenedGraph]);
  const expandableCompoundCount = renderCompoundLayoutGraph.groups.length;
  const selectedPathEdgeKeys = useMemo(
    () =>
      new Set(
        renderCompoundLayoutGraph.layoutEdges
          .filter((edge) => selectedPathKeys.has(edge.sourceKey) && selectedPathKeys.has(edge.targetKey))
          .map((edge) => edge.key),
      ),
    [renderCompoundLayoutGraph.layoutEdges, selectedPathKeys],
  );
  const hasGraph = graph.totalNodeCount > 0;
  const searchActive = deferredQuery.trim().length > 0;
  const visibleElementCount = useMemo(
    () => renderCompoundLayoutGraph.visibleNodes.filter((node) => node.localId !== null).length,
    [renderCompoundLayoutGraph.visibleNodes],
  );

  const fitGraph = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) {
      return;
    }

    shouldAutoFitRef.current = true;
    cy.fit(cy.elements(), 56);
    setZoom(cy.zoom());
  }, []);

  const focusNode = useCallback((nodeKey: string | null) => {
    const cy = cyRef.current;
    if (!cy || !nodeKey) {
      return false;
    }

    const node = cy.getElementById(nodeKey);
    if (node.length === 0) {
      return false;
    }

    cy.fit(node, 130);
    node.select();
    setZoom(cy.zoom());
    return true;
  }, []);

  const focusSelection = useCallback(() => {
    if (!activeSelection) {
      return;
    }

    if (focusNode(selectedNodeKey)) {
      return;
    }

    setGraphQuery(`#${activeSelection.localId}`);
  }, [activeSelection, focusNode, selectedNodeKey, setGraphQuery]);

  const toggleCompoundCollapsed = useCallback(
    (compoundId: string | null) => {
      if (!compoundId) {
        return;
      }

      const targetCompound = compoundLayoutGraph.groups.find((group) => group.id === compoundId) ?? null;
      if (!targetCompound) {
        return;
      }

      updateCollapsedCompoundIds((current) => {
        const next = new Set(current);
        if (next.has(compoundId)) {
          next.delete(compoundId);
        } else {
          next.add(compoundId);
        }
        return next;
      });
    },
    [compoundLayoutGraph.groups, updateCollapsedCompoundIds],
  );

  const toggleNodeCollapsed = useCallback(
    (nodeKey: string | null) => {
      if (!nodeKey) {
        return;
      }

      const targetNode = flattenedGraph.nodes.find((node) => node.key === nodeKey) ?? null;
      if (!targetNode || targetNode.childKeys.length === 0) {
        return;
      }

      updateCollapsedKeys((current) => {
        const next = new Set(current);
        if (next.has(nodeKey)) {
          next.delete(nodeKey);
        } else {
          next.add(nodeKey);
        }
        return next;
      });
    },
    [flattenedGraph.nodes, updateCollapsedKeys],
  );

  const expandAllNodes = useCallback(() => {
    updateCollapsedKeys(() => new Set());
    updateCollapsedCompoundIds(() => new Set());
  }, [updateCollapsedCompoundIds, updateCollapsedKeys]);

  const collapseAllNodes = useCallback(() => {
    updateCollapsedKeys(() => getViewerGraphExpandableNodeKeys(flattenedGraph));
    updateCollapsedCompoundIds(() => new Set(compoundLayoutGraph.groups.map((group) => group.id)));
  }, [compoundLayoutGraph.groups, flattenedGraph, updateCollapsedCompoundIds, updateCollapsedKeys]);

  const resetGraph = useCallback(() => {
    shouldAutoFitRef.current = true;
    setGraphQuery("");
    setCollapsedState((current) => ({
      ...current,
      [graphSignature]: getDefaultViewerGraphCollapsedKeys(flattenedGraph, 2),
    }));
    setCollapsedCompoundState((current) => ({
      ...current,
      [graphSignature]: new Set<string>(),
    }));
  }, [flattenedGraph, graphSignature, setGraphQuery]);

  const zoomBy = useCallback((factor: number) => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    const nextZoom = clamp(cy.zoom() * factor, MIN_GRAPH_ZOOM, MAX_GRAPH_ZOOM);
    cy.zoom({
      level: nextZoom,
      renderedPosition: {
        x: cy.width() / 2,
        y: cy.height() / 2,
      },
    });
    setZoom(cy.zoom());
  }, []);

  useEffect(() => {
    if (!containerRef.current || cyRef.current) {
      return;
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: CYTOSCAPE_STYLE,
      minZoom: MIN_GRAPH_ZOOM,
      maxZoom: MAX_GRAPH_ZOOM,
      boxSelectionEnabled: false,
      autoungrabify: true,
      wheelSensitivity: 0.18,
    });

    const handleTap = (event: cytoscape.EventObject) => {
      const nodeKey = event.target.id() as string;
      const nodeKind = event.target.data("kind") as CytoscapeGraphNodeData["kind"];
      const compoundGroupId = (event.target.data("compoundGroupId") as string | undefined) ?? null;

      const selectableElement = event.target.data("selectableElement") as CytoscapeGraphNodeData["selectableElement"];
      const localId = event.target.data("localId") as number | null;
      if (selectableElement === "yes" && typeof localId === "number") {
        onSelectElementRef.current(localId);
      }

      const now = Date.now();
      const lastTap = lastTapRef.current;
      if (lastTap && lastTap.nodeKey === nodeKey && now - lastTap.at <= 320) {
        if (nodeKind === "compound" || nodeKind === "compound-group") {
          toggleCompoundCollapsed(compoundGroupId ?? nodeKey);
        } else {
          toggleNodeCollapsed(nodeKey);
        }
        lastTapRef.current = null;
        return;
      }

      lastTapRef.current = { nodeKey, at: now };
    };
    const handleZoom = () => {
      setZoom(cy.zoom());
    };

    cy.on("tap", "node", handleTap);
    cy.on("zoom", handleZoom);
    cyRef.current = cy;

    return () => {
      if (relayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(relayoutFrameRef.current);
        relayoutFrameRef.current = null;
      }
      cy.removeListener("tap", "node", handleTap);
      cy.removeListener("zoom", handleZoom);
      cy.destroy();
      cyRef.current = null;
    };
  }, [toggleCompoundCollapsed, toggleNodeCollapsed]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });

    if (elements.length === 0) {
      return;
    }

    runGraphLayout(cy, hasCompoundGroups);

    if (relayoutFrameRef.current !== null) {
      window.cancelAnimationFrame(relayoutFrameRef.current);
      relayoutFrameRef.current = null;
    }

    relayoutFrameRef.current = window.requestAnimationFrame(() => {
      relayoutFrameRef.current = null;
      if (cy.destroyed()) {
        return;
      }
      cy.resize();
      if (shouldAutoFitRef.current) {
        cy.fit(cy.elements(), 56);
        shouldAutoFitRef.current = false;
      }
      setZoom(cy.zoom());
    });

    return () => {
      if (relayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(relayoutFrameRef.current);
        relayoutFrameRef.current = null;
      }
    };
  }, [elements, hasCompoundGroups, renderCompoundLayoutGraph.visibleNodes]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    cy.batch(() => {
      cy.nodes().removeClass("path-node selected-node");
      cy.edges().removeClass("path-edge");

      for (const nodeKey of selectedPathKeys) {
        cy.getElementById(nodeKey).addClass("path-node");
      }

      if (selectedNodeKey) {
        cy.getElementById(selectedNodeKey).addClass("selected-node");
      }

      for (const edgeKey of selectedPathEdgeKeys) {
        cy.getElementById(edgeKey).addClass("path-edge");
      }
    });
  }, [selectedNodeKey, selectedPathEdgeKeys, selectedPathKeys]);

  useEffect(() => {
    const cy = cyRef.current;
    const container = containerRef.current;
    if (!cy || !container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      cy.resize();
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <section className="flex h-screen w-screen min-h-0 flex-col bg-[color:var(--panel-bg)] text-[color:var(--foreground)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]/90 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Workflow className="h-4 w-4 text-[color:var(--accent)]" aria-hidden="true" />
            <h2 className="truncate text-sm font-semibold text-[color:var(--foreground)]">
              Element Relationships
            </h2>
            <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
              {renderCompoundLayoutGraph.visibleNodes.length} nodes
            </span>
            <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
              {renderCompoundLayoutGraph.layoutEdges.length} links
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[color:var(--muted-ink)]">
            {metadata ? <span>{metadata.name}</span> : <span>No IFC loaded</span>}
            {metadata ? <span>{formatBytes(metadata.size)}</span> : null}
            <span>{renderCompoundLayoutGraph.visibleNodes.length} rendered</span>
            <span>{visibleElementCount} selectable</span>
            {searchActive ? <span>{graphView.matchCount} matches</span> : null}
            {expandableCompoundCount > 0 ? <span>{expandableCompoundCount} compound groups</span> : null}
            {graphView.omittedNodeCount > 0 ? (
              <span>{graphView.omittedNodeCount} over render cap</span>
            ) : null}
            <span>{Math.round(zoom * 100)}% zoom</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="relative min-w-[18rem] max-w-[28rem] flex-1">
            <span className="sr-only">Search graph</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-ink)]" />
            <input
              value={query}
              onChange={(event) => setGraphQuery(event.target.value)}
              placeholder="Search element names, local IDs, or IFC classes"
              disabled={!hasGraph}
              className="h-10 w-full rounded-lg border border-[color:var(--viewer-border)] bg-white/80 py-2 pl-10 pr-10 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-ink)] focus:border-[color:var(--accent)] focus:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setGraphQuery("")}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[color:var(--viewer-border)] bg-white/90 text-[color:var(--muted-ink)] transition hover:bg-white hover:text-[color:var(--foreground)]"
                aria-label="Clear graph search"
                title="Clear graph search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <GraphToolButton label="Focus selected element" disabled={!activeNode} onClick={focusSelection}>
            <Focus className="h-4 w-4" />
          </GraphToolButton>
          <button
            type="button"
            onClick={expandAllNodes}
            disabled={!hasGraph || (expandableNodeCount === 0 && expandableCompoundCount === 0)}
            className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAllNodes}
            disabled={!hasGraph || (expandableNodeCount === 0 && expandableCompoundCount === 0)}
            className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Collapse all
          </button>
          <GraphToolButton label="Fit graph" disabled={!hasGraph || renderCompoundLayoutGraph.visibleNodes.length === 0} onClick={fitGraph}>
            <LocateFixed className="h-4 w-4" />
          </GraphToolButton>
          <GraphToolButton label="Zoom out" disabled={!hasGraph || zoom <= MIN_GRAPH_ZOOM} onClick={() => zoomBy(1 / GRAPH_ZOOM_STEP)}>
            <ZoomOut className="h-4 w-4" />
          </GraphToolButton>
          <GraphToolButton label="Zoom in" disabled={!hasGraph || zoom >= MAX_GRAPH_ZOOM} onClick={() => zoomBy(GRAPH_ZOOM_STEP)}>
            <ZoomIn className="h-4 w-4" />
          </GraphToolButton>
          <button
            type="button"
            onClick={resetGraph}
            disabled={!hasGraph}
            className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Reset
          </button>
          <GraphToolButton label="Close graph" onClick={onClose}>
            <X className="h-4 w-4" />
          </GraphToolButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(246,249,255,0.96))]">
          {!hasGraph ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center px-6 py-8">
              <div className="max-w-xl rounded-lg border border-dashed border-[color:var(--viewer-border)] bg-white/72 px-6 py-5 text-center">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                  No Graph Data
                </div>
                <div className="mt-2 text-sm text-[color:var(--foreground)]">
                  Load an IFC model to index element relationships.
                </div>
              </div>
            </div>
          ) : graphView.nodes.length === 0 ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center px-6 py-8">
              <div className="max-w-xl rounded-lg border border-dashed border-[color:var(--viewer-border)] bg-white/72 px-6 py-5 text-center">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                  No Matching Nodes
                </div>
                <div className="mt-2 text-sm text-[color:var(--foreground)]">
                  Clear the search to return to the relationship graph.
                </div>
              </div>
            </div>
          ) : null}

          {graphView.omittedNodeCount > 0 ? (
            <div className="absolute bottom-3 left-3 z-10 max-w-md rounded-lg border border-[#d8af80] bg-[#fff7ed] px-3 py-2 text-xs leading-5 text-[#915217] shadow-sm">
              Rendering is capped at {GRAPH_MAX_VISIBLE_NODES} nodes. Search by local ID, name, or IFC class to narrow the graph.
            </div>
          ) : null}

          {activeNode ? (
            <div className="absolute left-3 top-3 z-10 max-w-md rounded-lg border border-[color:var(--viewer-border)] bg-white/85 px-3 py-2 text-xs shadow-sm backdrop-blur">
              <div className="font-semibold text-[color:var(--foreground)]">
                Selected {activeNode.localId}
              </div>
              <div className="mt-1 text-[color:var(--muted-ink)]">
                {activeNode.category ?? nodeKindLabel(activeNode.kind)}
                {activeNode.label ? ` - ${activeNode.label}` : ""}
              </div>
            </div>
          ) : null}

          <div ref={containerRef} className="h-full w-full" aria-label="IFC element relationship graph" />
        </div>

        <aside className="min-h-0 w-[24rem] shrink-0 border-l border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]">
          <PropertiesPanel embedded details={selectionDetails} />
        </aside>
      </div>
    </section>
  );
}
