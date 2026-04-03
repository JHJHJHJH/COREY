"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { ModelTreePanel } from "@/features/viewer/components/model-tree-panel";
import { IfcViewport } from "@/features/viewer/components/ifc-viewport";
import { PropertiesPanel } from "@/features/viewer/components/properties-panel";
import { ViewerToolbar } from "@/features/viewer/components/viewer-toolbar";
import { formatBytes } from "@/features/viewer/lib/ifc-data";
import type {
  ModelMetadata,
  ViewerCategorySummary,
  ViewerSelectionDetails,
  ViewerSessionState,
  ViewerStatus,
  ViewerTreeNode,
  ViewerViewportHandle,
} from "@/features/viewer/types";

const initialStatus: ViewerStatus = {
  phase: "idle",
  message: "Choose an IFC file to begin.",
};

const initialSession: ViewerSessionState = {
  activeTool: "select",
  selected: null,
  sectionCount: 0,
  measurementCount: 0,
  hiddenItemCount: 0,
};

const DEFAULT_TREE_DRAWER_WIDTH = 336;
const DEFAULT_PROPERTIES_DRAWER_WIDTH = 368;
const MIN_DRAWER_WIDTH = 240;
const MIN_CONSTRAINED_DRAWER_WIDTH = 160;
const MAX_DRAWER_WIDTH = 520;
const MIN_VIEWPORT_WIDTH = 420;
const DRAWER_HANDLE_WIDTH = 18;

type DrawerSide = "left" | "right";

type DrawerDragState = {
  side: DrawerSide;
  startX: number;
  startWidth: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function DrawerResizeHandle({
  label,
  onPointerDown,
}: {
  label: string;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      className="group relative z-10 hidden h-full w-[18px] shrink-0 cursor-col-resize touch-none border-x border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/85 transition hover:bg-[color:var(--surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] lg:block"
    >
      <span className="absolute inset-y-1/2 left-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--viewer-border)] transition group-hover:bg-[color:var(--accent)]" />
    </button>
  );
}

export function ViewerShell() {
  const viewportRef = useRef<ViewerViewportHandle | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const [status, setStatus] = useState(initialStatus);
  const [session, setSession] = useState(initialSession);
  const [metadata, setMetadata] = useState<ModelMetadata | null>(null);
  const [tree, setTree] = useState<ViewerTreeNode[]>([]);
  const [categories, setCategories] = useState<ViewerCategorySummary[]>([]);
  const [selectionDetails, setSelectionDetails] = useState<ViewerSelectionDetails>({
    selection: null,
    data: null,
    loading: false,
  });
  const [showTree, setShowTree] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [treeDrawerWidth, setTreeDrawerWidth] = useState(DEFAULT_TREE_DRAWER_WIDTH);
  const [propertiesDrawerWidth, setPropertiesDrawerWidth] = useState(
    DEFAULT_PROPERTIES_DRAWER_WIDTH,
  );
  const [drawerDragState, setDrawerDragState] = useState<DrawerDragState | null>(null);

  const hasModel = Boolean(metadata && status.phase === "loaded");

  const clampDrawerWidth = useCallback((side: DrawerSide, nextWidth: number) => {
    const workspaceWidth = workspaceRef.current?.clientWidth ?? 0;
    if (workspaceWidth === 0) {
      return clamp(nextWidth, MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH);
    }

    const otherDrawerWidth =
      side === "left"
        ? showProperties
          ? propertiesDrawerWidth
          : 0
        : showTree
          ? treeDrawerWidth
          : 0;
    const handleCount = Number(showTree) + Number(showProperties);
    const availableWidth =
      workspaceWidth - otherDrawerWidth - handleCount * DRAWER_HANDLE_WIDTH - MIN_VIEWPORT_WIDTH;
    const maxWidth = Math.min(
      MAX_DRAWER_WIDTH,
      Math.max(MIN_CONSTRAINED_DRAWER_WIDTH, availableWidth),
    );
    const minWidth = Math.min(MIN_DRAWER_WIDTH, maxWidth);

    return clamp(nextWidth, minWidth, maxWidth);
  }, [propertiesDrawerWidth, showProperties, showTree, treeDrawerWidth]);

  const syncDrawerWidths = useCallback(() => {
    if (showTree) {
      setTreeDrawerWidth((current) => clampDrawerWidth("left", current));
    }

    if (showProperties) {
      setPropertiesDrawerWidth((current) => clampDrawerWidth("right", current));
    }
  }, [clampDrawerWidth, showProperties, showTree]);

  const stopDrawerResize = useCallback(() => {
    setDrawerDragState(null);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  const updateDraggedDrawerWidth = useCallback((clientX: number) => {
    if (!drawerDragState) {
      return;
    }

    const delta = clientX - drawerDragState.startX;
    if (drawerDragState.side === "left") {
      setTreeDrawerWidth(clampDrawerWidth("left", drawerDragState.startWidth + delta));
      return;
    }

    setPropertiesDrawerWidth(clampDrawerWidth("right", drawerDragState.startWidth - delta));
  }, [clampDrawerWidth, drawerDragState]);

  useEffect(() => {
    syncDrawerWidths();
  }, [showTree, showProperties, syncDrawerWidths]);

  useEffect(() => {
    const handleResize = () => {
      syncDrawerWidths();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [syncDrawerWidths]);

  useEffect(() => {
    if (!drawerDragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      updateDraggedDrawerWidth(event.clientX);
    };
    const handlePointerUp = () => {
      stopDrawerResize();
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
  }, [drawerDragState, stopDrawerResize, updateDraggedDrawerWidth]);

  const openFilePicker = () => {
    inputRef.current?.click();
  };

  const handleLoadBundledModel = async () => {
    startTransition(() => {
      setStatus({
        phase: "loading",
        message: "Fetching bundled test model...",
      });
    });

    try {
      const response = await fetch("/resources/testmodel.ifc");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const file = new File([blob], "testmodel.ifc", {
        type: "application/octet-stream",
      });

      await viewportRef.current?.loadIfc(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown fetch error";

      startTransition(() => {
        setStatus({
          phase: "error",
          message: `Failed to fetch bundled test model: ${message}`,
        });
      });
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await viewportRef.current?.loadIfc(file);
    event.target.value = "";
  };

  const startDrawerResize = (side: DrawerSide) => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();

    setDrawerDragState({
      side,
      startX: event.clientX,
      startWidth: side === "left" ? treeDrawerWidth : propertiesDrawerWidth,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="w-full border-b border-[color:var(--viewer-border)] bg-[linear-gradient(135deg,rgba(243,236,224,0.98),rgba(230,221,206,0.92))] shadow-[var(--viewer-shadow)]">
        <div className="flex w-full flex-col gap-4 px-0 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-ink)]">
                BCA IFC Viewer
              </div>
              <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
                    Local IFC review workspace
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-[color:var(--muted-ink)]">
                    Upload an IFC from your machine, inspect the spatial tree, review element
                    properties, isolate visibility, and place section cuts or measurements without
                    a backend.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <input
                ref={inputRef}
                type="file"
                accept=".ifc,application/octet-stream"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={openFilePicker}
                className="rounded-2xl bg-[color:var(--accent)] px-5 py-3 text-sm font-semibold text-[color:var(--accent-ink)] transition hover:brightness-95"
              >
                Open IFC file
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleLoadBundledModel();
                }}
                className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-5 py-3 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
              >
                Load test model
              </button>
              <button
                type="button"
                onClick={() => setShowTree((value) => !value)}
                className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
              >
                {showTree ? "Hide tree" : "Show tree"}
              </button>
              <button
                type="button"
                onClick={() => setShowProperties((value) => !value)}
                className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
              >
                {showProperties ? "Hide properties" : "Show properties"}
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/70 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                File
              </div>
              <div className="mt-2 truncate text-sm font-medium text-[color:var(--foreground)]">
                {metadata?.name ?? "No file loaded"}
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/70 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                Size
              </div>
              <div className="mt-2 text-sm font-medium text-[color:var(--foreground)]">
                {metadata ? formatBytes(metadata.size) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/70 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                Active Tool
              </div>
              <div className="mt-2 text-sm font-medium capitalize text-[color:var(--foreground)]">
                {session.activeTool}
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/70 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                Status
              </div>
              <div className="mt-2 text-sm font-medium text-[color:var(--foreground)]">
                {status.phase}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 w-full flex-1 flex-col">
        <main className="flex min-h-0 flex-1">
          <div
            ref={workspaceRef}
            className="relative -mt-px flex min-h-0 flex-1 overflow-hidden rounded-b-[2rem] border border-t-0 border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/60 shadow-[var(--viewer-shadow)]"
          >
            {showTree ? (
              <div className="absolute inset-y-0 left-0 z-30 w-[min(85vw,24rem)] max-w-full border-r border-[color:var(--viewer-border)] shadow-[var(--viewer-shadow)] lg:hidden">
                <ModelTreePanel
                  embedded
                  metadata={metadata}
                  categories={categories}
                  nodes={tree}
                  selection={session.selected}
                  onSelectNode={(localId) => {
                    void viewportRef.current?.selectNode(localId);
                  }}
                  onHideCategory={(category) => {
                    void viewportRef.current?.hideCategory(category);
                  }}
                  onIsolateCategory={(category) => {
                    void viewportRef.current?.isolateCategory(category);
                  }}
                />
              </div>
            ) : null}

            {showTree ? (
              <>
                <div
                  className="hidden min-h-0 shrink-0 lg:block"
                  style={{ width: `${treeDrawerWidth}px` }}
                >
                  <ModelTreePanel
                    embedded
                    metadata={metadata}
                    categories={categories}
                    nodes={tree}
                    selection={session.selected}
                    onSelectNode={(localId) => {
                      void viewportRef.current?.selectNode(localId);
                    }}
                    onHideCategory={(category) => {
                      void viewportRef.current?.hideCategory(category);
                    }}
                    onIsolateCategory={(category) => {
                      void viewportRef.current?.isolateCategory(category);
                    }}
                  />
                </div>
                <DrawerResizeHandle
                  label="Resize model tree panel"
                  onPointerDown={startDrawerResize("left")}
                />
              </>
            ) : null}

            <section className="relative min-w-0 flex-1">
              <IfcViewport
                ref={viewportRef}
                embedded
                status={status}
                activeTool={session.activeTool}
                onStatusChange={(nextStatus) => {
                  startTransition(() => {
                    setStatus(nextStatus);
                    if (nextStatus.phase !== "loaded") {
                      setMetadata((current) =>
                        current ? { ...current, loadStatus: nextStatus.phase } : current,
                      );
                    }
                  });
                }}
                onSessionChange={(nextSession) => {
                  startTransition(() => {
                    setSession(nextSession);
                  });
                }}
                onModelLoaded={({
                  metadata: nextMetadata,
                  tree: nextTree,
                  categories: nextCategories,
                }) => {
                  startTransition(() => {
                    setMetadata(nextMetadata);
                    setTree(nextTree);
                    setCategories(nextCategories);
                    setSelectionDetails({ selection: null, data: null, loading: false });
                  });
                }}
                onSelectionDetailsChange={(details) => {
                  startTransition(() => {
                    setSelectionDetails(details);
                  });
                }}
              />

              <ViewerToolbar
                disabled={!hasModel}
                session={session}
                status={status}
                onToolChange={(tool) => {
                  setSession((current) => ({ ...current, activeTool: tool }));
                  viewportRef.current?.setTool(tool);
                }}
                onFocusSelection={() => {
                  void viewportRef.current?.focusSelection();
                }}
                onShowAll={() => {
                  void viewportRef.current?.showAll();
                }}
                onHideSelection={() => {
                  void viewportRef.current?.hideSelection();
                }}
                onIsolateSelection={() => {
                  void viewportRef.current?.isolateSelection();
                }}
                onClearSections={() => {
                  viewportRef.current?.clearSections();
                }}
                onClearMeasurements={() => {
                  viewportRef.current?.clearMeasurements();
                }}
              />
            </section>

            {showProperties ? (
              <>
                <DrawerResizeHandle
                  label="Resize properties panel"
                  onPointerDown={startDrawerResize("right")}
                />
                <div
                  className="hidden min-h-0 shrink-0 lg:block"
                  style={{ width: `${propertiesDrawerWidth}px` }}
                >
                  <PropertiesPanel embedded details={selectionDetails} session={session} />
                </div>
              </>
            ) : null}

            {showProperties ? (
              <div className="absolute inset-y-0 right-0 z-40 w-[min(85vw,24rem)] max-w-full border-l border-[color:var(--viewer-border)] shadow-[var(--viewer-shadow)] lg:hidden">
                <PropertiesPanel embedded details={selectionDetails} session={session} />
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
