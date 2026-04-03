"use client";

import { startTransition, useRef, useState } from "react";
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

export function ViewerShell() {
  const viewportRef = useRef<ViewerViewportHandle | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [status, setStatus] = useState(initialStatus);
  const [session, setSession] = useState(initialSession);
  const [metadata, setMetadata] = useState<ModelMetadata | null>(null);
  const [tree, setTree] = useState<ViewerTreeNode[]>([]);
  const [categories, setCategories] = useState<ViewerCategorySummary[]>([]);
  const [selectionDetails, setSelectionDetails] = useState<ViewerSelectionDetails>({
    selection: null,
    data: null,
  });
  const [showTree, setShowTree] = useState(true);
  const [showProperties, setShowProperties] = useState(true);

  const hasModel = Boolean(metadata && status.phase === "loaded");

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

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="rounded-[2rem] border border-[color:var(--viewer-border)] bg-[linear-gradient(135deg,rgba(243,236,224,0.98),rgba(230,221,206,0.92))] px-5 py-5 shadow-[var(--viewer-shadow)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-ink)]">
                BCA IFC Viewer
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--foreground)]">
                Local IFC review in the browser with That Open components
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[color:var(--muted-ink)]">
                Upload an IFC from your machine, inspect the spatial tree, review element
                properties, isolate visibility, and place section cuts or measurements without a
                backend.
              </p>
            </div>

            <div className="grid gap-3">
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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowTree((value) => !value)}
                  className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
                >
                  {showTree ? "Hide tree" : "Show tree"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowProperties((value) => !value)}
                  className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
                >
                  {showProperties ? "Hide properties" : "Show properties"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/70 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                File
              </div>
              <div className="mt-2 text-sm font-medium text-[color:var(--foreground)]">
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
        </header>

        <main className="mt-4 flex-1">
          <div className="grid h-full gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)_minmax(20rem,24rem)]">
            {showTree ? (
              <ModelTreePanel
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
            ) : (
              <div className="hidden lg:block" />
            )}

            <section className="relative min-h-[34rem]">
              <IfcViewport
                ref={viewportRef}
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
                onModelLoaded={({ metadata: nextMetadata, tree: nextTree, categories: nextCategories }) => {
                  startTransition(() => {
                    setMetadata(nextMetadata);
                    setTree(nextTree);
                    setCategories(nextCategories);
                    setSelectionDetails({ selection: null, data: null });
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
              <PropertiesPanel details={selectionDetails} session={session} />
            ) : (
              <div className="hidden lg:block" />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
