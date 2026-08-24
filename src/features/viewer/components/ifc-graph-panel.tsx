"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Focus,
  LoaderCircle,
  Maximize2,
  Network,
  RotateCcw,
  X,
} from "lucide-react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type GraphData,
  type NodeObject,
} from "react-force-graph-2d";
import {
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
  onClose: () => void;
};

type PaginationState = {
  nextOffset: number | null;
  totalRelationCount: number;
};

type RelationFilterState = Record<ViewerGraphRelationGroup, boolean>;

const initialRelationFilters: RelationFilterState = {
  spatial: true,
  definition: true,
  material: true,
  other: true,
};

const relationFilterLabels: Record<ViewerGraphRelationGroup, string> = {
  spatial: "Spatial",
  definition: "Definitions",
  material: "Materials",
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

const GRAPH_POINTER_ZOOM_RESET = "calc(1 / 0.75)";

const graphColors = {
  light: {
    background: "#f7f9fc",
    link: "#8090a4",
    spatial: "#2563eb",
    element: "#334155",
    type: "#7c3aed",
    property: "#b45309",
    material: "#047857",
    other: "#64748b",
    selected: "#e5484d",
  },
  dark: {
    background: "#0b0f14",
    link: "#63758b",
    spatial: "#60a5fa",
    element: "#cbd5e1",
    type: "#c4b5fd",
    property: "#fbbf24",
    material: "#34d399",
    other: "#94a3b8",
    selected: "#fb7185",
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
  const category = node.ifcType ? `<br><small>${escapeHtml(node.ifcType)}</small>` : "";
  const globalId = node.globalId ? `<br><small>${escapeHtml(node.globalId)}</small>` : "";
  return `<strong>${escapeHtml(node.label)}</strong>${category}${globalId}`;
}

function tooltipForEdge(edge: ViewerGraphEdge) {
  const raw = edge.rawRelations.length > 0 ? edge.rawRelations.join(" / ") : edge.relation;
  return `<strong>${escapeHtml(edge.relation)}</strong><br><small>${escapeHtml(raw)}</small>`;
}

export function IfcGraphPanel({
  active,
  theme,
  selectedLocalId,
  onRequestNeighborhood,
  onSelectNode,
  onClose,
}: IfcGraphPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
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
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [revision, setRevision] = useState(0);
  const [loadingCount, setLoadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedGraphLocalId, setSelectedGraphLocalId] = useState<number | null>(
    selectedLocalId,
  );
  const [relationFilters, setRelationFilters] =
    useState<RelationFilterState>(initialRelationFilters);

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
    const charge = graph.d3Force("charge");
    const link = graph.d3Force("link");
    charge?.strength?.(-120);
    link?.distance?.(70);
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

        mergeViewerGraphNeighborhood({
          neighborhood,
          nodes: nodesRef.current,
          edges: edgesRef.current,
        });
        paginationRef.current.set(neighborhood.anchorLocalId, {
          nextOffset: neighborhood.nextOffset,
          totalRelationCount: neighborhood.totalRelationCount,
        });
        initializedRef.current = true;
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

  useEffect(() => {
    if (revision === 0 || !graphRef.current) return;
    graphRef.current.d3ReheatSimulation();
  }, [revision]);

  const graphData = useMemo<GraphData<ViewerGraphNode, ViewerGraphEdge>>(() => {
    // The graph maps are mutated in place; revision is their explicit memo invalidation token.
    void revision;
    const activeGroups = new Set(
      (Object.entries(relationFilters) as [ViewerGraphRelationGroup, boolean][])
        .filter(([, enabled]) => enabled)
        .map(([group]) => group),
    );
    return {
      nodes: [...nodesRef.current.values()],
      links: [...edgesRef.current.values()]
        .filter((edge) => activeGroups.has(edge.relationGroup))
        .map((edge) => ({ ...edge })),
    };
  }, [relationFilters, revision]);

  const selectedNode =
    selectedGraphLocalId === null ? null : (nodesRef.current.get(selectedGraphLocalId) ?? null);
  const selectedPagination =
    selectedGraphLocalId === null ? null : (paginationRef.current.get(selectedGraphLocalId) ?? null);
  const selectedNeighborhoodComplete = selectedPagination?.nextOffset === null;
  const atNodeLimit = nodesRef.current.size >= VIEWER_GRAPH_MAX_NODES;
  const colors = graphColors[theme];

  return (
    <section className="flex h-full min-h-0 flex-col bg-[color:var(--panel-bg)] text-[color:var(--foreground)]">
      <header className="shrink-0 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">IFC relationship graph</div>
            <div className="corey-mono-label mt-0.5 text-[10px] uppercase tracking-[0.07em] text-[color:var(--muted-ink)]">
              {nodesRef.current.size} nodes · {edgesRef.current.size} links
            </div>
          </div>
          <button
            type="button"
            onClick={() => graphRef.current?.zoomToFit(250, 24)}
            disabled={nodesRef.current.size === 0}
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
          aria-label="Node color legend"
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color:var(--viewer-border)] pt-2 text-[10px] text-[color:var(--muted-ink)]"
        >
          <span className="corey-mono-label uppercase tracking-[0.07em]">Nodes</span>
          {nodeLegendEntries.map((entry) => (
            <span key={entry.kind} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                style={{ backgroundColor: colors[entry.kind] }}
              />
              {entry.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: colors.selected }}
            />
            Selected
          </span>
        </div>
      </header>

      <div className="shrink-0 border-b border-[color:var(--viewer-border)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">
              {selectedNode?.label ?? "No graph selection"}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-[color:var(--muted-ink)]">
              {selectedNode?.ifcType ?? "Select a node to inspect its neighborhood"}
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

      <div className="relative min-h-0 flex-1 overflow-hidden">
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
              graphData={graphData}
              backgroundColor={colors.background}
              nodeId="id"
              nodeLabel={tooltipForNode}
              nodeColor={(node) =>
                node.localId === selectedGraphLocalId ? colors.selected : colors[node.kind]
              }
              nodeVal={(node) =>
                node.localId === selectedGraphLocalId ? 7 : node.kind === "spatial" ? 5 : 3
              }
              linkLabel={tooltipForEdge}
              linkColor={() => colors.link}
              linkWidth={1}
              linkDirectionalArrowLength={3}
              linkDirectionalArrowRelPos={0.75}
              linkDirectionalParticles={0}
              autoPauseRedraw
              enableNodeDrag
              enablePointerInteraction
              showPointerCursor
              warmupTicks={40}
              cooldownTicks={120}
              cooldownTime={2000}
              d3AlphaDecay={0.04}
              d3VelocityDecay={0.45}
              onNodeClick={(node) => {
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

          {loadingCount > 0 && nodesRef.current.size === 0 ? (
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
              Showing the {VIEWER_GRAPH_MAX_NODES}-node performance limit. Reset to another
              selection to explore a different neighborhood.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
