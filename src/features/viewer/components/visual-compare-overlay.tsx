"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import * as THREE from "three";
import {
  CompareViewport,
  type CompareCameraControls,
  type CompareViewportHandle,
  type CompareViewportVisualState,
} from "@/features/viewer/components/compare-viewport";
import {
  DiffBadge,
  PropertiesPanel,
  type PropertyDiffTone,
} from "@/features/viewer/components/properties-panel";
import { buildSelectionInspection } from "@/features/viewer/lib/ifc-data";
import type {
  ModelCompareChangedElement,
  ModelCompareElementRef,
  ModelCompareFieldChange,
  ViewerSelection,
  ViewerSelectionDetails,
  VisualCompareRequest,
} from "@/features/viewer/types";

type VisualCompareOverlayProps = {
  request: VisualCompareRequest;
  /**
   * Active viewer theme. The overlay is portaled to `document.body` (outside
   * the shell's `data-viewer-theme` subtree), so it must carry the theme itself.
   */
  theme: "light" | "dark";
  onClose: () => void;
};

type PaneKey = "base" | "target";

type PaneStatus = {
  phase: "loading" | "ready" | "error";
  message: string;
};

type VisualDiffIds = {
  baseChanged: number[];
  targetChanged: number[];
  removed: number[];
  added: number[];
};

type VisualSectionKey = "changed" | "added" | "removed";

type SidePanelState = {
  collapsed: boolean;
  width: number;
};

const SIDE_PANEL_MIN_WIDTH = 240;
const SIDE_PANEL_MAX_WIDTH = 640;
const SIDE_PANEL_DEFAULT: SidePanelState = { collapsed: false, width: 340 };

/** A field with no base value was added in the target; no target value = removed. */
function fieldDiffTone(field: ModelCompareFieldChange): PropertyDiffTone {
  if (field.base === null) {
    return "added";
  }
  if (field.target === null) {
    return "removed";
  }
  return "modified";
}

/** Element-level diff status: changed rows carry a field diff, otherwise the missing side decides. */
function elementDiffTone(element: ModelCompareElementRef): PropertyDiffTone {
  if ("fields" in element) {
    return "modified";
  }
  return element.baseExpressId === null ? "added" : "removed";
}

const fieldToneText: Record<PropertyDiffTone, string> = {
  added: "text-[color:var(--success-fg)]",
  removed: "text-[color:var(--danger-fg)]",
  modified: "text-[color:var(--warning-fg)]",
};

async function fetchVersionBytes(modelId: string, version: number): Promise<Uint8Array> {
  const response = await fetch(
    `/api/models/${encodeURIComponent(modelId)}/versions/${version}/file`,
  );
  if (!response.ok) {
    throw new Error(`Version v${version} could not be downloaded (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The pane runtimes initialize asynchronously; wait until controls exist. */
async function waitForViewport(handle: CompareViewportHandle | null) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (handle?.getControls()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The 3D pane failed to initialize.");
}

/**
 * Full-screen visual delta comparison: base and target versions rendered in
 * two camera-synced 3D panes, with the structural diff as a clickable row
 * list. Clicking a row zooms both panes to the element and ghosts the rest.
 */
export function VisualCompareOverlay({ request, theme, onClose }: VisualCompareOverlayProps) {
  const { result } = request;
  const baseRef = useRef<CompareViewportHandle | null>(null);
  const targetRef = useRef<CompareViewportHandle | null>(null);
  const cameraSyncLockRef = useRef(false);

  const [paneStatus, setPaneStatus] = useState<Record<PaneKey, PaneStatus>>({
    base: { phase: "loading", message: "Downloading…" },
    target: { phase: "loading", message: "Waiting for base version…" },
  });
  const [panesReady, setPanesReady] = useState(false);
  const [focusedElement, setFocusedElement] = useState<ModelCompareElementRef | null>(null);
  const [propertySide, setPropertySide] = useState<PaneKey>("target");
  const [propertyDetails, setPropertyDetails] = useState<ViewerSelectionDetails>({
    selection: null,
    inspection: null,
    loading: false,
  });
  const [diffColorsEnabled, setDiffColorsEnabled] = useState(true);
  const [diffPanel, setDiffPanel] = useState<SidePanelState>(SIDE_PANEL_DEFAULT);
  const [propsPanel, setPropsPanel] = useState<SidePanelState>(SIDE_PANEL_DEFAULT);
  const [openSection, setOpenSection] = useState<VisualSectionKey>(
    result.summary.changedCount > 0 ? "changed" : result.summary.addedCount > 0 ? "added" : "removed",
  );

  const diffIds = useMemo<VisualDiffIds>(() => {
    const baseChanged: number[] = [];
    const targetChanged: number[] = [];
    for (const element of result.changed) {
      if (element.baseExpressId !== null) {
        baseChanged.push(element.baseExpressId);
      }
      if (element.targetExpressId !== null) {
        targetChanged.push(element.targetExpressId);
      }
    }

    return {
      baseChanged,
      targetChanged,
      removed: result.removed
        .map((element) => element.baseExpressId)
        .filter((id): id is number => id !== null),
      added: result.added
        .map((element) => element.targetExpressId)
        .filter((id): id is number => id !== null),
    };
  }, [result]);

  // Close on Escape without also closing the compare dialog underneath: its
  // ViewerDialog listens in the bubble phase, so capture + stopPropagation
  // keeps the event from reaching it while the overlay is open.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const unlinkers: Array<() => void> = [];

    const setPane = (pane: PaneKey, status: PaneStatus) => {
      if (!cancelled) {
        setPaneStatus((current) => ({ ...current, [pane]: status }));
      }
    };

    const loadPane = async (
      pane: PaneKey,
      handle: CompareViewportHandle | null,
      bytes: Uint8Array,
      version: number,
    ) => {
      await waitForViewport(handle);
      if (cancelled || !handle) {
        return;
      }

      setPane(pane, { phase: "loading", message: `Converting v${version}…` });
      await handle.loadModel(bytes, `${request.name} v${version}`, (percent) => {
        setPane(pane, { phase: "loading", message: `Converting v${version}… ${percent}%` });
      });
      setPane(pane, { phase: "ready", message: "" });
    };

    const linkCameras = (source: CompareCameraControls, follower: CompareCameraControls) => {
      const sourcePosition = new THREE.Vector3();
      const sourceTarget = new THREE.Vector3();
      const followerPosition = new THREE.Vector3();
      const followerTarget = new THREE.Vector3();

      const handleUpdate = () => {
        if (cameraSyncLockRef.current) {
          return;
        }

        source.getPosition(sourcePosition);
        source.getTarget(sourceTarget);
        follower.getPosition(followerPosition);
        follower.getTarget(followerTarget);
        if (
          sourcePosition.distanceToSquared(followerPosition) < 1e-10 &&
          sourceTarget.distanceToSquared(followerTarget) < 1e-10
        ) {
          return;
        }

        cameraSyncLockRef.current = true;
        try {
          void follower.setLookAt(
            sourcePosition.x,
            sourcePosition.y,
            sourcePosition.z,
            sourceTarget.x,
            sourceTarget.y,
            sourceTarget.z,
            false,
          );
        } finally {
          cameraSyncLockRef.current = false;
        }
      };

      source.addEventListener("update", handleUpdate);
      return () => source.removeEventListener("update", handleUpdate);
    };

    void (async () => {
      try {
        const [baseBytes, targetBytes] = await Promise.all([
          fetchVersionBytes(request.modelId, request.baseVersion),
          fetchVersionBytes(request.modelId, request.targetVersion),
        ]);
        if (cancelled) {
          return;
        }

        // Sequential loads keep only one WASM conversion in flight at a time.
        await loadPane("base", baseRef.current, baseBytes, request.baseVersion);
        if (cancelled) {
          return;
        }
        await loadPane("target", targetRef.current, targetBytes, request.targetVersion);
        if (cancelled) {
          return;
        }

        const baseControls = baseRef.current?.getControls();
        const targetControls = targetRef.current?.getControls();
        if (!baseControls || !targetControls) {
          return;
        }

        // Align the target pane to the base pose once, then keep both linked.
        const position = new THREE.Vector3();
        const lookTarget = new THREE.Vector3();
        baseControls.getPosition(position);
        baseControls.getTarget(lookTarget);
        await targetControls.setLookAt(
          position.x,
          position.y,
          position.z,
          lookTarget.x,
          lookTarget.y,
          lookTarget.z,
          false,
        );

        unlinkers.push(
          linkCameras(baseControls, targetControls),
          linkCameras(targetControls, baseControls),
        );
        if (!cancelled) {
          setPanesReady(true);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "The versions could not be loaded.";
        setPaneStatus((current) => ({
          base: current.base.phase === "ready" ? current.base : { phase: "error", message },
          target: current.target.phase === "ready" ? current.target : { phase: "error", message },
        }));
      }
    })();

    return () => {
      cancelled = true;
      for (const unlink of unlinkers) {
        unlink();
      }
    };
  }, [request]);

  // Repaint both panes whenever focus or the ambient-color toggle changes.
  useEffect(() => {
    if (!panesReady) {
      return;
    }

    const baseState: CompareViewportVisualState = focusedElement
      ? {
          mode: "focus",
          focusLocalId: focusedElement.baseExpressId,
          tone: elementDiffTone(focusedElement),
        }
      : diffColorsEnabled
        ? {
            mode: "diff",
            changedIds: diffIds.baseChanged,
            deltaIds: diffIds.removed,
            deltaTone: "removed",
          }
        : { mode: "none" };
    const targetState: CompareViewportVisualState = focusedElement
      ? {
          mode: "focus",
          focusLocalId: focusedElement.targetExpressId,
          tone: elementDiffTone(focusedElement),
        }
      : diffColorsEnabled
        ? {
            mode: "diff",
            changedIds: diffIds.targetChanged,
            deltaIds: diffIds.added,
            deltaTone: "added",
          }
        : { mode: "none" };

    void baseRef.current?.applyVisualState(baseState);
    void targetRef.current?.applyVisualState(targetState);
  }, [panesReady, focusedElement, diffColorsEnabled, diffIds]);

  // Load the focused element's full properties from the pane that owns the
  // selected version side.
  useEffect(() => {
    if (!panesReady || !focusedElement) {
      setPropertyDetails({ selection: null, inspection: null, loading: false });
      return;
    }

    const localId =
      propertySide === "target" ? focusedElement.targetExpressId : focusedElement.baseExpressId;
    const handle = propertySide === "target" ? targetRef.current : baseRef.current;
    const version = propertySide === "target" ? request.targetVersion : request.baseVersion;
    const selection: ViewerSelection = {
      modelId: `${request.name} v${version}`,
      localId: localId ?? -1,
      label: focusedElement.name ?? focusedElement.globalId,
      category: focusedElement.ifcType,
    };

    if (localId === null || !handle) {
      setPropertyDetails({ selection, inspection: null, loading: false });
      return;
    }

    let cancelled = false;
    setPropertyDetails({ selection, inspection: null, loading: true });
    void (async () => {
      const data = await handle.getItemData(localId);
      if (cancelled) {
        return;
      }

      setPropertyDetails({
        selection,
        inspection: data ? buildSelectionInspection(selection, data) : null,
        loading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [panesReady, focusedElement, propertySide, request]);

  // Animates back to the initial whole-model framing; camera sync carries the
  // other pane along.
  const resetView = () => {
    void (baseRef.current ?? targetRef.current)?.fitModel();
  };

  const clearFocus = () => {
    setFocusedElement(null);
    resetView();
  };

  const handleRowClick = (element: ModelCompareElementRef) => {
    if (!panesReady) {
      return;
    }

    if (focusedElement?.globalId === element.globalId) {
      clearFocus();
      return;
    }

    setFocusedElement(element);
    setPropertySide(element.targetExpressId !== null ? "target" : "base");
    // Zoom the pane that owns the element; camera sync carries the other one.
    // Elements without renderable geometry (e.g. property-only changes) fall
    // back to the initial framing so the click always answers with a view.
    void (async () => {
      if (
        element.targetExpressId !== null &&
        (await targetRef.current?.focusElement(element.targetExpressId))
      ) {
        return;
      }
      if (
        element.baseExpressId !== null &&
        (await baseRef.current?.focusElement(element.baseExpressId))
      ) {
        return;
      }
      resetView();
    })();
  };

  const sections = useMemo(
    () =>
      [
        // Dot colors match the 3D diff materials in compare-viewport.tsx:
        // orange = modified, green = added, red = removed.
        {
          key: "changed" as const,
          title: "Changed",
          tone: "bg-[#e07b2a]",
          count: result.summary.changedCount,
          entries: result.changed as ModelCompareElementRef[],
        },
        {
          key: "added" as const,
          title: "Added",
          tone: "bg-[#2e9e5b]",
          count: result.summary.addedCount,
          entries: result.added,
        },
        {
          key: "removed" as const,
          title: "Removed",
          tone: "bg-[#d64545]",
          count: result.summary.removedCount,
          entries: result.removed,
        },
      ].filter((section) => section.count > 0 || section.entries.length > 0),
    [result],
  );

  // Changed-field keys of the focused element mapped to their diff tone, used
  // to mark the matching rows in the properties panel. Added/removed elements
  // have no field diff.
  const highlightTargets = useMemo(() => {
    if (!focusedElement || !("fields" in focusedElement)) {
      return null;
    }

    const changed = focusedElement as ModelCompareChangedElement;
    const targets = new Map<string, PropertyDiffTone>();
    for (const field of changed.fields) {
      targets.set(field.field.toLowerCase(), fieldDiffTone(field));
    }
    return targets;
  }, [focusedElement]);

  // Element-level status of the focused row, shown as a chip in the
  // properties panel header.
  const focusedTone = focusedElement ? elementDiffTone(focusedElement) : null;

  const beginPanelResize =
    (panel: "diff" | "props") => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const setPanel = panel === "diff" ? setDiffPanel : setPropsPanel;
      const startWidth = (panel === "diff" ? diffPanel : propsPanel).width;
      // The diff panel sits on the left (drag right = wider); the properties
      // panel sits on the right (drag right = narrower).
      const direction = panel === "diff" ? 1 : -1;
      // Pointer coordinates are visual px while the grid widths are layout px;
      // the app-wide `html { zoom }` (globals.css) scales between the two.
      const zoom =
        Number.parseFloat(window.getComputedStyle(document.documentElement).zoom || "1") || 1;

      const handleMove = (moveEvent: PointerEvent) => {
        const width = Math.min(
          SIDE_PANEL_MAX_WIDTH,
          Math.max(
            SIDE_PANEL_MIN_WIDTH,
            startWidth + (direction * (moveEvent.clientX - startX)) / zoom,
          ),
        );
        setPanel((current) => ({ ...current, width }));
      };
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    };

  const renderResizeHandle = (panel: "diff" | "props") => (
    <div
      onPointerDown={beginPanelResize(panel)}
      className={`absolute inset-y-0 z-10 hidden w-1.5 cursor-col-resize touch-none transition hover:bg-[color:var(--accent)]/50 lg:block ${
        panel === "diff" ? "right-0" : "left-0"
      }`}
      role="separator"
      aria-orientation="vertical"
      aria-label={panel === "diff" ? "Resize differences panel" : "Resize properties panel"}
    />
  );

  const renderCollapsedRail = (panel: "diff" | "props", onExpand: () => void) => (
    <div className="hidden h-full flex-col items-center gap-2 py-2 lg:flex">
      <button
        type="button"
        onClick={onExpand}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
        aria-label={panel === "diff" ? "Expand differences panel" : "Expand properties panel"}
      >
        {panel === "diff" ? (
          <PanelLeftOpen className="h-4 w-4" />
        ) : (
          <PanelRightOpen className="h-4 w-4" />
        )}
      </button>
      <span className="text-[11px] font-semibold text-[color:var(--muted-ink)] [writing-mode:vertical-rl]">
        {panel === "diff" ? "Differences" : "Properties"}
      </span>
    </div>
  );

  // Base/Target switch for elements that exist in both versions; added and
  // removed elements have only one side, so the panel pins to it without tabs.
  const propertySideTabs =
    focusedElement &&
    focusedElement.baseExpressId !== null &&
    focusedElement.targetExpressId !== null ? (
      <div className="flex items-center gap-0.5 rounded-md border border-[color:var(--viewer-border)] p-0.5 text-[11px]">
        {(["base", "target"] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => setPropertySide(side)}
            aria-pressed={propertySide === side}
            className={`rounded px-1.5 py-0.5 font-semibold tabular-nums transition ${
              propertySide === side
                ? "bg-[color:var(--surface-strong)] text-[color:var(--foreground)]"
                : "text-[color:var(--muted-ink)] hover:text-[color:var(--foreground)]"
            }`}
          >
            v{side === "base" ? request.baseVersion : request.targetVersion}
          </button>
        ))}
      </div>
    ) : null;

  const renderPane = (
    pane: PaneKey,
    ref: React.Ref<CompareViewportHandle>,
    version: number,
    className = "",
  ) => {
    const status = paneStatus[pane];
    return (
      <div className={`relative min-h-0 min-w-0 ${className}`}>
        <CompareViewport
          ref={ref}
          theme={theme}
          label={`v${version} · ${pane === "base" ? "Base" : "Target"}`}
        />
        {status.phase !== "ready" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color:var(--viewport-overlay)]">
            <div
              className={`flex items-center gap-2 rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/95 px-3 py-2 text-xs ${
                status.phase === "error"
                  ? "text-[color:var(--danger-fg)]"
                  : "text-[color:var(--muted-ink)]"
              }`}
            >
              {status.phase === "loading" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {status.message}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return createPortal(
    <div
      data-viewer-theme={theme}
      className="fixed inset-0 z-[110] flex flex-col bg-[color:var(--panel-bg)] text-[color:var(--foreground)]"
      role="dialog"
      aria-modal="true"
      aria-label="Visual compare"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--viewer-border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Columns2 className="h-5 w-5 shrink-0 text-[color:var(--accent)]" />
          <span className="truncate text-sm font-semibold">Visual compare</span>
          <span className="truncate text-xs text-[color:var(--muted-ink)]">{request.name}</span>
          <span className="shrink-0 rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-2 py-0.5 text-[11px] font-semibold tabular-nums">
            v{request.baseVersion} → v{request.targetVersion}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
          aria-label="Close visual compare"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        className={`grid min-h-0 flex-1 grid-cols-[1fr_1fr] grid-rows-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[minmax(0,1fr)] ${
          focusedElement
            ? "lg:grid-cols-[var(--diff-col)_1fr_1fr_var(--props-col)]"
            : "lg:grid-cols-[var(--diff-col)_1fr_1fr]"
        }`}
        style={
          {
            "--diff-col": diffPanel.collapsed ? "2.75rem" : `${diffPanel.width}px`,
            "--props-col": propsPanel.collapsed ? "2.75rem" : `${propsPanel.width}px`,
          } as React.CSSProperties
        }
      >
        {renderPane("base", baseRef, request.baseVersion, "order-1 lg:order-2")}
        {renderPane(
          "target",
          targetRef,
          request.targetVersion,
          "order-2 lg:order-3 border-l border-[color:var(--viewer-border)]",
        )}

        <div
          className={`relative order-3 flex min-h-0 flex-col border-t border-[color:var(--viewer-border)] lg:order-1 lg:col-span-1 lg:border-r lg:border-t-0 ${
            focusedElement ? "col-span-1" : "col-span-2"
          }`}
        >
          {diffPanel.collapsed
            ? renderCollapsedRail("diff", () =>
                setDiffPanel((current) => ({ ...current, collapsed: false })),
              )
            : null}

          <div
            className={`flex min-h-0 flex-1 flex-col ${diffPanel.collapsed ? "lg:hidden" : ""}`}
          >
          <div className="flex items-center justify-between gap-2 border-b border-[color:var(--viewer-border)] px-3 py-2">
            <span className="text-xs font-semibold">Differences</span>
            <div className="flex items-center gap-1.5">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[color:var(--muted-ink)]">
                <input
                  type="checkbox"
                  checked={diffColorsEnabled}
                  onChange={(event) => setDiffColorsEnabled(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[color:var(--accent)]"
                />
                Diff colors
              </label>
              <button
                type="button"
                onClick={() => setDiffPanel((current) => ({ ...current, collapsed: true }))}
                className="hidden h-6 w-6 items-center justify-center rounded-md text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)] lg:inline-flex"
                aria-label="Collapse differences panel"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {focusedElement ? (
            <div className="flex items-center justify-between gap-2 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-3 py-2 text-[11px]">
              <span className="min-w-0 truncate">
                Focused:{" "}
                <span className="font-semibold">
                  {focusedElement.name ?? focusedElement.globalId}
                </span>
              </span>
              <button
                type="button"
                onClick={clearFocus}
                className="shrink-0 font-semibold text-[color:var(--accent)] transition hover:underline"
              >
                Clear focus
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {sections.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-[color:var(--muted-ink)]">
                The versions have no structural differences.
              </p>
            ) : (
              sections.map((section) => (
                <section key={section.key} className="mb-1">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenSection((current) =>
                        current === section.key ? "changed" : section.key,
                      )
                    }
                    aria-expanded={openSection === section.key}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs font-semibold transition hover:bg-[color:var(--surface-strong)]"
                  >
                    {openSection === section.key ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className={`h-2 w-2 shrink-0 rounded-full ${section.tone}`} />
                    {section.title}
                    <span className="tabular-nums text-[color:var(--muted-ink)]">
                      {section.count}
                    </span>
                  </button>
                  {openSection === section.key ? (
                    <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                      {section.entries.map((element) => {
                        const focused = focusedElement?.globalId === element.globalId;
                        const changed =
                          section.key === "changed"
                            ? (element as ModelCompareChangedElement)
                            : null;
                        return (
                          <li key={element.globalId}>
                            <button
                              type="button"
                              onClick={() => handleRowClick(element)}
                              aria-pressed={focused}
                              disabled={!panesReady}
                              title={`Zoom to ${element.name ?? element.globalId}`}
                              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                focused
                                  ? "border-[color:var(--accent)] bg-[color:var(--surface-strong)]"
                                  : "border-transparent hover:bg-[color:var(--surface-strong)]"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${section.tone}`}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 truncate">
                                <span className="font-medium">
                                  {element.name ?? element.globalId}
                                </span>
                                <span className="ml-2 text-[11px] text-[color:var(--muted-ink)]">
                                  {element.ifcType}
                                </span>
                              </span>
                              {changed ? (
                                <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--muted-ink)]">
                                  {changed.fields.length}{" "}
                                  {changed.fields.length === 1 ? "field" : "fields"}
                                </span>
                              ) : null}
                            </button>
                            {changed ? (
                              <ul className="mb-1 mt-0.5 flex flex-col gap-1 border-l border-[color:var(--viewer-border)] py-1 pl-3 ml-2">
                                {changed.fields.map((field) => (
                                  <li key={field.field} className="text-[11px] leading-snug">
                                    <span
                                      className={`font-semibold ${fieldToneText[fieldDiffTone(field)]}`}
                                    >
                                      {field.label}
                                    </span>
                                    <span className="ml-1.5 text-[color:var(--muted-ink)] line-through">
                                      {field.base?.text ?? "—"}
                                    </span>
                                    <span className="mx-1 text-[color:var(--muted-ink)]">→</span>
                                    <span>{field.target?.text ?? "—"}</span>
                                  </li>
                                ))}
                                {changed.fieldsTruncated ? (
                                  <li className="text-[11px] text-[color:var(--muted-ink)]">
                                    More field changes were truncated.
                                  </li>
                                ) : null}
                              </ul>
                            ) : null}
                          </li>
                        );
                      })}
                      {section.entries.length < section.count ? (
                        <li className="px-2 py-1 text-[11px] text-[color:var(--muted-ink)]">
                          List truncated; counts reflect the full diff.
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </section>
              ))
            )}
          </div>
          </div>

          {!diffPanel.collapsed ? renderResizeHandle("diff") : null}
        </div>

        {focusedElement ? (
          <div className="relative order-4 flex min-h-0 flex-col border-l border-t border-[color:var(--viewer-border)] lg:border-t-0">
            {propsPanel.collapsed
              ? renderCollapsedRail("props", () =>
                  setPropsPanel((current) => ({ ...current, collapsed: false })),
                )
              : null}

            <div className={`min-h-0 flex-1 ${propsPanel.collapsed ? "lg:hidden" : ""}`}>
              <PropertiesPanel
                compact
                details={propertyDetails}
                highlightTargets={highlightTargets}
                headerAccessory={
                  <div className="flex items-center gap-1.5">
                    {focusedTone ? <DiffBadge tone={focusedTone} /> : null}
                    {propertySideTabs}
                    <button
                      type="button"
                      onClick={() =>
                        setPropsPanel((current) => ({ ...current, collapsed: true }))
                      }
                      className="hidden h-6 w-6 items-center justify-center rounded-md text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)] lg:inline-flex"
                      aria-label="Collapse properties panel"
                    >
                      <PanelRightClose className="h-3.5 w-3.5" />
                    </button>
                  </div>
                }
              />
            </div>

            {!propsPanel.collapsed ? renderResizeHandle("props") : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
