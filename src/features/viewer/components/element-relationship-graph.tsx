"use client";

import {
  ChevronsDownUp,
  ChevronsUpDown,
  Focus,
  Search,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  buildViewerGraphView,
  formatBytes,
  getDefaultViewerGraphCollapsedKeys,
  getViewerGraphExpandableNodeKeys,
  getViewerGraphNodePathKeys,
  getViewerGraphSelectedNodeKey,
} from "@/features/viewer/lib/ifc-data";
import type {
  ModelMetadata,
  ViewerGraphData,
  ViewerGraphNode,
  ViewerSelection,
} from "@/features/viewer/types";

type ElementRelationshipGraphProps = {
  metadata: ModelMetadata | null;
  graph: ViewerGraphData;
  activeSelection: ViewerSelection | null;
  onSelectElement: (localId: number) => void;
  onClose: () => void;
};

type GraphLayoutNode = {
  node: ViewerGraphNode;
  x: number;
  y: number;
};

type GraphToolButtonProps = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

const GRAPH_NODE_WIDTH = 220;
const GRAPH_NODE_HEIGHT = 44;
const GRAPH_COLUMN_GAP = 26;
const GRAPH_ROW_GAP = 88;
const GRAPH_MARGIN = 36;
const GRAPH_MIN_WIDTH = 960;
const GRAPH_MIN_HEIGHT = 560;
const GRAPH_MAX_VISIBLE_NODES = 900;
const MIN_GRAPH_ZOOM = 0.65;
const MAX_GRAPH_ZOOM = 1.35;
const GRAPH_ZOOM_STEP = 0.1;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function buildGraphSignature(graph: ViewerGraphData) {
  return `${graph.totalNodeCount}:${graph.totalEdgeCount}:${graph.rootKeys.join("|")}`;
}

function truncateLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 1)}...`;
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

function nodeBadgeLabel(node: ViewerGraphNode) {
  if (node.kind === "element" && node.category) {
    return node.category;
  }

  return nodeKindLabel(node.kind);
}

function nodeTone(node: ViewerGraphNode, selected: boolean, matched: boolean, inSelectedPath: boolean) {
  if (selected) {
    return {
      fill: "#e7f3ee",
      stroke: "rgba(21,128,61,0.58)",
      text: "#123524",
      muted: "#2f7654",
      badgeFill: "#d9f3e5",
      badgeText: "#1e6b45",
    };
  }

  if (matched) {
    return {
      fill: "#fff7ed",
      stroke: "rgba(216,175,128,0.82)",
      text: "#4a2f18",
      muted: "#915217",
      badgeFill: "#fff1df",
      badgeText: "#915217",
    };
  }

  if (inSelectedPath) {
    return {
      fill: "#edf4ff",
      stroke: "rgba(10,92,255,0.34)",
      text: "#10203f",
      muted: "#4f7dc8",
      badgeFill: "#e7f0ff",
      badgeText: "#0a5cff",
    };
  }

  if (node.kind === "category") {
    return {
      fill: "#f7fbff",
      stroke: "rgba(10,92,255,0.22)",
      text: "#10203f",
      muted: "#5d6f94",
      badgeFill: "#edf4ff",
      badgeText: "#4f7dc8",
    };
  }

  if (node.kind === "element") {
    return {
      fill: "#ffffff",
      stroke: "rgba(10,92,255,0.14)",
      text: "#10203f",
      muted: "#5d6f94",
      badgeFill: "#f6f9ff",
      badgeText: "#5d6f94",
    };
  }

  return {
    fill: "#f9fbff",
    stroke: "rgba(10,92,255,0.18)",
    text: "#10203f",
    muted: "#5d6f94",
    badgeFill: "#eef4ff",
    badgeText: "#5d6f94",
  };
}

function GraphToolButton({ label, disabled = false, onClick, children }: GraphToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function buildGraphLayout(nodes: ViewerGraphNode[]) {
  const nodesPerDepth = new Map<number, number>();
  const layoutNodes: GraphLayoutNode[] = nodes.map((node) => {
    const indexWithinDepth = nodesPerDepth.get(node.depth) ?? 0;
    nodesPerDepth.set(node.depth, indexWithinDepth + 1);

    return {
      node,
      x: GRAPH_MARGIN + indexWithinDepth * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
      y: GRAPH_MARGIN + node.depth * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
    };
  });
  const positionByKey = new Map(layoutNodes.map((entry) => [entry.node.key, entry]));
  const maxDepth = nodes.reduce((depth, node) => Math.max(depth, node.depth), 0);
  const maxColumns = Math.max(...nodesPerDepth.values(), 1);
  const width = Math.max(
    GRAPH_MIN_WIDTH,
    GRAPH_MARGIN * 2 + maxColumns * GRAPH_NODE_WIDTH + Math.max(0, maxColumns - 1) * GRAPH_COLUMN_GAP,
  );
  const height = Math.max(
    GRAPH_MIN_HEIGHT,
    GRAPH_MARGIN * 2 + (maxDepth + 1) * GRAPH_NODE_HEIGHT + maxDepth * GRAPH_ROW_GAP,
  );

  return {
    nodes: layoutNodes,
    positionByKey,
    width,
    height,
  };
}

export function ElementRelationshipGraph({
  metadata,
  graph,
  activeSelection,
  onSelectElement,
  onClose,
}: ElementRelationshipGraphProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const graphSignature = useMemo(() => buildGraphSignature(graph), [graph]);
  const [graphUiStateBySignature, setGraphUiStateBySignature] = useState(() => ({
    [graphSignature]: {
      query: "",
      zoom: 1,
      collapsedKeys: getDefaultViewerGraphCollapsedKeys(graph),
    },
  }));
  const [isGraphTransitionPending, startGraphTransition] = useTransition();
  const activeGraphUiState =
    graphUiStateBySignature[graphSignature] ?? {
      query: "",
      zoom: 1,
      collapsedKeys: getDefaultViewerGraphCollapsedKeys(graph),
    };
  const { query, zoom } = activeGraphUiState;
  const deferredQuery = useDeferredValue(query);

  const updateGraphUiState = useCallback(
    (
      updater: (current: typeof activeGraphUiState) => typeof activeGraphUiState,
      options?: { deferred?: boolean },
    ) => {
      const applyUpdate = () => {
        setGraphUiStateBySignature((current) => {
          const base =
            current[graphSignature] ?? {
              query: "",
              zoom: 1,
              collapsedKeys: getDefaultViewerGraphCollapsedKeys(graph),
            };

          return {
            ...current,
            [graphSignature]: updater(base),
          };
        });
      };

      if (options?.deferred) {
        startGraphTransition(applyUpdate);
        return;
      }

      applyUpdate();
    },
    [graph, graphSignature, startGraphTransition],
  );

  const selectedNodeKey = useMemo(
    () => getViewerGraphSelectedNodeKey(graph, activeSelection?.localId),
    [activeSelection?.localId, graph],
  );
  const selectedPathKeys = useMemo(
    () => getViewerGraphNodePathKeys(graph, selectedNodeKey),
    [graph, selectedNodeKey],
  );
  const expandedCollapsedKeys = useMemo(() => {
    if (selectedPathKeys.size === 0) {
      return activeGraphUiState.collapsedKeys;
    }

    const next = new Set(activeGraphUiState.collapsedKeys);
    for (const pathKey of selectedPathKeys) {
      next.delete(pathKey);
    }
    return next;
  }, [activeGraphUiState.collapsedKeys, selectedPathKeys]);

  const graphView = useMemo(
    () =>
      buildViewerGraphView(graph, {
        collapsedKeys: expandedCollapsedKeys,
        query: deferredQuery,
        selectedLocalId: activeSelection?.localId,
        maxVisibleNodes: GRAPH_MAX_VISIBLE_NODES,
      }),
    [activeSelection?.localId, expandedCollapsedKeys, deferredQuery, graph],
  );
  const layout = useMemo(() => buildGraphLayout(graphView.nodes), [graphView.nodes]);
  const activeNode = useMemo(
    () =>
      activeSelection
        ? graph.nodes.find((node) => node.localId === activeSelection.localId) ?? null
        : null,
    [activeSelection, graph.nodes],
  );
  const expandableCount = useMemo(() => getViewerGraphExpandableNodeKeys(graph).size, [graph]);
  const visibleElementCount = useMemo(
    () => graphView.nodes.filter((node) => node.localId !== null).length,
    [graphView.nodes],
  );
  const renderedWidth = layout.width * zoom;
  const renderedHeight = layout.height * zoom;

  useEffect(() => {
    if (!selectedNodeKey) {
      return;
    }

    const position = layout.positionByKey.get(selectedNodeKey);
    const scroller = scrollRef.current;
    if (!position || !scroller) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const nextLeft = Math.max(0, position.x * zoom - scroller.clientWidth * 0.5 + (GRAPH_NODE_WIDTH * zoom) / 2);
      const nextTop = Math.max(0, position.y * zoom - scroller.clientHeight * 0.35);
      scroller.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [layout.positionByKey, selectedNodeKey, zoom]);

  const toggleNode = useCallback(
    (nodeKey: string) => {
      updateGraphUiState(
        (current) => {
          const next = new Set(current.collapsedKeys);
          if (next.has(nodeKey)) {
            next.delete(nodeKey);
          } else {
            next.add(nodeKey);
          }
          return {
            ...current,
            collapsedKeys: next,
          };
        },
        { deferred: true },
      );
    },
    [updateGraphUiState],
  );

  const collapseAll = useCallback(() => {
    updateGraphUiState(
      (current) => ({
        ...current,
        collapsedKeys: getViewerGraphExpandableNodeKeys(graph),
      }),
      { deferred: true },
    );
  }, [graph, updateGraphUiState]);

  const expandAll = useCallback(() => {
    updateGraphUiState(
      (current) => ({
        ...current,
        collapsedKeys: new Set(),
      }),
      { deferred: true },
    );
  }, [updateGraphUiState]);

  const resetGraph = useCallback(() => {
    updateGraphUiState(
      (current) => ({
        ...current,
        query: "",
        zoom: 1,
        collapsedKeys: getDefaultViewerGraphCollapsedKeys(graph),
      }),
      { deferred: true },
    );
  }, [graph, updateGraphUiState]);

  const focusSelection = useCallback(() => {
    if (!selectedNodeKey) {
      return;
    }

    updateGraphUiState(
      (current) => {
        const next = new Set(current.collapsedKeys);
        for (const pathKey of selectedPathKeys) {
          next.delete(pathKey);
        }
        return {
          ...current,
          query: "",
          collapsedKeys: next,
        };
      },
      { deferred: true },
    );
  }, [selectedNodeKey, selectedPathKeys, updateGraphUiState]);

  const zoomOut = useCallback(() => {
    updateGraphUiState(
      (current) => ({
        ...current,
        zoom: clamp(current.zoom - GRAPH_ZOOM_STEP, MIN_GRAPH_ZOOM, MAX_GRAPH_ZOOM),
      }),
      { deferred: true },
    );
  }, [updateGraphUiState]);

  const zoomIn = useCallback(() => {
    updateGraphUiState(
      (current) => ({
        ...current,
        zoom: clamp(current.zoom + GRAPH_ZOOM_STEP, MIN_GRAPH_ZOOM, MAX_GRAPH_ZOOM),
      }),
      { deferred: true },
    );
  }, [updateGraphUiState]);

  const hasGraph = graph.totalNodeCount > 0;
  const searchActive = deferredQuery.trim().length > 0;

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
              {graph.totalNodeCount} nodes
            </span>
            <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
              {graph.totalEdgeCount} links
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[color:var(--muted-ink)]">
            {metadata ? <span>{metadata.name}</span> : <span>No IFC loaded</span>}
            {metadata ? <span>{formatBytes(metadata.size)}</span> : null}
            <span>{graphView.nodes.length} rendered</span>
            <span>{visibleElementCount} selectable</span>
            {searchActive ? <span>{graphView.matchCount} matches</span> : null}
            {isGraphTransitionPending ? <span>Updating graph…</span> : null}
            {graphView.omittedNodeCount > 0 ? (
              <span>{graphView.omittedNodeCount} over render cap</span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="relative min-w-[18rem] max-w-[28rem] flex-1">
            <span className="sr-only">Search graph</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-ink)]" />
            <input
              value={query}
              onChange={(event) =>
                updateGraphUiState((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
              placeholder="Search element names, IDs, or IFC types"
              disabled={!hasGraph}
              className="h-10 w-full rounded-xl border border-[color:var(--viewer-border)] bg-white/80 py-2 pl-10 pr-10 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-ink)] focus:border-[color:var(--accent)] focus:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            />
            {query ? (
              <button
                type="button"
                onClick={() =>
                  updateGraphUiState((current) => ({
                    ...current,
                    query: "",
                  }))
                }
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[color:var(--viewer-border)] bg-white/90 text-[color:var(--muted-ink)] transition hover:bg-white hover:text-[color:var(--foreground)]"
                aria-label="Clear graph search"
                title="Clear graph search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <GraphToolButton
            label="Collapse graph"
            disabled={!hasGraph || isGraphTransitionPending}
            onClick={collapseAll}
          >
            <ChevronsDownUp className="h-4 w-4" />
          </GraphToolButton>
          <GraphToolButton
            label="Expand graph"
            disabled={!hasGraph || isGraphTransitionPending}
            onClick={expandAll}
          >
            <ChevronsUpDown className="h-4 w-4" />
          </GraphToolButton>
          <GraphToolButton
            label="Focus selected element"
            disabled={!activeNode || isGraphTransitionPending}
            onClick={focusSelection}
          >
            <Focus className="h-4 w-4" />
          </GraphToolButton>
          <GraphToolButton
            label="Zoom out"
            disabled={!hasGraph || isGraphTransitionPending || zoom <= MIN_GRAPH_ZOOM}
            onClick={zoomOut}
          >
            <ZoomOut className="h-4 w-4" />
          </GraphToolButton>
          <GraphToolButton
            label="Zoom in"
            disabled={!hasGraph || isGraphTransitionPending || zoom >= MAX_GRAPH_ZOOM}
            onClick={zoomIn}
          >
            <ZoomIn className="h-4 w-4" />
          </GraphToolButton>
          <button
            type="button"
            onClick={resetGraph}
            disabled={!hasGraph || isGraphTransitionPending}
            className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Reset
          </button>
          <GraphToolButton label="Close graph" onClick={onClose}>
            <X className="h-4 w-4" />
          </GraphToolButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="min-w-0 flex-1 overflow-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(246,249,255,0.96))]"
        >
          {!hasGraph ? (
            <div className="flex h-full items-center justify-center px-6 py-8">
              <div className="max-w-xl rounded-2xl border border-dashed border-[color:var(--viewer-border)] bg-white/68 px-6 py-5 text-center">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                  No Graph Data
                </div>
                <div className="mt-2 text-sm text-[color:var(--foreground)]">
                  Load an IFC model to index element relationships.
                </div>
              </div>
            </div>
          ) : graphView.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 py-8">
              <div className="max-w-xl rounded-2xl border border-dashed border-[color:var(--viewer-border)] bg-white/68 px-6 py-5 text-center">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                  No Matching Nodes
                </div>
                <div className="mt-2 text-sm text-[color:var(--foreground)]">
                  Clear the search to return to the relationship graph.
                </div>
              </div>
            </div>
          ) : (
            <svg
              width={renderedWidth}
              height={renderedHeight}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="img"
              aria-label="IFC element relationship graph"
              className="block"
              style={{ width: `${renderedWidth}px`, height: `${renderedHeight}px` }}
            >

              <g>
                {graphView.edges.map((edge) => {
                  const source = layout.positionByKey.get(edge.sourceKey);
                  const target = layout.positionByKey.get(edge.targetKey);
                  if (!source || !target) {
                    return null;
                  }

                  const startX = source.x + GRAPH_NODE_WIDTH / 2;
                  const startY = source.y + GRAPH_NODE_HEIGHT;
                  const endX = target.x + GRAPH_NODE_WIDTH / 2;
                  const endY = target.y;
                  const midY = startY + Math.max(28, (endY - startY) / 2);
                  const selectedEdge =
                    graphView.selectedPathKeys.has(edge.sourceKey) &&
                    graphView.selectedPathKeys.has(edge.targetKey);

                  return (
                    <path
                      key={edge.key}
                      d={`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`}
                      fill="none"
                      stroke={selectedEdge ? "rgba(10,92,255,0.42)" : "rgba(10,92,255,0.16)"}
                      strokeWidth={selectedEdge ? 2 : 1.4}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </g>

              <g>
                {layout.nodes.map(({ node, x, y }) => {
                  const selected = activeSelection?.localId === node.localId && node.localId !== null;
                  const matched = graphView.matchedNodeKeys.has(node.key);
                  const inSelectedPath = graphView.selectedPathKeys.has(node.key);
                  const tone = nodeTone(node, selected, matched, inSelectedPath);
                  const collapsed = expandedCollapsedKeys.has(node.key);
                  const expandable = node.childKeys.length > 0;
                  const badgeLabel = nodeBadgeLabel(node);
                  const metaLabel =
                    node.kind === "element"
                      ? [
                          "Element",
                          node.localId !== null ? `#${node.localId}` : null,
                          node.descendantCount > 0 ? `${node.descendantCount} below` : null,
                        ]
                          .filter(Boolean)
                          .join(" - ")
                      : [
                          nodeKindLabel(node.kind),
                          node.category,
                          node.localId !== null ? `#${node.localId}` : null,
                          node.descendantCount > 0 ? `${node.descendantCount} below` : null,
                        ]
                          .filter(Boolean)
                          .join(" - ");

                  return (
                    <g
                      key={node.key}
                      transform={`translate(${x}, ${y})`}
                      role={node.localId !== null ? "button" : "treeitem"}
                      tabIndex={node.localId !== null && !isGraphTransitionPending ? 0 : -1}
                      aria-label={node.localId !== null ? `Select ${node.label}` : node.label}
                      aria-selected={selected}
                      aria-disabled={node.localId !== null ? isGraphTransitionPending : undefined}
                      onClick={() => {
                        if (isGraphTransitionPending) {
                          return;
                        }
                        if (node.localId !== null) {
                          onSelectElement(node.localId);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (
                          isGraphTransitionPending ||
                          node.localId === null ||
                          (event.key !== "Enter" && event.key !== " ")
                        ) {
                          return;
                        }

                        event.preventDefault();
                        onSelectElement(node.localId);
                      }}
                      className={node.localId !== null ? "cursor-pointer outline-none" : "outline-none"}
                    >
                      <title>{node.category ? `${node.category} - ${node.label}` : node.label}</title>
                      <rect
                        x="2"
                        y="4"
                        width={GRAPH_NODE_WIDTH}
                        height={GRAPH_NODE_HEIGHT}
                        rx="8"
                        fill="rgba(10,48,128,0.08)"
                      />
                      <rect
                        width={GRAPH_NODE_WIDTH}
                        height={GRAPH_NODE_HEIGHT}
                        rx="8"
                        fill={tone.fill}
                        stroke={tone.stroke}
                        strokeWidth={selected ? 2 : 1}
                      />
                      <rect
                        x="8"
                        y="8"
                        width="58"
                        height="15"
                        rx="7.5"
                        fill={tone.badgeFill}
                        stroke={tone.stroke}
                        strokeWidth="0.8"
                      />
                      <text
                        x="37"
                        y="18"
                        textAnchor="middle"
                        fontSize="8"
                        fontWeight="700"
                        letterSpacing="0"
                        fill={tone.badgeText}
                      >
                        {truncateLabel(badgeLabel, 8)}
                      </text>
                      <text x="76" y="17" fontSize="11.5" fontWeight="700" letterSpacing="0" fill={tone.text}>
                        {truncateLabel(node.label, 22)}
                      </text>
                      <text x="76" y="31" fontSize="9" letterSpacing="0" fill={tone.muted}>
                        {truncateLabel(metaLabel, 28)}
                      </text>

                      {expandable ? (
                        <g
                          transform={`translate(${GRAPH_NODE_WIDTH - 28}, 10)`}
                          role="button"
                          tabIndex={isGraphTransitionPending ? -1 : 0}
                          aria-label={collapsed ? "Expand graph node" : "Collapse graph node"}
                          aria-disabled={isGraphTransitionPending}
                          onClick={(event) => {
                            if (isGraphTransitionPending) {
                              return;
                            }
                            event.stopPropagation();
                            toggleNode(node.key);
                          }}
                          onKeyDown={(event) => {
                            if (
                              isGraphTransitionPending ||
                              (event.key !== "Enter" && event.key !== " ")
                            ) {
                              return;
                            }

                            event.preventDefault();
                            event.stopPropagation();
                            toggleNode(node.key);
                          }}
                          className="cursor-pointer outline-none"
                        >
                          <rect width="18" height="18" rx="6" fill="rgba(255,255,255,0.78)" stroke={tone.stroke} />
                          <text
                            x="9"
                            y="12.5"
                            textAnchor="middle"
                            fontSize="12"
                            fontWeight="700"
                            letterSpacing="0"
                            fill={tone.muted}
                          >
                            {collapsed ? "+" : "-"}
                          </text>
                        </g>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        <aside className="hidden w-80 shrink-0 border-l border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/92 lg:flex lg:min-h-0 lg:flex-col">
          <div className="border-b border-[color:var(--viewer-border)] px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              Graph View
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-[color:var(--viewer-border)] bg-white/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
                  Visible
                </div>
                <div className="mt-1 font-semibold">{graphView.nodes.length}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--viewer-border)] bg-white/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
                  Expandable
                </div>
                <div className="mt-1 font-semibold">{expandableCount}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--viewer-border)] bg-white/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
                  Depth
                </div>
                <div className="mt-1 font-semibold">{graph.maxDepth}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--viewer-border)] bg-white/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
                  Zoom
                </div>
                <div className="mt-1 font-semibold">{Math.round(zoom * 100)}%</div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              Selection
            </div>
            {activeNode ? (
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <div className="break-words font-semibold text-[color:var(--foreground)]">
                    {activeNode.label}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-ink)]">
                    {activeNode.category ?? nodeKindLabel(activeNode.kind)}
                    {activeNode.localId !== null ? ` - #${activeNode.localId}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={focusSelection}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
                >
                  <Focus className="h-3.5 w-3.5" />
                  Focus
                </button>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-[color:var(--viewer-border)] px-3 py-4 text-sm text-[color:var(--muted-ink)]">
                No element selected.
              </div>
            )}

            {graphView.omittedNodeCount > 0 ? (
              <div className="mt-4 rounded-xl border border-[#d8af80] bg-[#fff7ed] px-3 py-3 text-xs leading-5 text-[#915217]">
                Rendering is capped at {GRAPH_MAX_VISIBLE_NODES} nodes. Collapse branches or search
                to narrow the graph.
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
