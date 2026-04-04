"use client";

import Link from "next/link";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyViewerValidationToInspection,
  buildViewerValidationRows,
  compileViewerValidationRules,
  groupViewerValidationResultsBySeverity,
  VIEWER_VALIDATION_CONFIG_VERSION,
} from "@/features/rules/lib/validation";
import { useViewerRules } from "@/features/rules/rules-provider";
import { DataTablePanel } from "@/features/viewer/components/data-table-panel";
import { ModelTreePanel } from "@/features/viewer/components/model-tree-panel";
import { IfcViewport } from "@/features/viewer/components/ifc-viewport";
import { PropertiesPanel } from "@/features/viewer/components/properties-panel";
import { ViewerToolbar } from "@/features/viewer/components/viewer-toolbar";
import { formatBytes } from "@/features/viewer/lib/ifc-data";
import type {
  ModelMetadata,
  ViewerCategorySummary,
  ViewerDataTableState,
  ViewerSelectionDetails,
  ViewerSessionState,
  ViewerStatus,
  ViewerValidationHighlights,
  ViewerValidationRunPayload,
  ViewerValidationRunResult,
  ViewerTreeNode,
  ViewerViewportHandle,
} from "@/features/viewer/types";

const initialStatus: ViewerStatus = {
  phase: "idle",
  message: "Choose an IFC file to begin.",
};

const initialDataTableState: ViewerDataTableState = {
  phase: "idle",
  message: "Load a model to review element data in a table.",
  data: null,
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
const DEFAULT_DATA_TABLE_DIALOG_WIDTH = 1120;
const DEFAULT_DATA_TABLE_DIALOG_HEIGHT = 560;
const MIN_DATA_TABLE_DIALOG_WIDTH = 420;
const MIN_DATA_TABLE_DIALOG_HEIGHT = 260;
const MAX_DATA_TABLE_DIALOG_WIDTH = Number.POSITIVE_INFINITY;
const MAX_DATA_TABLE_DIALOG_HEIGHT = Number.POSITIVE_INFINITY;
const DATA_TABLE_DIALOG_MARGIN = 12;

const validationWorkerUrl = new URL("../../rules/workers/validation-worker.ts", import.meta.url);

const emptyValidationHighlights: ViewerValidationHighlights = {
  warn: {},
  error: {},
};

type ViewerValidationPhase = "idle" | "running" | "ready" | "error";

type ViewerValidationState = {
  phase: ViewerValidationPhase;
  mode: "worker" | "api" | null;
  progress: number;
  issueCount: number;
  message: string;
};

const initialValidationState: ViewerValidationState = {
  phase: "idle",
  mode: null,
  progress: 0,
  issueCount: 0,
  message: "No validation rules configured.",
};

type DrawerSide = "left" | "right";

type DrawerDragState = {
  side: DrawerSide;
  startX: number;
  startWidth: number;
};

type DataTableDialogLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  initialized: boolean;
};

type DataTableDialogMoveState = {
  startX: number;
  startY: number;
  startLayout: DataTableDialogLayout;
};

type DataTableDialogResizeState = {
  startX: number;
  startY: number;
  startLayout: DataTableDialogLayout;
};

type ViewerValidationWorkerMessage =
  | {
      type: "progress";
      runId: string;
      processedRowCount: number;
      totalRowCount: number;
    }
  | {
      type: "result";
      runId: string;
      result: ViewerValidationRunResult;
    }
  | {
      type: "error";
      runId: string;
      message: string;
    };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function handleToggleGlyph(side: DrawerSide, collapsed: boolean) {
  if (side === "left") {
    return collapsed ? ">" : "<";
  }

  return collapsed ? "<" : ">";
}

function dataTablePhaseTone(phase: ViewerDataTableState["phase"]) {
  switch (phase) {
    case "loading":
      return "border-[#d8af80] bg-[#fff1df] text-[#915217]";
    case "error":
      return "border-[#c78972] bg-[#fff0ea] text-[#8a3e1f]";
    case "loaded":
      return "border-[color:var(--viewer-border)] bg-white/70 text-[color:var(--muted-ink)]";
    default:
      return "border-[color:var(--viewer-border)] bg-white/60 text-[color:var(--muted-ink)]";
  }
}

function validationPhaseTone(phase: ViewerValidationState["phase"]) {
  switch (phase) {
    case "running":
      return "border-[#d8af80] bg-[#fff1df] text-[#915217]";
    case "error":
      return "border-[#c78972] bg-[#fff0ea] text-[#8a3e1f]";
    case "ready":
      return "border-[color:var(--viewer-border)] bg-white/70 text-[color:var(--muted-ink)]";
    default:
      return "border-[color:var(--viewer-border)] bg-white/60 text-[color:var(--muted-ink)]";
  }
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 16V5" strokeLinecap="round" />
      <path d="m8 9 4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" strokeLinecap="round" />
    </svg>
  );
}

function CubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" strokeLinejoin="round" />
      <path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PanelLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
      <path d="M9 5v14" strokeLinecap="round" />
    </svg>
  );
}

function PanelRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
      <path d="M15 5v14" strokeLinecap="round" />
    </svg>
  );
}

function TableIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="4.5" y="5" width="15" height="14" rx="2.5" />
      <path d="M4.5 10h15M9.5 10v9M14.5 10v9" strokeLinecap="round" />
    </svg>
  );
}

function StatusDot({ phase }: { phase: ViewerStatus["phase"] }) {
  const tone =
    phase === "loaded"
      ? "bg-emerald-500"
      : phase === "loading"
        ? "bg-amber-500"
        : phase === "error"
          ? "bg-rose-500"
          : "bg-[color:var(--viewer-border)]";

  return <span className={`h-2.5 w-2.5 rounded-full ${tone}`} aria-hidden="true" />;
}

type HeaderActionButtonProps = {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function HeaderActionButton({
  label,
  active = false,
  onClick,
  children,
}: HeaderActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-xl border transition ${
        active
          ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
          : "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-strong)]"
      }`}
    >
      {children}
    </button>
  );
}

function clampDataTableDialogLayoutToBounds(
  layout: DataTableDialogLayout,
  boundsWidth: number,
  boundsHeight: number,
) {
  if (boundsWidth <= 0 || boundsHeight <= 0) {
    return layout;
  }

  const maxWidth = Math.max(1, boundsWidth - DATA_TABLE_DIALOG_MARGIN * 2);
  const maxHeight = Math.max(1, boundsHeight - DATA_TABLE_DIALOG_MARGIN * 2);
  const width = clamp(
    layout.width,
    Math.min(MIN_DATA_TABLE_DIALOG_WIDTH, maxWidth),
    Math.min(MAX_DATA_TABLE_DIALOG_WIDTH, maxWidth),
  );
  const height = clamp(
    layout.height,
    Math.min(MIN_DATA_TABLE_DIALOG_HEIGHT, maxHeight),
    Math.min(MAX_DATA_TABLE_DIALOG_HEIGHT, maxHeight),
  );
  const maxX = Math.max(DATA_TABLE_DIALOG_MARGIN, boundsWidth - width - DATA_TABLE_DIALOG_MARGIN);
  const maxY = Math.max(
    DATA_TABLE_DIALOG_MARGIN,
    boundsHeight - height - DATA_TABLE_DIALOG_MARGIN,
  );

  return {
    x: clamp(layout.x, DATA_TABLE_DIALOG_MARGIN, maxX),
    y: clamp(layout.y, DATA_TABLE_DIALOG_MARGIN, maxY),
    width,
    height,
    initialized: true,
  } satisfies DataTableDialogLayout;
}

function buildDefaultDataTableDialogLayout(boundsWidth: number, boundsHeight: number) {
  const clampedLayout = clampDataTableDialogLayoutToBounds(
    {
      x: DATA_TABLE_DIALOG_MARGIN,
      y: DATA_TABLE_DIALOG_MARGIN,
      width: Math.max(
        DEFAULT_DATA_TABLE_DIALOG_WIDTH,
        boundsWidth - DATA_TABLE_DIALOG_MARGIN * 2,
      ),
      height: Math.max(
        DEFAULT_DATA_TABLE_DIALOG_HEIGHT,
        boundsHeight - DATA_TABLE_DIALOG_MARGIN * 2,
      ),
      initialized: true,
    },
    boundsWidth,
    boundsHeight,
  );

  return {
    ...clampedLayout,
    x: Math.max(
      DATA_TABLE_DIALOG_MARGIN,
      Math.round((boundsWidth - clampedLayout.width) / 2),
    ),
    y: Math.max(
      DATA_TABLE_DIALOG_MARGIN,
      Math.round((boundsHeight - clampedLayout.height) / 2),
    ),
  } satisfies DataTableDialogLayout;
}

function hasSameDataTableDialogLayout(
  left: DataTableDialogLayout,
  right: DataTableDialogLayout,
) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.initialized === right.initialized
  );
}

function DrawerResizeHandle({
  dragLabel,
  toggleLabel,
  side,
  collapsed = false,
  onPointerDown,
  onToggle,
}: {
  dragLabel: string;
  toggleLabel: string;
  side: DrawerSide;
  collapsed?: boolean;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onToggle: () => void;
}) {
  return (
    <div className="group relative z-10 hidden h-full w-[18px] shrink-0 lg:block">
      <div
        aria-hidden="true"
        onPointerDown={collapsed ? undefined : onPointerDown}
        title={collapsed ? undefined : dragLabel}
        className={`absolute inset-0 touch-none border-x border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/85 transition group-hover:bg-[color:var(--surface-soft)] ${
          collapsed ? "" : "cursor-col-resize"
        }`}
      >
        <span className="absolute inset-y-1/2 left-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--viewer-border)] transition group-hover:bg-[color:var(--accent)]" />
      </div>
      <button
        type="button"
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={onToggle}
        className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] text-xs font-semibold text-[color:var(--foreground)] shadow-sm transition hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
      >
        {handleToggleGlyph(side, collapsed)}
      </button>
    </div>
  );
}

export function ViewerShell() {
  const { config } = useViewerRules();
  const viewportRef = useRef<ViewerViewportHandle | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dataTableDialogRef = useRef<HTMLDivElement | null>(null);
  const validationWorkerRef = useRef<Worker | null>(null);
  const validationAbortControllerRef = useRef<AbortController | null>(null);
  const validationRunIdRef = useRef(0);
  const dataTableDialogLayoutRef = useRef<DataTableDialogLayout>({
    x: DATA_TABLE_DIALOG_MARGIN,
    y: DATA_TABLE_DIALOG_MARGIN,
    width: DEFAULT_DATA_TABLE_DIALOG_WIDTH,
    height: DEFAULT_DATA_TABLE_DIALOG_HEIGHT,
    initialized: false,
  });
  const pendingDataTableDialogLayoutRef = useRef<DataTableDialogLayout | null>(null);
  const pendingDataTableDialogPreviewKindRef = useRef<"move" | "resize" | null>(null);
  const dataTableDialogAnimationFrameRef = useRef<number | null>(null);

  const [status, setStatus] = useState(initialStatus);
  const [session, setSession] = useState(initialSession);
  const [metadata, setMetadata] = useState<ModelMetadata | null>(null);
  const [tree, setTree] = useState<ViewerTreeNode[]>([]);
  const [categories, setCategories] = useState<ViewerCategorySummary[]>([]);
  const [dataTableState, setDataTableState] = useState(initialDataTableState);
  const [selectionDetails, setSelectionDetails] = useState<ViewerSelectionDetails>({
    selection: null,
    inspection: null,
    loading: false,
  });
  const [validationState, setValidationState] = useState(initialValidationState);
  const [validationHighlights, setValidationHighlights] = useState<ViewerValidationHighlights>(
    emptyValidationHighlights,
  );
  const [showTree, setShowTree] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [showDataTable, setShowDataTable] = useState(true);
  const [treeDrawerWidth, setTreeDrawerWidth] = useState(DEFAULT_TREE_DRAWER_WIDTH);
  const [propertiesDrawerWidth, setPropertiesDrawerWidth] = useState(
    DEFAULT_PROPERTIES_DRAWER_WIDTH,
  );
  const [dataTableDialogLayout, setDataTableDialogLayout] = useState<DataTableDialogLayout>({
    x: DATA_TABLE_DIALOG_MARGIN,
    y: DATA_TABLE_DIALOG_MARGIN,
    width: DEFAULT_DATA_TABLE_DIALOG_WIDTH,
    height: DEFAULT_DATA_TABLE_DIALOG_HEIGHT,
    initialized: false,
  });
  const [drawerDragState, setDrawerDragState] = useState<DrawerDragState | null>(null);
  const [dataTableDialogMoveState, setDataTableDialogMoveState] =
    useState<DataTableDialogMoveState | null>(null);
  const [dataTableDialogResizeState, setDataTableDialogResizeState] =
    useState<DataTableDialogResizeState | null>(null);

  const hasModel = Boolean(metadata && status.phase === "loaded");
  const deferredRules = useDeferredValue(config.rules);
  const compiledValidationRules = useMemo(
    () => compileViewerValidationRules(deferredRules),
    [deferredRules],
  );
  const runnableRuleCount = useMemo(
    () =>
      [...compiledValidationRules.values()].reduce(
        (count, rulesForType) => count + rulesForType.size,
        0,
      ),
    [compiledValidationRules],
  );
  const validatedSelectionDetails = useMemo<ViewerSelectionDetails>(
    () => ({
      ...selectionDetails,
      inspection: applyViewerValidationToInspection(selectionDetails.inspection, deferredRules),
    }),
    [deferredRules, selectionDetails],
  );
  const validationPayload = useMemo<ViewerValidationRunPayload | null>(() => {
    if (
      !metadata ||
      status.phase !== "loaded" ||
      !dataTableState.data ||
      deferredRules.length === 0 ||
      runnableRuleCount === 0
    ) {
      return null;
    }

    return {
      version: VIEWER_VALIDATION_CONFIG_VERSION,
      sourceId: metadata.sourceId ?? metadata.name,
      rules: deferredRules,
      rows: buildViewerValidationRows(dataTableState.data, deferredRules),
    };
  }, [dataTableState.data, deferredRules, metadata, runnableRuleCount, status.phase]);

  const stopValidationWorker = useCallback(() => {
    validationWorkerRef.current?.terminate();
    validationWorkerRef.current = null;
  }, []);

  const stopValidationRequest = useCallback(() => {
    validationAbortControllerRef.current?.abort();
    validationAbortControllerRef.current = null;
  }, []);

  const applyCommittedDataTableDialogLayout = useCallback((layout: DataTableDialogLayout) => {
    const dialog = dataTableDialogRef.current;
    if (!dialog) {
      return;
    }

    dialog.style.left = `${layout.x}px`;
    dialog.style.top = `${layout.y}px`;
    dialog.style.width = `${layout.width}px`;
    dialog.style.height = `${layout.height}px`;
    dialog.style.transform = "translate3d(0, 0, 0)";
  }, []);

  const applyPreviewDataTableDialogLayout = useCallback(
    (layout: DataTableDialogLayout, kind: "move" | "resize") => {
      const dialog = dataTableDialogRef.current;
      if (!dialog) {
        return;
      }

      if (kind === "move") {
        const committedLayout = dataTableDialogLayoutRef.current;
        dialog.style.left = `${committedLayout.x}px`;
        dialog.style.top = `${committedLayout.y}px`;
        dialog.style.width = `${committedLayout.width}px`;
        dialog.style.height = `${committedLayout.height}px`;
        dialog.style.transform = `translate3d(${layout.x - committedLayout.x}px, ${layout.y - committedLayout.y}px, 0)`;
        return;
      }

      dialog.style.left = `${layout.x}px`;
      dialog.style.top = `${layout.y}px`;
      dialog.style.width = `${layout.width}px`;
      dialog.style.height = `${layout.height}px`;
      dialog.style.transform = "translate3d(0, 0, 0)";
    },
    [],
  );

  const flushPendingDataTableDialogPreview = useCallback(() => {
    dataTableDialogAnimationFrameRef.current = null;

    const pendingLayout = pendingDataTableDialogLayoutRef.current;
    const pendingKind = pendingDataTableDialogPreviewKindRef.current;
    if (!pendingLayout || !pendingKind) {
      return;
    }

    applyPreviewDataTableDialogLayout(pendingLayout, pendingKind);
  }, [applyPreviewDataTableDialogLayout]);

  const scheduleDataTableDialogPreview = useCallback(
    (layout: DataTableDialogLayout, kind: "move" | "resize") => {
      pendingDataTableDialogLayoutRef.current = layout;
      pendingDataTableDialogPreviewKindRef.current = kind;

      if (dataTableDialogAnimationFrameRef.current !== null) {
        return;
      }

      dataTableDialogAnimationFrameRef.current = window.requestAnimationFrame(
        flushPendingDataTableDialogPreview,
      );
    },
    [flushPendingDataTableDialogPreview],
  );

  const stopPendingDataTableDialogPreview = useCallback(() => {
    if (dataTableDialogAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dataTableDialogAnimationFrameRef.current);
      dataTableDialogAnimationFrameRef.current = null;
    }
  }, []);

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
    const handleCount = 2;
    const availableWidth =
      workspaceWidth - otherDrawerWidth - handleCount * DRAWER_HANDLE_WIDTH - MIN_VIEWPORT_WIDTH;
    const maxWidth = Math.min(
      MAX_DRAWER_WIDTH,
      Math.max(MIN_CONSTRAINED_DRAWER_WIDTH, availableWidth),
    );
    const minWidth = Math.min(MIN_DRAWER_WIDTH, maxWidth);

    return clamp(nextWidth, minWidth, maxWidth);
  }, [propertiesDrawerWidth, showProperties, showTree, treeDrawerWidth]);

  const clampDataTableDialogLayout = useCallback((nextLayout: DataTableDialogLayout) => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return nextLayout;
    }

    return clampDataTableDialogLayoutToBounds(
      nextLayout,
      workspace.clientWidth,
      workspace.clientHeight,
    );
  }, []);

  const syncWorkspaceLayout = useCallback(() => {
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

  const stopDataTableDialogMove = useCallback(() => {
    stopPendingDataTableDialogPreview();
    setDataTableDialogMoveState(null);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    setDataTableDialogLayout((current) => {
      const pendingLayout = pendingDataTableDialogLayoutRef.current;
      pendingDataTableDialogLayoutRef.current = null;
      pendingDataTableDialogPreviewKindRef.current = null;
      return pendingLayout ?? current;
    });
  }, [stopPendingDataTableDialogPreview]);

  const stopDataTableDialogResize = useCallback(() => {
    stopPendingDataTableDialogPreview();
    setDataTableDialogResizeState(null);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    setDataTableDialogLayout((current) => {
      const pendingLayout = pendingDataTableDialogLayoutRef.current;
      pendingDataTableDialogLayoutRef.current = null;
      pendingDataTableDialogPreviewKindRef.current = null;
      return pendingLayout ?? current;
    });
  }, [stopPendingDataTableDialogPreview]);

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

  const updateDraggedDataTableDialogPosition = useCallback((clientX: number, clientY: number) => {
    if (!dataTableDialogMoveState) {
      return;
    }

    const deltaX = clientX - dataTableDialogMoveState.startX;
    const deltaY = clientY - dataTableDialogMoveState.startY;
    scheduleDataTableDialogPreview(
      clampDataTableDialogLayout({
        ...dataTableDialogMoveState.startLayout,
        x: dataTableDialogMoveState.startLayout.x + deltaX,
        y: dataTableDialogMoveState.startLayout.y + deltaY,
        initialized: true,
      }),
      "move",
    );
  }, [clampDataTableDialogLayout, dataTableDialogMoveState, scheduleDataTableDialogPreview]);

  const updateDraggedDataTableDialogSize = useCallback((clientX: number, clientY: number) => {
    if (!dataTableDialogResizeState) {
      return;
    }

    const deltaX = clientX - dataTableDialogResizeState.startX;
    const deltaY = clientY - dataTableDialogResizeState.startY;
    scheduleDataTableDialogPreview(
      clampDataTableDialogLayout({
        ...dataTableDialogResizeState.startLayout,
        width: dataTableDialogResizeState.startLayout.width + deltaX,
        height: dataTableDialogResizeState.startLayout.height + deltaY,
        initialized: true,
      }),
      "resize",
    );
  }, [clampDataTableDialogLayout, dataTableDialogResizeState, scheduleDataTableDialogPreview]);

  useEffect(() => {
    syncWorkspaceLayout();
  }, [showTree, showProperties, syncWorkspaceLayout]);

  useEffect(() => {
    const handleResize = () => {
      syncWorkspaceLayout();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [syncWorkspaceLayout]);

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

  useEffect(() => {
    if (!showDataTable) {
      stopDataTableDialogMove();
      stopDataTableDialogResize();
      return;
    }

    setDataTableDialogLayout((current) => {
      const next = current.initialized
        ? clampDataTableDialogLayout(current)
        : buildDefaultDataTableDialogLayout(
            workspaceRef.current?.clientWidth ?? 0,
            workspaceRef.current?.clientHeight ?? 0,
          );

      return hasSameDataTableDialogLayout(current, next) ? current : next;
    });
  }, [
    clampDataTableDialogLayout,
    showDataTable,
    stopDataTableDialogMove,
    stopDataTableDialogResize,
  ]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      setDataTableDialogLayout((current) => {
        if (!current.initialized) {
          return current;
        }

        const next = clampDataTableDialogLayout(current);
        return hasSameDataTableDialogLayout(current, next) ? current : next;
      });
    });

    observer.observe(workspace);

    return () => {
      observer.disconnect();
    };
  }, [clampDataTableDialogLayout]);

  useEffect(() => {
    dataTableDialogLayoutRef.current = dataTableDialogLayout;
    applyCommittedDataTableDialogLayout(dataTableDialogLayout);
  }, [applyCommittedDataTableDialogLayout, dataTableDialogLayout]);

  useEffect(() => {
    return () => {
      stopPendingDataTableDialogPreview();
    };
  }, [stopPendingDataTableDialogPreview]);

  useEffect(() => {
    if (!dataTableDialogMoveState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      updateDraggedDataTableDialogPosition(event.clientX, event.clientY);
    };
    const handlePointerUp = () => {
      stopDataTableDialogMove();
    };

    document.body.style.cursor = "move";
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
  }, [dataTableDialogMoveState, stopDataTableDialogMove, updateDraggedDataTableDialogPosition]);

  useEffect(() => {
    if (!dataTableDialogResizeState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      updateDraggedDataTableDialogSize(event.clientX, event.clientY);
    };
    const handlePointerUp = () => {
      stopDataTableDialogResize();
    };

    document.body.style.cursor = "nwse-resize";
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
  }, [
    dataTableDialogResizeState,
    stopDataTableDialogResize,
    updateDraggedDataTableDialogSize,
  ]);

  useEffect(() => {
    return () => {
      stopValidationWorker();
      stopValidationRequest();
    };
  }, [stopValidationRequest, stopValidationWorker]);

  useEffect(() => {
    stopValidationWorker();
    stopValidationRequest();

    if (!metadata || status.phase !== "loaded" || !dataTableState.data) {
      startTransition(() => {
        setValidationHighlights(emptyValidationHighlights);
        setValidationState({
          phase: "idle",
          mode: null,
          progress: 0,
          issueCount: 0,
          message:
            deferredRules.length === 0
              ? "No validation rules configured."
              : runnableRuleCount === 0
                ? "Complete at least one rule to start validation."
              : "Load and index a model to evaluate rules.",
        });
      });
      return;
    }

    if (!validationPayload) {
      startTransition(() => {
        setValidationHighlights(emptyValidationHighlights);
        setValidationState({
          phase: "idle",
          mode: null,
          progress: 0,
          issueCount: 0,
          message:
            deferredRules.length === 0
              ? "No validation rules configured."
              : "Complete at least one rule to start validation.",
        });
      });
      return;
    }

    if (validationPayload.rows.length === 0) {
      startTransition(() => {
        setValidationHighlights(emptyValidationHighlights);
        setValidationState({
          phase: "ready",
          mode: null,
          progress: 100,
          issueCount: 0,
          message: "No indexed elements match the current rule IFC types.",
        });
      });
      return;
    }

    const runToken = ++validationRunIdRef.current;
    const runId = String(runToken);
    let fallbackStarted = false;

    const commitSuccess = (mode: "worker" | "api", result: ViewerValidationRunResult) => {
      if (validationRunIdRef.current !== runToken) {
        return;
      }

      startTransition(() => {
        setValidationHighlights(groupViewerValidationResultsBySeverity(result.results));
        setValidationState({
          phase: "ready",
          mode,
          progress: 100,
          issueCount: result.results.length,
          message:
            result.results.length === 0
              ? `Validated ${validationPayload.rows.length} elements with no issues.`
              : `Validated ${validationPayload.rows.length} elements. ${result.results.length} flagged.`,
        });
      });
    };

    const commitError = (mode: "worker" | "api" | null, message: string) => {
      if (validationRunIdRef.current !== runToken) {
        return;
      }

      startTransition(() => {
        setValidationState((current) => ({
          phase: "error",
          mode,
          progress: current.progress,
          issueCount: current.issueCount,
          message,
        }));
      });
    };

    const fallbackToApi = async () => {
      if (fallbackStarted || validationRunIdRef.current !== runToken) {
        return;
      }

      fallbackStarted = true;
      stopValidationWorker();

      const controller = new AbortController();
      validationAbortControllerRef.current = controller;

      startTransition(() => {
        setValidationState({
          phase: "running",
          mode: "api",
          progress: 0,
          issueCount: 0,
          message: `Validating ${validationPayload.rows.length} elements via API fallback...`,
        });
      });

      try {
        const response = await fetch("/api/rules/evaluate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(validationPayload),
          signal: controller.signal,
        });

        const body = (await response.json()) as ViewerValidationRunResult & { error?: string };
        if (!response.ok) {
          throw new Error(body.error ?? "Validation API request failed.");
        }

        commitSuccess("api", body);
      } catch (error) {
        if (controller.signal.aborted || validationRunIdRef.current !== runToken) {
          return;
        }

        commitError(
          "api",
          error instanceof Error ? error.message : "Validation API request failed.",
        );
      } finally {
        if (validationAbortControllerRef.current === controller) {
          validationAbortControllerRef.current = null;
        }
      }
    };

    startTransition(() => {
      setValidationState({
        phase: "running",
        mode: "worker",
        progress: 0,
        issueCount: 0,
        message: `Validating ${validationPayload.rows.length} elements in a worker...`,
      });
    });

    try {
      const worker = new Worker(validationWorkerUrl, { type: "module" });
      validationWorkerRef.current = worker;

      worker.onmessage = (event: MessageEvent<ViewerValidationWorkerMessage>) => {
        const message = event.data;

        if (validationRunIdRef.current !== runToken || message.runId !== runId) {
          return;
        }

        if (message.type === "progress") {
          const progress =
            message.totalRowCount === 0
              ? 100
              : Math.floor((message.processedRowCount / message.totalRowCount) * 100);

          startTransition(() => {
            setValidationState({
              phase: "running",
              mode: "worker",
              progress,
              issueCount: 0,
              message: `Validating ${message.totalRowCount} elements in a worker... ${progress}%`,
            });
          });
          return;
        }

        if (message.type === "result") {
          stopValidationWorker();
          commitSuccess("worker", message.result);
          return;
        }

        void fallbackToApi();
      };

      worker.onerror = (event) => {
        event.preventDefault();
        void fallbackToApi();
      };

      worker.postMessage({
        type: "run",
        runId,
        payload: validationPayload,
      });
    } catch {
      void fallbackToApi();
    }

    return () => {
      stopValidationWorker();
      stopValidationRequest();
    };
  }, [
    dataTableState.data,
    deferredRules.length,
    metadata,
    runnableRuleCount,
    status.phase,
    stopValidationRequest,
    stopValidationWorker,
    validationPayload,
  ]);

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

  const startDrawerResize = (side: DrawerSide) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    setDrawerDragState({
      side,
      startX: event.clientX,
      startWidth: side === "left" ? treeDrawerWidth : propertiesDrawerWidth,
    });
  };

  const startDataTableDialogMove = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    setDataTableDialogResizeState(null);
    setDataTableDialogMoveState({
      startX: event.clientX,
      startY: event.clientY,
      startLayout: dataTableDialogLayout,
    });
  };

  const startDataTableDialogResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDataTableDialogMoveState(null);
    setDataTableDialogResizeState({
      startX: event.clientX,
      startY: event.clientY,
      startLayout: dataTableDialogLayout,
    });
  };

  const resetDataTableDialogLayout = () => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    setDataTableDialogLayout(
      buildDefaultDataTableDialogLayout(workspace.clientWidth, workspace.clientHeight),
    );
  };

  const handleDataTableRowSelect = useCallback((localId: number) => {
    void viewportRef.current?.selectNode(localId);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="w-full border-b border-[color:var(--viewer-border)] bg-[linear-gradient(135deg,rgba(243,236,224,0.98),rgba(230,221,206,0.92))] shadow-[var(--viewer-shadow)]">
        <div className="flex w-full flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-ink)]">
                    BCA IFC Viewer
                  </div>
                  <h1 className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--foreground)] sm:text-xl">
                    Local IFC review workspace
                  </h1>
                </div>
                <div className="inline-flex min-w-0 items-center gap-2 rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/80 px-3 py-1.5 text-xs text-[color:var(--muted-ink)]">
                  <StatusDot phase={status.phase} />
                  <span className="max-w-[min(26rem,70vw)] truncate">{status.message}</span>
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
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--accent)] px-4 text-sm font-semibold text-[color:var(--accent-ink)] transition hover:brightness-95"
              >
                <UploadIcon className="h-4 w-4" />
                <span>Open IFC</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleLoadBundledModel();
                }}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
              >
                <CubeIcon className="h-4 w-4" />
                <span>Test model</span>
              </button>
              <Link
                href="/rules"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
              >
                <span>Rules</span>
              </Link>
              <div className="flex items-center gap-2 rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/72 p-1.5">
                <HeaderActionButton
                  label={showTree ? "Hide model tree" : "Show model tree"}
                  active={showTree}
                  onClick={() => setShowTree((value) => !value)}
                >
                  <PanelLeftIcon className="h-4 w-4" />
                </HeaderActionButton>
                <HeaderActionButton
                  label={showProperties ? "Hide properties" : "Show properties"}
                  active={showProperties}
                  onClick={() => setShowProperties((value) => !value)}
                >
                  <PanelRightIcon className="h-4 w-4" />
                </HeaderActionButton>
                <HeaderActionButton
                  label={showDataTable ? "Hide data table" : "Show data table"}
                  active={showDataTable}
                  onClick={() => setShowDataTable((value) => !value)}
                >
                  <TableIcon className="h-4 w-4" />
                </HeaderActionButton>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/72 px-3 py-1.5 text-[color:var(--muted-ink)]">
              <span className="font-semibold text-[color:var(--foreground)]">File:</span>{" "}
              <span className="max-w-[18rem] truncate align-bottom inline-block">
                {metadata?.name ?? "No file loaded"}
              </span>
            </div>
            <div className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/72 px-3 py-1.5 text-[color:var(--muted-ink)]">
              <span className="font-semibold text-[color:var(--foreground)]">Size:</span>{" "}
              {metadata ? formatBytes(metadata.size) : "—"}
            </div>
            <div className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/72 px-3 py-1.5 text-[color:var(--muted-ink)]">
              <span className="font-semibold capitalize text-[color:var(--foreground)]">
                {session.activeTool}
              </span>{" "}
              active
            </div>
            <div className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/72 px-3 py-1.5 text-[color:var(--muted-ink)]">
              <span className="font-semibold capitalize text-[color:var(--foreground)]">
                {status.phase}
              </span>{" "}
              status
            </div>
            <div className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/72 px-3 py-1.5 text-[color:var(--muted-ink)]">
              <span className="font-semibold text-[color:var(--foreground)]">Rules:</span>{" "}
              {config.rules.length}
            </div>
            <div
              className={`rounded-full border px-3 py-1.5 ${validationPhaseTone(validationState.phase)}`}
            >
              <span className="font-semibold">
                {validationState.phase === "running"
                  ? `Validation ${validationState.progress}%`
                  : validationState.phase === "ready"
                    ? validationState.issueCount === 0
                      ? "Validation clear"
                      : `Validation ${validationState.issueCount} flagged`
                    : validationState.phase === "error"
                      ? "Validation error"
                      : "Validation idle"}
              </span>
              {validationState.mode ? ` · ${validationState.mode}` : ""}
            </div>
            <div className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/72 px-3 py-1.5 text-[color:var(--muted-ink)]">
              <span className="max-w-[min(30rem,70vw)] truncate align-bottom inline-block">
                {validationState.message}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 w-full flex-1 flex-col">
        <main className="flex min-h-0 flex-1">
          <div
            ref={workspaceRef}
            className="relative -mt-px flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[2rem] border border-t-0 border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/60 shadow-[var(--viewer-shadow)]"
          >
            <div className="relative min-h-0 flex flex-1 overflow-hidden">
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
              ) : null}

              <DrawerResizeHandle
                dragLabel="Drag to resize model tree panel"
                toggleLabel={showTree ? "Hide model tree panel" : "Show model tree panel"}
                side="left"
                collapsed={!showTree}
                onPointerDown={showTree ? startDrawerResize("left") : undefined}
                onToggle={() => setShowTree((value) => !value)}
              />

              <section className="relative min-w-0 flex-1">
                <IfcViewport
                  ref={viewportRef}
                  embedded
                  status={status}
                  activeTool={session.activeTool}
                  validationHighlights={validationHighlights}
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
                      setSelectionDetails({ selection: null, inspection: null, loading: false });
                    });
                  }}
                  onDataTableChange={(nextDataTableState) => {
                    startTransition(() => {
                      setDataTableState(nextDataTableState);
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

              <DrawerResizeHandle
                dragLabel="Drag to resize properties panel"
                toggleLabel={showProperties ? "Hide properties panel" : "Show properties panel"}
                side="right"
                collapsed={!showProperties}
                onPointerDown={showProperties ? startDrawerResize("right") : undefined}
                onToggle={() => setShowProperties((value) => !value)}
              />

              {showProperties ? (
                <div
                  className="hidden min-h-0 shrink-0 lg:block"
                  style={{ width: `${propertiesDrawerWidth}px` }}
                >
                  <PropertiesPanel embedded details={validatedSelectionDetails} />
                </div>
              ) : null}

              {showProperties ? (
                <div className="absolute inset-y-0 right-0 z-40 w-[min(85vw,24rem)] max-w-full border-l border-[color:var(--viewer-border)] shadow-[var(--viewer-shadow)] lg:hidden">
                  <PropertiesPanel embedded details={validatedSelectionDetails} />
                </div>
              ) : null}
            </div>

            {showDataTable && dataTableDialogLayout.initialized ? (
              <div className="pointer-events-none absolute inset-0 z-50">
                <div
                  ref={dataTableDialogRef}
                  className="pointer-events-auto absolute flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/96 shadow-[var(--viewer-shadow)] backdrop-blur"
                  style={{
                    left: `${dataTableDialogLayout.x}px`,
                    top: `${dataTableDialogLayout.y}px`,
                    width: `${dataTableDialogLayout.width}px`,
                    height: `${dataTableDialogLayout.height}px`,
                    willChange:
                      dataTableDialogMoveState || dataTableDialogResizeState
                        ? "transform, width, height"
                        : undefined,
                  }}
                >
                  <div
                    onPointerDown={startDataTableDialogMove}
                    title="Drag to move data table window"
                    className="flex cursor-move items-start justify-between gap-3 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]/90 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                          Data table
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${dataTablePhaseTone(dataTableState.phase)}`}
                        >
                          {dataTableState.phase}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--muted-ink)]">
                        {metadata ? (
                          <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-2.5 py-1">
                            {metadata.name}
                          </span>
                        ) : null}
                        {metadata ? (
                          <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-2.5 py-1">
                            {formatBytes(metadata.size)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={resetDataTableDialogLayout}
                        className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => setShowDataTable(false)}
                        className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1">
                    <DataTablePanel
                      embedded
                      metadata={metadata}
                      tableState={dataTableState}
                      activeSelection={session.selected}
                      onSelectRow={handleDataTableRowSelect}
                      showMetaHeader={false}
                    />
                  </div>

                  <div
                    aria-hidden="true"
                    onPointerDown={startDataTableDialogResize}
                    title="Drag to resize data table window"
                    className="absolute bottom-2 right-2 z-10 h-5 w-5 cursor-se-resize touch-none rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/92"
                  >
                    <span className="absolute bottom-1 right-1 h-2.5 w-0.5 rotate-45 rounded-full bg-[color:var(--muted-ink)]" />
                    <span className="absolute bottom-1 right-2.5 h-1.5 w-0.5 rotate-45 rounded-full bg-[color:var(--muted-ink)]" />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
