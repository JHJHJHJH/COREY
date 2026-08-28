"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Focus,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Network,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type GraphData,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import {
  placeLabels,
  rotatedLabelBounds,
  type LabelCandidate,
} from "@/features/viewer/lib/label-placement";
import {
  CHARGE_STRENGTH,
  computeGraphTree,
  createGraphRadialForce,
  createGraphSeparationForce,
  createGraphStabilityForce,
  LINK_DISTANCE,
  seedNodePositions,
} from "@/features/viewer/lib/graph-layout";
import {
  collapseViewerGraphNode,
  mergeViewerGraphNeighborhood,
  VIEWER_GRAPH_MAX_NODES,
  VIEWER_GRAPH_PAGE_SIZE,
} from "@/features/viewer/lib/ifc-graph";
import type {
  ViewerGraphEdge,
  ViewerGraphNeighborhood,
  ViewerGraphNeighborhoodRequest,
  ViewerGraphNode,
  ViewerGraphRelationGroup,
} from "@/features/viewer/types";

type IfcGraphPanelProps = {
  active: boolean;
  theme: "light" | "dark";
  selectedLocalId: number | null;
  onRequestNeighborhood: (
    request: ViewerGraphNeighborhoodRequest,
  ) => Promise<ViewerGraphNeighborhood>;
  onSelectNode: (localId: number) => void;
  /** Isolates the given elements in the 3D viewport. Absent when the host cannot isolate. */
  onIsolateNodes?: (localIds: number[]) => void;
  onClose: () => void;
};

type PaginationState = {
  nextOffset: number | null;
  totalRelationCount: number;
};

type RelationFilterState = Record<ViewerGraphRelationGroup, boolean>;

type ContextMenuState = {
  localId: number;
  x: number;
  y: number;
};

const initialRelationFilters: RelationFilterState = {
  spatial: true,
  type: true,
  property: true,
  association: true,
  connection: true,
  other: true,
};

const relationFilterLabels: Record<ViewerGraphRelationGroup, string> = {
  spatial: "Spatial",
  type: "Type",
  property: "Properties",
  association: "Associations",
  connection: "Connections",
  other: "Other",
};

const nodeLegendEntries: { kind: ViewerGraphNode["kind"]; label: string }[] = [
  { kind: "spatial", label: "Spatial" },
  { kind: "element", label: "Element" },
  { kind: "type", label: "Type" },
  { kind: "property", label: "Property" },
  { kind: "material", label: "Material" },
  { kind: "other", label: "Other" },
];

/**
 * SVG twins of `traceNodeShape`, so the legend shows the same silhouettes the canvas paints.
 * Drawn in a 12x12 box around (6,6) at radius 5.
 */
const legendShapes: Record<ViewerGraphNode["kind"], React.ReactNode> = {
  spatial: <rect x="1.8" y="1.8" width="8.4" height="8.4" />,
  element: <circle cx="6" cy="6" r="4.6" />,
  type: <polygon points="6,1.2 10.8,6 6,10.8 1.2,6" />,
  property: <polygon points="6,1.4 10.6,9.6 1.4,9.6" />,
  material: <polygon points="6,1 10.33,3.5 10.33,8.5 6,11 1.67,8.5 1.67,3.5" />,
  other: <circle cx="6" cy="6" r="4.6" />,
};

function NodeGlyph({
  kind,
  color,
  hollow = false,
}: {
  kind: ViewerGraphNode["kind"];
  color: string;
  hollow?: boolean;
}) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0 overflow-visible">
      <g fill={hollow ? "none" : color} stroke={color} strokeWidth={hollow ? 1.5 : 0}>
        {legendShapes[kind]}
      </g>
    </svg>
  );
}

const GRAPH_POINTER_ZOOM_RESET = "calc(1 / 0.75)";

/**
 * Labels are gated by collision rather than a zoom threshold — see `lib/label-placement.ts`. These
 * only keep the pass cheap at the node ceiling by bounding how many are ever attempted or drawn.
 */
const MAX_NODE_LABELS = 120;
const MAX_EDGE_LABELS = 40;
/** Screen-pixel gap required between two label boxes. */
const LABEL_PADDING = 2;
const MAX_TYPE_CHARS = 22;
const DIMMED_ALPHA = 0.15;


const graphColors = {
  light: {
    background: "#f7f9fc",
    link: "#8090a4",
    linkDim: "#d7dee8",
    highlight: "#1d4ed8",
    spatial: "#2563eb",
    element: "#334155",
    type: "#7c3aed",
    property: "#b45309",
    material: "#047857",
    other: "#64748b",
    selected: "#e5484d",
    match: "#d97706",
    labelInk: "#0f172a",
    labelBackground: "rgba(247, 249, 252, 0.82)",
  },
  dark: {
    background: "#0b0f14",
    link: "#63758b",
    linkDim: "#2a3341",
    highlight: "#93c5fd",
    spatial: "#60a5fa",
    element: "#cbd5e1",
    type: "#c4b5fd",
    property: "#fbbf24",
    material: "#34d399",
    other: "#94a3b8",
    selected: "#fb7185",
    match: "#fbbf24",
    labelInk: "#e2e8f0",
    labelBackground: "rgba(11, 15, 20, 0.82)",
  },
} as const;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tooltipForNode(node: ViewerGraphNode) {
  // The canvas shows class and local id, so the tooltip leads with the human-readable name.
  const globalId = node.globalId ? `<br><small>${escapeHtml(node.globalId)}</small>` : "";
  return `<strong>${escapeHtml(node.label)}</strong><br><small>${escapeHtml(
    graphNodeLabel(node),
  )}</small>${globalId}`;
}

function tooltipForEdge(edge: ViewerGraphEdge) {
  const raw = edge.rawRelations.length > 0 ? edge.rawRelations.join(" / ") : edge.relation;
  return `<strong>${escapeHtml(edge.relation)}</strong><br><small>${escapeHtml(raw)}</small>`;
}

/**
 * Canvas identity for a node: IFC class plus local id, matching how the properties panel names an
 * element. Occurrence names in an export are frequently long, duplicated across hundreds of
 * elements, or absent, none of which tells you which node you are looking at.
 */
function graphNodeLabel(node: ViewerGraphNode) {
  const ifcType = node.ifcType ?? "Unknown";
  const shortType =
    ifcType.length > MAX_TYPE_CHARS ? `${ifcType.slice(0, MAX_TYPE_CHARS - 1)}…` : ifcType;
  return `${shortType} #${node.localId}`;
}

/**
 * Shape carries the node role alongside colour, so the roles stay apart in greyscale and for
 * anyone who cannot separate the palette. `element` and `other` keep the default circle.
 */
function traceNodeShape(
  ctx: CanvasRenderingContext2D,
  kind: ViewerGraphNode["kind"],
  x: number,
  y: number,
  radius: number,
) {
  ctx.beginPath();
  if (kind === "spatial") {
    const side = radius * 1.7;
    ctx.rect(x - side / 2, y - side / 2, side, side);
    return;
  }
  if (kind === "type") {
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x + radius, y);
    ctx.lineTo(x, y + radius);
    ctx.lineTo(x - radius, y);
    ctx.closePath();
    return;
  }
  if (kind === "property") {
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x + radius * 0.92, y + radius * 0.7);
    ctx.lineTo(x - radius * 0.92, y + radius * 0.7);
    ctx.closePath();
    return;
  }
  if (kind === "material") {
    for (let corner = 0; corner < 6; corner += 1) {
      const angle = (Math.PI / 3) * corner - Math.PI / 2;
      const cornerX = x + radius * Math.cos(angle);
      const cornerY = y + radius * Math.sin(angle);
      if (corner === 0) ctx.moveTo(cornerX, cornerY);
      else ctx.lineTo(cornerX, cornerY);
    }
    ctx.closePath();
    return;
  }
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

/** Degree-scaled, so hubs read as hubs. Shared by the painter and the pointer-area painter. */
function nodeRadius(node: ViewerGraphNode, degree: number, isSelected: boolean) {
  if (isSelected) return 7;
  return (node.kind === "spatial" ? 4.5 : 3) + Math.min(4, Math.sqrt(degree));
}

/** d3 rewrites `source`/`target` from ids to node objects once the simulation has run. */
function linkEndpoint(value: unknown): NodeObject<ViewerGraphNode> | null {
  if (!value || typeof value !== "object") return null;
  const node = value as NodeObject<ViewerGraphNode>;
  return Number.isFinite(node.x) && Number.isFinite(node.y) ? node : null;
}

export function IfcGraphPanel({
  active,
  theme,
  selectedLocalId,
  onRequestNeighborhood,
  onSelectNode,
  onIsolateNodes,
  onClose,
}: IfcGraphPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods<ViewerGraphNode, ViewerGraphEdge> | undefined>(
    undefined,
  );
  const nodesRef = useRef(new Map<number, ViewerGraphNode>());
  const edgesRef = useRef(new Map<string, ViewerGraphEdge>());
  const paginationRef = useRef(new Map<number, PaginationState>());
  const loadingKeysRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const pendingFocusLocalIdRef = useRef<number | null>(null);
  const fitAfterLayoutRef = useRef(false);
  const initializedRef = useRef(false);
  const rootAnchorRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // The collision force reads radii on every tick; a ref keeps it current without re-registering.
  const degreesRef = useRef(new Map<number, number>());
  const selectedForRadiusRef = useRef<number | null>(null);
  const adjacencyRef = useRef(new Map<number, number[]>());
  // Depth and BFS parent from the root anchor: what makes the layout grow outward instead of
  // spreading in every direction. Refs, so the forces read the current tree without re-registering.
  const depthRef = useRef(new Map<number, number>());
  const parentRef = useRef(new Map<number, number>());
  const collisionForceRef = useRef(
    createGraphSeparationForce<NodeObject<ViewerGraphNode>>({
      radiusOf: (node) =>
        nodeRadius(
          node,
          degreesRef.current.get(node.localId) ?? 0,
          node.localId === selectedForRadiusRef.current,
        ),
      adjacency: () => adjacencyRef.current,
      parent: () => parentRef.current,
    }),
  );
  const radialForceRef = useRef(
    createGraphRadialForce<NodeObject<ViewerGraphNode>>({
      depth: () => depthRef.current,
      // The rings are centred on the root anchor wherever it has drifted to, so they do not fight
      // d3's centering force, which translates the whole graph back to the origin every tick.
      center: () => {
        const root =
          rootAnchorRef.current === null
            ? undefined
            : (nodesRef.current.get(rootAnchorRef.current) as
                | NodeObject<ViewerGraphNode>
                | undefined);
        return root && Number.isFinite(root.x) && Number.isFinite(root.y)
          ? { x: root.x as number, y: root.y as number }
          : { x: 0, y: 0 };
      },
    }),
  );
  const stabilityForceRef = useRef(createGraphStabilityForce<NodeObject<ViewerGraphNode>>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [revision, setRevision] = useState(0);
  const [loadingCount, setLoadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedGraphLocalId, setSelectedGraphLocalId] = useState<number | null>(
    selectedLocalId,
  );
  const [hoveredLocalId, setHoveredLocalId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [query, setQuery] = useState("");
  const [matchCursor, setMatchCursor] = useState(-1);
  const [relationFilters, setRelationFilters] =
    useState<RelationFilterState>(initialRelationFilters);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const updateSize = () => {
      if (!active) return;
      setSize({
        width: Math.max(0, Math.floor(container.clientWidth)),
        height: Math.max(0, Math.floor(container.clientHeight)),
      });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    updateSize();
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    if (!graphRef.current) return;
    if (active) {
      graphRef.current.resumeAnimation();
    } else {
      graphRef.current.pauseAnimation();
    }
  }, [active]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength?.(CHARGE_STRENGTH);
    graph.d3Force("link")?.distance?.(LINK_DISTANCE);
    graph.d3Force("collide", collisionForceRef.current);
    graph.d3Force("radial", radialForceRef.current);
    // Registered last so it damps the velocity every other force has already contributed.
    graph.d3Force("stability", stabilityForceRef.current);
  }, [size.height, size.width]);

  const focusNode = useCallback((localId: number) => {
    pendingFocusLocalIdRef.current = localId;
    const node = nodesRef.current.get(localId) as NodeObject<ViewerGraphNode> | undefined;
    if (
      node &&
      Number.isFinite(node.x) &&
      Number.isFinite(node.y) &&
      graphRef.current
    ) {
      graphRef.current.centerAt(node.x, node.y, 250);
      pendingFocusLocalIdRef.current = null;
    }
  }, []);

  const loadNeighborhood = useCallback(
    async (anchorLocalId: number | null, options?: { reset?: boolean; fit?: boolean }) => {
      const loadingKey = anchorLocalId === null ? "root" : String(anchorLocalId);
      if (loadingKeysRef.current.has(loadingKey)) return;

      if (options?.reset) {
        nodesRef.current.clear();
        edgesRef.current.clear();
        paginationRef.current.clear();
        initializedRef.current = false;
        rootAnchorRef.current = null;
        setRevision((current) => current + 1);
      }

      const existingPagination =
        anchorLocalId === null ? undefined : paginationRef.current.get(anchorLocalId);
      if (!options?.reset && existingPagination?.nextOffset === null) {
        focusNode(anchorLocalId as number);
        return;
      }
      if (nodesRef.current.size >= VIEWER_GRAPH_MAX_NODES && !options?.reset) return;

      loadingKeysRef.current.add(loadingKey);
      setLoadingCount((current) => current + 1);
      setError(null);

      try {
        const neighborhood = await onRequestNeighborhood({
          anchorLocalId,
          offset: options?.reset ? 0 : (existingPagination?.nextOffset ?? 0),
          limit: VIEWER_GRAPH_PAGE_SIZE,
        });
        if (!mountedRef.current) return;

        // Everything already on screen; the merge tells us the rest are new.
        const settledLocalIds = new Set(nodesRef.current.keys());
        const { addedLocalIds } = mergeViewerGraphNeighborhood({
          neighborhood,
          nodes: nodesRef.current,
          edges: edgesRef.current,
        });

        // Place the arrivals next to the node they were expanded from, before the re-render hands
        // them to d3 — d3 only seeds a node that has no position, so ours are left alone. Then hold
        // the settled ones back while the new ones find their room, since `force-graph` re-heats to
        // alpha 1 on every data change and gives no way to ask for less.
        const hub = nodesRef.current.get(neighborhood.anchorLocalId) as
          | NodeObject<ViewerGraphNode>
          | undefined;
        if (hub && Number.isFinite(hub.x) && addedLocalIds.length > 0) {
          const parentLocalId = parentRef.current.get(hub.localId);
          seedNodePositions({
            hub,
            parent:
              parentLocalId === undefined
                ? null
                : ((nodesRef.current.get(parentLocalId) ??
                    null) as NodeObject<ViewerGraphNode> | null),
            nodes: addedLocalIds
              .map((localId) => nodesRef.current.get(localId) as NodeObject<ViewerGraphNode>)
              .filter((node) => node !== undefined),
          });
          stabilityForceRef.current.hold(settledLocalIds);
        }

        paginationRef.current.set(neighborhood.anchorLocalId, {
          nextOffset: neighborhood.nextOffset,
          totalRelationCount: neighborhood.totalRelationCount,
        });
        initializedRef.current = true;
        rootAnchorRef.current ??= neighborhood.anchorLocalId;
        setSelectedGraphLocalId(neighborhood.anchorLocalId);
        pendingFocusLocalIdRef.current = neighborhood.anchorLocalId;
        fitAfterLayoutRef.current = options?.fit ?? nodesRef.current.size <= 1;
        setRevision((current) => current + 1);
      } catch (loadError) {
        if (!mountedRef.current) return;
        setError(loadError instanceof Error ? loadError.message : "The graph could not be loaded.");
      } finally {
        loadingKeysRef.current.delete(loadingKey);
        if (mountedRef.current) {
          setLoadingCount((current) => Math.max(0, current - 1));
        }
      }
    },
    [focusNode, onRequestNeighborhood],
  );

  const collapseNode = useCallback(
    (localId: number) => {
      const anchorLocalId = rootAnchorRef.current;
      if (anchorLocalId === null) return;

      const { removedLocalIds } = collapseViewerGraphNode({
        localId,
        anchorLocalId,
        nodes: nodesRef.current,
        edges: edgesRef.current,
        keepLocalIds: [selectedLocalId, selectedGraphLocalId].filter(
          (candidate): candidate is number => candidate !== null,
        ),
      });
      // Forget the paging cursors so a later expand refetches rather than resuming mid-list.
      paginationRef.current.delete(localId);
      for (const removed of removedLocalIds) paginationRef.current.delete(removed);
      if (removedLocalIds.length > 0) setRevision((current) => current + 1);
    },
    [selectedGraphLocalId, selectedLocalId],
  );

  const removeNode = useCallback((localId: number) => {
    if (localId === rootAnchorRef.current) return;
    nodesRef.current.delete(localId);
    for (const [edgeId, edge] of edgesRef.current) {
      if (edge.sourceLocalId === localId || edge.targetLocalId === localId) {
        edgesRef.current.delete(edgeId);
      }
    }
    paginationRef.current.delete(localId);
    setSelectedGraphLocalId((current) => (current === localId ? rootAnchorRef.current : current));
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!active) return;

    if (!initializedRef.current) {
      void loadNeighborhood(selectedLocalId, { fit: true });
      return;
    }

    if (selectedLocalId !== null) {
      setSelectedGraphLocalId(selectedLocalId);
      if (!paginationRef.current.has(selectedLocalId)) {
        void loadNeighborhood(selectedLocalId);
      } else {
        focusNode(selectedLocalId);
      }
    }
  }, [active, focusNode, loadNeighborhood, selectedLocalId]);

  const { data, degrees, adjacency, depth, parent } = useMemo(() => {
    // The graph maps are mutated in place; revision is their explicit memo invalidation token.
    void revision;
    const activeGroups = new Set(
      (Object.entries(relationFilters) as [ViewerGraphRelationGroup, boolean][])
        .filter(([, enabled]) => enabled)
        .map(([group]) => group),
    );
    const links = [...edgesRef.current.values()]
      .filter((edge) => activeGroups.has(edge.relationGroup))
      .map((edge) => ({ ...edge }));

    const degreeByLocalId = new Map<number, number>();
    // Neighbours per node, so the separation force can fan a hub's children out by angle.
    const adjacency = new Map<number, number[]>();
    const connect = (from: number, to: number) => {
      degreeByLocalId.set(from, (degreeByLocalId.get(from) ?? 0) + 1);
      const neighbours = adjacency.get(from);
      if (neighbours) neighbours.push(to);
      else adjacency.set(from, [to]);
    };
    for (const link of links) {
      connect(link.sourceLocalId, link.targetLocalId);
      connect(link.targetLocalId, link.sourceLocalId);
    }

    // Filtering out a relation group must take its now-unreachable nodes with it, or switching
    // off a group leaves a drift of disconnected leftovers behind.
    const nodes = [...nodesRef.current.values()].filter(
      (node) => degreeByLocalId.has(node.localId) || node.localId === rootAnchorRef.current,
    );

    const { depth, parent } = computeGraphTree(rootAnchorRef.current, adjacency);

    return {
      data: { nodes, links } satisfies GraphData<ViewerGraphNode, ViewerGraphEdge>,
      degrees: degreeByLocalId,
      adjacency,
      depth,
      parent,
    };
  }, [relationFilters, revision]);

  useEffect(() => {
    degreesRef.current = degrees;
    adjacencyRef.current = adjacency;
    depthRef.current = depth;
    parentRef.current = parent;
    selectedForRadiusRef.current = selectedGraphLocalId;
  }, [adjacency, degrees, depth, parent, selectedGraphLocalId]);

  const matchLocalIds = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return [];
    return data.nodes
      .filter(
        (node) =>
          node.label.toLowerCase().includes(needle) ||
          graphNodeLabel(node).toLowerCase().includes(needle) ||
          (node.globalId?.toLowerCase().includes(needle) ?? false),
      )
      .map((node) => node.localId);
  }, [data.nodes, deferredQuery]);

  const matchLocalIdSet = useMemo(() => new Set(matchLocalIds), [matchLocalIds]);

  useEffect(() => {
    setMatchCursor(-1);
  }, [deferredQuery]);

  const goToNextMatch = useCallback(
    (step: number) => {
      if (matchLocalIds.length === 0) return;
      // `-1` means nothing is focused yet: forwards starts at the first match, backwards at the last.
      const from = matchCursor < 0 ? (step > 0 ? -1 : 0) : matchCursor;
      const next = (from + step + matchLocalIds.length) % matchLocalIds.length;
      const localId = matchLocalIds[next];
      setMatchCursor(next);
      if (localId === undefined) return;
      setSelectedGraphLocalId(localId);
      focusNode(localId);
    },
    [focusNode, matchCursor, matchLocalIds],
  );

  /** Nodes and links incident to whatever the pointer is on. `null` means "dim nothing". */
  const hoverHighlight = useMemo(() => {
    if (hoveredLocalId === null) return null;
    const nodeIds = new Set<number>([hoveredLocalId]);
    const linkIds = new Set<string>();
    for (const link of data.links) {
      if (link.sourceLocalId !== hoveredLocalId && link.targetLocalId !== hoveredLocalId) continue;
      linkIds.add(link.id);
      nodeIds.add(link.sourceLocalId);
      nodeIds.add(link.targetLocalId);
    }
    return { nodeIds, linkIds };
  }, [data.links, hoveredLocalId]);

  const selectedNode =
    selectedGraphLocalId === null ? null : (nodesRef.current.get(selectedGraphLocalId) ?? null);
  const selectedPagination =
    selectedGraphLocalId === null ? null : (paginationRef.current.get(selectedGraphLocalId) ?? null);
  const selectedNeighborhoodComplete = selectedPagination?.nextOffset === null;
  const atNodeLimit = nodesRef.current.size >= VIEWER_GRAPH_MAX_NODES;
  const colors = graphColors[theme];
  const contextNode =
    contextMenu === null ? null : (nodesRef.current.get(contextMenu.localId) ?? null);
  const contextPagination =
    contextMenu === null ? null : (paginationRef.current.get(contextMenu.localId) ?? null);

  const isNodeDimmed = useCallback(
    (localId: number) => {
      if (hoverHighlight) return !hoverHighlight.nodeIds.has(localId);
      if (matchLocalIdSet.size > 0) return !matchLocalIdSet.has(localId);
      return false;
    },
    [hoverHighlight, matchLocalIdSet],
  );

  const paintNode = useCallback(
    (node: NodeObject<ViewerGraphNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const { x, y } = node;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const isSelected = node.localId === selectedGraphLocalId;
      const isHovered = node.localId === hoveredLocalId;
      const isMatch = matchLocalIdSet.has(node.localId);
      const radius = nodeRadius(node, degrees.get(node.localId) ?? 0, isSelected);
      const tint = isSelected ? colors.selected : isMatch ? colors.match : colors[node.kind];

      ctx.save();
      ctx.globalAlpha = isNodeDimmed(node.localId) ? DIMMED_ALPHA : 1;

      traceNodeShape(ctx, node.kind, x as number, y as number, radius);
      if (node.hasGeometry) {
        ctx.fillStyle = tint;
        ctx.fill();
      } else {
        // Hollow reads as "no 3D geometry" — a property set, type or material, not an element.
        ctx.fillStyle = colors.background;
        ctx.fill();
        ctx.lineWidth = 1.4 / globalScale;
        ctx.strokeStyle = tint;
        ctx.stroke();
      }

      if (isSelected || isMatch || isHovered) {
        traceNodeShape(ctx, node.kind, x as number, y as number, radius + 2.5 / globalScale);
        ctx.lineWidth = 1.6 / globalScale;
        ctx.strokeStyle = isSelected ? colors.selected : isMatch ? colors.match : colors.highlight;
        ctx.stroke();
      }

      ctx.restore();
    },
    [colors, degrees, hoveredLocalId, isNodeDimmed, matchLocalIdSet, selectedGraphLocalId],
  );

  const paintNodePointerArea = useCallback(
    (node: NodeObject<ViewerGraphNode>, color: string, ctx: CanvasRenderingContext2D) => {
      const { x, y } = node;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const radius =
        nodeRadius(node, degrees.get(node.localId) ?? 0, node.localId === selectedGraphLocalId) + 2;
      ctx.fillStyle = color;
      traceNodeShape(ctx, node.kind, x as number, y as number, radius);
      ctx.fill();
    },
    [degrees, selectedGraphLocalId],
  );

  /**
   * Draws every label in one pass, after the graph itself, so that ordering and collision can be
   * decided globally — `nodeCanvasObject` sees one node at a time and cannot know what else has
   * already claimed the space. `onRenderFramePost` still carries the pan/zoom transform, so this
   * draws in graph coordinates like the rest; boxes are collided in screen pixels, which is the
   * space a reader actually perceives overlap in.
   */
  /**
   * Draws every label — node and edge alike — in one pass after the graph itself, so that ordering
   * and collision are decided globally. `nodeCanvasObject` sees one node at a time and cannot know
   * what else has claimed the space, and placing nodes and edges separately just lets the two sets
   * overlap each other. `onRenderFramePost` still carries the pan/zoom transform, so this draws in
   * graph coordinates like the rest; boxes are collided in screen pixels, the space a reader
   * actually perceives overlap in.
   */
  const paintLabels = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const nodeFontSize = 11 / globalScale;
      const edgeFontSize = 9 / globalScale;
      const pad = LABEL_PADDING / globalScale;
      const nodeFont = `${nodeFontSize}px ui-sans-serif, system-ui, sans-serif`;
      const edgeFont = `${edgeFontSize}px ui-sans-serif, system-ui, sans-serif`;

      type Placement =
        | {
            kind: "node";
            node: NodeObject<ViewerGraphNode>;
            text: string;
            top: number;
            width: number;
          }
        | {
            kind: "edge";
            link: LinkObject<ViewerGraphNode, ViewerGraphEdge>;
            midX: number;
            midY: number;
            angle: number;
            width: number;
          };

      const candidates: LabelCandidate<Placement>[] = [];

      ctx.save();
      ctx.font = nodeFont;
      for (const node of data.nodes as NodeObject<ViewerGraphNode>[]) {
        const { x, y } = node;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const isSelected = node.localId === selectedGraphLocalId;
        const isHovered = node.localId === hoveredLocalId;
        const isMatch = matchLocalIdSet.has(node.localId);
        const degree = degrees.get(node.localId) ?? 0;
        // What the reader is working with outranks what is merely well connected.
        const priority = isSelected
          ? 1_000_000
          : isHovered
            ? 900_000
            : isMatch
              ? 800_000
              : 1_000 + degree;

        const text = graphNodeLabel(node);
        const width = ctx.measureText(text).width;
        const top = (y as number) + nodeRadius(node, degree, isSelected) + nodeFontSize * 0.3;
        candidates.push({
          subject: { kind: "node", node, text, top, width },
          priority,
          box: {
            x: ((x as number) - width / 2) * globalScale,
            y: top * globalScale,
            width: width * globalScale,
            height: (nodeFontSize + pad * 2) * globalScale,
          },
        });
      }

      ctx.font = edgeFont;
      for (const link of data.links) {
        const startNode = linkEndpoint(link.source);
        const endNode = linkEndpoint(link.target);
        if (!startNode || !endNode) continue;

        const startX = startNode.x as number;
        const startY = startNode.y as number;
        const endX = endNode.x as number;
        const endY = endNode.y as number;
        let angle = Math.atan2(endY - startY, endX - startX);
        // Keep the text upright rather than letting it read upside-down on leftward links.
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;

        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const width = ctx.measureText(link.relation).width;
        const focused =
          hoverHighlight?.linkIds.has(link.id) ||
          link.sourceLocalId === selectedGraphLocalId ||
          link.targetLocalId === selectedGraphLocalId;

        // Exact axis-aligned bounds of the *rotated* text box. Using the unrotated width would
        // give a near-vertical label a wide, short box — the opposite of the space it occupies —
        // and let stacked ones through.
        const span = rotatedLabelBounds(width, edgeFontSize + pad * 2, angle);

        candidates.push({
          subject: { kind: "edge", link, midX, midY, angle, width },
          // Relation names matter less than the things they connect, so they yield to node labels.
          priority: focused ? 700_000 : 0,
          box: {
            x: (midX - span.width / 2) * globalScale,
            y: (midY - span.height / 2) * globalScale,
            width: span.width * globalScale,
            height: span.height * globalScale,
          },
        });
      }

      for (const { subject } of placeLabels(candidates, {
        limit: MAX_NODE_LABELS + MAX_EDGE_LABELS,
        padding: LABEL_PADDING,
      })) {
        if (subject.kind === "node") {
          const { node, text, top, width } = subject;
          ctx.font = nodeFont;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.globalAlpha = isNodeDimmed(node.localId) ? DIMMED_ALPHA : 1;
          ctx.fillStyle = colors.labelBackground;
          ctx.fillRect(
            (node.x as number) - width / 2 - pad,
            top,
            width + pad * 2,
            nodeFontSize + pad * 2,
          );
          ctx.fillStyle = colors.labelInk;
          ctx.fillText(text, node.x as number, top + pad);
          continue;
        }

        const { link, midX, midY, angle, width } = subject;
        ctx.save();
        ctx.font = edgeFont;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha =
          hoverHighlight && !hoverHighlight.linkIds.has(link.id) ? DIMMED_ALPHA : 1;
        ctx.translate(midX, midY);
        ctx.rotate(angle);
        ctx.fillStyle = colors.labelBackground;
        ctx.fillRect(
          -width / 2 - pad,
          -edgeFontSize / 2 - pad,
          width + pad * 2,
          edgeFontSize + pad * 2,
        );
        ctx.fillStyle = colors.labelInk;
        ctx.fillText(link.relation, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    },
    [
      colors,
      data.links,
      data.nodes,
      degrees,
      hoverHighlight,
      hoveredLocalId,
      isNodeDimmed,
      matchLocalIdSet,
      selectedGraphLocalId,
    ],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeContextMenu, contextMenu]);

  const contextMenuActions = contextNode
    ? [
        {
          key: "expand",
          label: contextPagination?.nextOffset ? "Load more" : "Expand",
          icon: Network,
          disabled: contextPagination?.nextOffset === null || atNodeLimit || loadingCount > 0,
          run: () => void loadNeighborhood(contextNode.localId),
        },
        {
          key: "collapse",
          label: "Collapse",
          icon: Minimize2,
          disabled: contextNode.localId === rootAnchorRef.current,
          run: () => collapseNode(contextNode.localId),
        },
        {
          key: "focus",
          label: "Focus",
          icon: Focus,
          disabled: false,
          run: () => focusNode(contextNode.localId),
        },
        {
          key: "select",
          label: "Select in 3D",
          icon: Eye,
          disabled: false,
          run: () => {
            setSelectedGraphLocalId(contextNode.localId);
            onSelectNode(contextNode.localId);
          },
        },
        {
          key: "isolate",
          label: "Isolate in 3D",
          icon: Eye,
          disabled: !onIsolateNodes || !contextNode.hasGeometry,
          run: () => onIsolateNodes?.([contextNode.localId]),
        },
        {
          key: "copy",
          label: "Copy GlobalId",
          icon: Copy,
          disabled: !contextNode.globalId,
          run: () => {
            if (contextNode.globalId) void navigator.clipboard?.writeText(contextNode.globalId);
          },
        },
        {
          key: "remove",
          label: "Remove",
          icon: Trash2,
          disabled: contextNode.localId === rootAnchorRef.current,
          run: () => removeNode(contextNode.localId),
        },
      ]
    : [];

  return (
    <section className="flex h-full min-h-0 flex-col bg-[color:var(--panel-bg)] text-[color:var(--foreground)]">
      <header className="shrink-0 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">IFC relationship graph</div>
            <div className="corey-mono-label mt-0.5 text-[10px] uppercase tracking-[0.07em] text-[color:var(--muted-ink)]">
              {data.nodes.length} nodes · {data.links.length} links
            </div>
          </div>
          <button
            type="button"
            onClick={() => graphRef.current?.zoomToFit(250, 24)}
            disabled={data.nodes.length === 0}
            aria-label="Fit graph"
            title="Fit graph"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--r-control)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)] disabled:opacity-40"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close graph"
            title="Close graph"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--r-control)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1.5 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--muted-ink)]" />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                searchInputRef.current?.blur();
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              goToNextMatch(event.shiftKey ? -1 : 1);
            }}
            placeholder="Find by name, class, local id or GlobalId"
            aria-label="Search graph nodes"
            className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[color:var(--muted-ink)]"
          />
          {deferredQuery.trim() ? (
            <>
              <span className="corey-mono-label shrink-0 text-[10px] text-[color:var(--muted-ink)]">
                {matchCursor < 0
                  ? matchLocalIds.length
                  : `${matchCursor + 1}/${matchLocalIds.length}`}
              </span>
              <button
                type="button"
                onClick={() => goToNextMatch(-1)}
                disabled={matchLocalIds.length === 0}
                aria-label="Previous match"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] disabled:opacity-40"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => goToNextMatch(1)}
                disabled={matchLocalIds.length === 0}
                aria-label="Next match"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] disabled:opacity-40"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {(Object.keys(relationFilterLabels) as ViewerGraphRelationGroup[]).map((group) => (
            <button
              key={group}
              type="button"
              aria-pressed={relationFilters[group]}
              onClick={() =>
                setRelationFilters((current) => ({ ...current, [group]: !current[group] }))
              }
              className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition ${
                relationFilters[group]
                  ? "border-[color:var(--accent)] bg-[color:var(--accent-wash)] text-[color:var(--foreground)]"
                  : "border-[color:var(--viewer-border)] text-[color:var(--muted-ink)] hover:text-[color:var(--foreground)]"
              }`}
            >
              {relationFilterLabels[group]}
            </button>
          ))}
        </div>

        <div
          aria-label="Graph legend"
          className="mt-2 space-y-1 border-t border-[color:var(--viewer-border)] pt-2 text-[10px] text-[color:var(--muted-ink)]"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="corey-mono-label w-9 shrink-0 uppercase tracking-[0.07em]">Role</span>
            {nodeLegendEntries.map((entry) => (
              <span key={entry.kind} className="inline-flex items-center gap-1.5">
                <NodeGlyph kind={entry.kind} color={colors[entry.kind]} />
                {entry.label}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="corey-mono-label w-9 shrink-0 uppercase tracking-[0.07em]">State</span>
            <span className="inline-flex items-center gap-1.5">
              <NodeGlyph kind="element" color={colors.selected} />
              Selected
            </span>
            <span className="inline-flex items-center gap-1.5">
              <NodeGlyph kind="element" color={colors.match} />
              Search match
            </span>
            <span className="inline-flex items-center gap-1.5">
              <NodeGlyph kind="element" color={colors.other} hollow />
              No 3D geometry
            </span>
          </div>
        </div>
      </header>

      <div className="shrink-0 border-b border-[color:var(--viewer-border)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">
              {selectedNode?.label ?? "No graph selection"}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-[color:var(--muted-ink)]">
              {selectedNode
                ? graphNodeLabel(selectedNode)
                : "Select a node to inspect its neighborhood"}
              {selectedNode && !selectedNode.hasGeometry ? " · no 3D geometry" : ""}
            </div>
          </div>
          <button
            type="button"
            disabled={!selectedNode}
            onClick={() => selectedNode && focusNode(selectedNode.localId)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] px-2 text-[10px] font-semibold uppercase tracking-[0.06em] transition hover:bg-[color:var(--surface-hover)] disabled:opacity-40"
          >
            <Focus className="h-3.5 w-3.5" />
            Focus
          </button>
          <button
            type="button"
            disabled={
              !selectedNode ||
              selectedNeighborhoodComplete ||
              atNodeLimit ||
              loadingCount > 0
            }
            onClick={() => selectedNode && void loadNeighborhood(selectedNode.localId)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] px-2 text-[10px] font-semibold uppercase tracking-[0.06em] transition hover:bg-[color:var(--surface-hover)] disabled:opacity-40"
          >
            {loadingCount > 0 ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Network className="h-3.5 w-3.5" />
            )}
            {selectedNeighborhoodComplete
              ? "Expanded"
              : selectedPagination?.nextOffset
                ? "Load more"
                : "Expand"}
          </button>
          <button
            type="button"
            disabled={loadingCount > 0}
            onClick={() => void loadNeighborhood(selectedLocalId, { reset: true, fit: true })}
            aria-label="Reset graph to current 3D selection"
            title="Reset graph to current 3D selection"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--r-control)] border border-[color:var(--viewer-border)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)] disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={canvasWrapperRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={containerRef}
          style={{ zoom: GRAPH_POINTER_ZOOM_RESET }}
          className="absolute inset-0 h-full w-full overflow-hidden"
        >
          {size.width > 0 && size.height > 0 ? (
            <ForceGraph2D<ViewerGraphNode, ViewerGraphEdge>
              ref={graphRef}
              width={size.width}
              height={size.height}
              graphData={data}
              backgroundColor={colors.background}
              nodeId="id"
              nodeLabel={tooltipForNode}
              nodeCanvasObject={paintNode}
              nodeCanvasObjectMode={() => "replace"}
              nodePointerAreaPaint={paintNodePointerArea}
              linkLabel={tooltipForEdge}
              linkColor={(link) => {
                if (hoverHighlight) {
                  return hoverHighlight.linkIds.has(link.id) ? colors.highlight : colors.linkDim;
                }
                return colors.link;
              }}
              linkWidth={(link) => (hoverHighlight?.linkIds.has(link.id) ? 2 : 1)}
              linkDirectionalArrowLength={3}
              linkDirectionalArrowRelPos={0.75}
              linkDirectionalParticles={0}
              enableNodeDrag
              enablePointerInteraction
              showPointerCursor
              warmupTicks={0}
              cooldownTicks={260}
              cooldownTime={5000}
              d3AlphaDecay={0.0228}
              d3VelocityDecay={0.45}
              onRenderFramePost={paintLabels}
              onNodeHover={(node) => setHoveredLocalId(node?.localId ?? null)}
              onBackgroundClick={closeContextMenu}
              onNodeRightClick={(node, event) => {
                event.preventDefault();
                const bounds = canvasWrapperRef.current?.getBoundingClientRect();
                setContextMenu({
                  localId: node.localId,
                  x: event.clientX - (bounds?.left ?? 0),
                  y: event.clientY - (bounds?.top ?? 0),
                });
              }}
              onNodeClick={(node, event) => {
                closeContextMenu();
                // The second click of a double-click expands; the first still selects, so the
                // gesture reads as "open this node" rather than replacing selection.
                if (event.detail >= 2) {
                  void loadNeighborhood(node.localId);
                  return;
                }
                setSelectedGraphLocalId(node.localId);
                focusNode(node.localId);
                onSelectNode(node.localId);
              }}
              onEngineTick={() => {
                const localId = pendingFocusLocalIdRef.current;
                if (localId === null) return;
                const node = nodesRef.current.get(localId) as
                  | NodeObject<ViewerGraphNode>
                  | undefined;
                if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
                graphRef.current?.centerAt(node.x, node.y, 250);
                pendingFocusLocalIdRef.current = null;
              }}
              onEngineStop={() => {
                if (!fitAfterLayoutRef.current) return;
                fitAfterLayoutRef.current = false;
                graphRef.current?.zoomToFit(250, 24);
              }}
            />
          ) : null}
        </div>

        {contextMenu && contextNode ? (
          <div
            role="menu"
            aria-label={`Actions for ${contextNode.label}`}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            className="absolute z-20 min-w-44 overflow-hidden rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] py-1 shadow-lg"
          >
            <div className="truncate border-b border-[color:var(--viewer-border)] px-2.5 pb-1.5 text-[10px] font-semibold text-[color:var(--muted-ink)]">
              {contextNode.label}
            </div>
            {contextMenuActions.map((action) => (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  action.run();
                  closeContextMenu();
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-[color:var(--surface-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <action.icon className="h-3.5 w-3.5 shrink-0 text-[color:var(--muted-ink)]" />
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        {loadingCount > 0 && data.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--panel-bg)]/85">
            <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--muted-ink)]">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading relationship graph…
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-x-3 top-3 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-3 py-2 text-xs text-[color:var(--danger-fg)] shadow-sm">
            {error}
          </div>
        ) : null}

        {atNodeLimit ? (
          <div className="absolute inset-x-3 bottom-3 rounded-[var(--r-control)] border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-3 py-2 text-xs text-[color:var(--warning-fg)] shadow-sm">
            Showing the {VIEWER_GRAPH_MAX_NODES}-node performance limit. Collapse or remove a node
            to make room, or reset to explore a different neighborhood.
          </div>
        ) : null}
      </div>
    </section>
  );
}
