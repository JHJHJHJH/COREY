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
import { DetachedWindow } from "@/features/viewer/components/detached-window";
import { ModelTreePanel } from "@/features/viewer/components/model-tree-panel";
import { IfcViewport } from "@/features/viewer/components/ifc-viewport";
import { PropertiesPanel } from "@/features/viewer/components/properties-panel";
import { ViewerToolbar } from "@/features/viewer/components/viewer-toolbar";
import {
  applyViewerDataTableDraft,
  clearPersistedViewerDataTableDraft,
  readPersistedViewerDataTableDraft,
  writePersistedViewerDataTableDraft,
} from "@/features/viewer/lib/data-table-draft";
import {
  buildViewerDataTableExcelFileName,
  buildViewerDataTableIfcFileName,
  exportViewerDataTableToExcel,
  importViewerDataTableFromExcel,
} from "@/features/viewer/lib/data-table-excel";
import { formatBytes } from "@/features/viewer/lib/ifc-data";
import { LocalFileModelSource } from "@/features/viewer/lib/model-source";
import { exportEditedIfc } from "@/features/viewer/lib/ifc-writeback";
import type {
  ModelMetadata,
  ModelSourceResult,
  ViewerCategorySummary,
  ViewerDataTableDraft,
  ViewerDataTableExportStatus,
  ViewerDataTableImportReport,
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
const DRAWER_HANDLE_WIDTH = 0;
const COLLAPSED_DRAWER_WIDTH = 44;
const DEFAULT_DATA_TABLE_DIALOG_WIDTH = 1120;
const DEFAULT_DATA_TABLE_DIALOG_HEIGHT = 560;
const MIN_DATA_TABLE_DIALOG_WIDTH = 420;
const MIN_DATA_TABLE_DIALOG_HEIGHT = 260;
const MAX_DATA_TABLE_DIALOG_WIDTH = Number.POSITIVE_INFINITY;
const MAX_DATA_TABLE_DIALOG_HEIGHT = Number.POSITIVE_INFINITY;
const DATA_TABLE_DIALOG_MARGIN = 12;

const validationWorkerUrl = new URL("../../rules/workers/validation-worker.ts", import.meta.url);
const source = new LocalFileModelSource();

const emptyValidationHighlights: ViewerValidationHighlights = {
  warn: {},
  error: {},
};

const initialDataTableActionStatus: ViewerDataTableExportStatus = {
  phase: "idle",
  message: "",
  issues: [],
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

function summarizeIfcTypes(ifcTypes: string[], max = 6) {
  if (ifcTypes.length === 0) {
    return "none";
  }

  const visible = ifcTypes.slice(0, max);
  const suffix = ifcTypes.length > max ? ` (+${ifcTypes.length - max} more)` : "";
  return `${visible.join(", ")}${suffix}`;
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

function PopOutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M14 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m10 14 9-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 14v4.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5H10" strokeLinecap="round" strokeLinejoin="round" />
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
  const Icon = side === "left" ? PanelLeftIcon : PanelRightIcon;
  const togglePositionClass = collapsed
    ? side === "left"
      ? "right-2"
      : "left-2"
    : side === "left"
      ? "right-3"
      : "left-3";

  return (
    <div className="group relative z-50 h-full w-0 shrink-0 overflow-visible">
      <div
        aria-hidden="true"
        onPointerDown={collapsed ? undefined : onPointerDown}
        title={collapsed ? undefined : dragLabel}
        className={`absolute left-1/2 top-0 hidden h-full w-3 -translate-x-1/2 touch-none transition lg:block ${
          collapsed ? "" : "cursor-col-resize"
        }`}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[color:var(--viewer-border)]/70 transition group-hover:bg-[color:var(--accent)]" />
      </div>
      <button
        type="button"
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={onToggle}
        className={`absolute top-3 flex h-9 w-9 items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] ${togglePositionClass} ${
          collapsed
            ? "text-[color:var(--foreground)] hover:text-[color:var(--accent)]"
            : "text-[color:var(--muted-ink)] hover:text-[color:var(--foreground)]"
        }`}
      >
        <Icon className="h-5 w-5" />
      </button>
    </div>
  );
}

type ViewerDrawerProps = {
  side: DrawerSide;
  open: boolean;
  width: number;
  drawerRef: React.RefObject<HTMLDivElement | null>;
  mobileZIndexClass: string;
  dragLabel: string;
  toggleLabel: string;
  isDragging: boolean;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onToggle: () => void;
  renderPanel: () => React.ReactNode;
};

function ViewerDrawer({
  side,
  open,
  width,
  drawerRef,
  mobileZIndexClass,
  dragLabel,
  toggleLabel,
  isDragging,
  onPointerDown,
  onToggle,
  renderPanel,
}: ViewerDrawerProps) {
  const desktopWidth = open ? width : COLLAPSED_DRAWER_WIDTH;
  const desktopMotionClass = open
    ? "translate-x-0 opacity-100"
    : side === "left"
      ? "-translate-x-4 opacity-0"
      : "translate-x-4 opacity-0";
  const mobileMotionClass = open
    ? "translate-x-0 opacity-100"
    : side === "left"
      ? "-translate-x-full opacity-0"
      : "translate-x-full opacity-0";
  const desktopDrawerSideClass = side === "left" ? "left-0 border-r" : "right-0 border-l";
  const mobileDrawerSideClass = side === "left" ? "left-0 border-r" : "right-0 border-l";
  const desktopTransitionClass = isDragging
    ? "duration-0"
    : "duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]";

  const desktopDrawer = (
    <div
      ref={drawerRef}
      className={`relative hidden min-h-0 shrink-0 overflow-visible transition-[width] ${desktopTransitionClass} lg:block`}
      style={{ width: `${desktopWidth}px` }}
    >
      <div
        className={`absolute inset-y-0 ${desktopDrawerSideClass} w-full overflow-hidden border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/92 transition-[background-color,opacity] duration-200 ${
          open ? "pointer-events-auto shadow-[var(--viewer-shadow)] opacity-100" : "pointer-events-none opacity-100"
        }`}
      >
        <div
          className={`h-full w-full transform-gpu transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${desktopMotionClass}`}
        >
          {renderPanel()}
        </div>
      </div>
    </div>
  );

  const mobileDrawer = (
    <div
      className={`absolute inset-y-0 ${mobileDrawerSideClass} ${mobileZIndexClass} w-[min(85vw,24rem)] max-w-full transform-gpu shadow-[var(--viewer-shadow)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:hidden ${
        open ? "pointer-events-auto" : "pointer-events-none"
      } ${mobileMotionClass}`}
    >
      {renderPanel()}
    </div>
  );

  const handle = (
    <DrawerResizeHandle
      dragLabel={dragLabel}
      toggleLabel={toggleLabel}
      side={side}
      collapsed={!open}
      onPointerDown={open ? onPointerDown : undefined}
      onToggle={onToggle}
    />
  );

  if (side === "left") {
    return (
      <>
        {mobileDrawer}
        {desktopDrawer}
        {handle}
      </>
    );
  }

  return (
    <>
      {handle}
      {desktopDrawer}
      {mobileDrawer}
    </>
  );
}

export function ViewerShell() {
  const { config } = useViewerRules();
  const viewportRef = useRef<ViewerViewportHandle | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dataTableImportInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const treeDrawerRef = useRef<HTMLDivElement | null>(null);
  const propertiesDrawerRef = useRef<HTMLDivElement | null>(null);
  const dataTableDialogRef = useRef<HTMLDivElement | null>(null);
  const activeSourceRef = useRef<ModelSourceResult | null>(null);
  const validationWorkerRef = useRef<Worker | null>(null);
  const validationAbortControllerRef = useRef<AbortController | null>(null);
  const validationRunIdRef = useRef(0);
  const drawerDragStateRef = useRef<DrawerDragState | null>(null);
  const pendingDrawerWidthRef = useRef<{ side: DrawerSide; width: number } | null>(null);
  const drawerAnimationFrameRef = useRef<number | null>(null);
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
  const [dataTableDraft, setDataTableDraft] = useState<ViewerDataTableDraft | null>(null);
  const [dataTableImportReport, setDataTableImportReport] =
    useState<ViewerDataTableImportReport | null>(null);
  const [dataTableActionStatus, setDataTableActionStatus] = useState<ViewerDataTableExportStatus>(
    initialDataTableActionStatus,
  );
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
  const [showDataTable, setShowDataTable] = useState(false);
  const [showDataTableInWindow, setShowDataTableInWindow] = useState(false);
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
  const isDataTableDetached = showDataTable && showDataTableInWindow;
  const activeDrawerResizeSide = drawerDragState?.side ?? null;
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
  const runnableRuleIfcTypes = useMemo(
    () =>
      [...compiledValidationRules.keys()].sort((left, right) =>
        left.localeCompare(right, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    [compiledValidationRules],
  );
  const effectiveDataTableData = useMemo(
    () =>
      dataTableState.data ? applyViewerDataTableDraft(dataTableState.data, dataTableDraft) : null,
    [dataTableDraft, dataTableState.data],
  );
  const effectiveDataTableState = useMemo(
    () => ({
      ...dataTableState,
      data: effectiveDataTableData,
    }),
    [dataTableState, effectiveDataTableData],
  );
  const indexedIfcTypes = useMemo(() => effectiveDataTableData?.ifcTypes ?? [], [effectiveDataTableData]);
  const draftEditCount = dataTableDraft?.edits.length ?? 0;
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
      !effectiveDataTableData ||
      deferredRules.length === 0 ||
      runnableRuleCount === 0
    ) {
      return null;
    }

    return {
      version: VIEWER_VALIDATION_CONFIG_VERSION,
      sourceId: metadata.sourceId ?? metadata.name,
      rules: deferredRules,
      rows: buildViewerValidationRows(effectiveDataTableData, deferredRules),
    };
  }, [deferredRules, effectiveDataTableData, metadata, runnableRuleCount, status.phase]);

  useEffect(() => {
    const sourceId = metadata?.sourceId;
    if (!sourceId || !dataTableState.data) {
      setDataTableDraft(null);
      return;
    }

    const persistedDraft = readPersistedViewerDataTableDraft(sourceId);
    setDataTableDraft(persistedDraft);
    setDataTableImportReport(null);
    setDataTableActionStatus(
      persistedDraft && persistedDraft.edits.length > 0
        ? {
            phase: "success",
            message: `Restored ${persistedDraft.edits.length} imported edits from local draft storage.`,
            issues: [],
          }
        : initialDataTableActionStatus,
    );
  }, [dataTableState.data, metadata?.sourceId]);

  useEffect(() => {
    const sourceId = metadata?.sourceId;
    if (!sourceId) {
      return;
    }

    if (dataTableDraft) {
      const persisted = writePersistedViewerDataTableDraft(dataTableDraft);
      if (!persisted.ok) {
        setDataTableActionStatus((current) => ({
          phase: current.phase === "error" ? current.phase : "success",
          message: `${current.message || `Imported ${dataTableDraft.edits.length} edits.`} Local draft restore is unavailable: ${persisted.message}`,
          issues: current.issues,
        }));
      }
      return;
    }

    clearPersistedViewerDataTableDraft(sourceId);
  }, [dataTableDraft, metadata?.sourceId]);

  const stopValidationWorker = useCallback(() => {
    validationWorkerRef.current?.terminate();
    validationWorkerRef.current = null;
  }, []);

  const stopValidationRequest = useCallback(() => {
    validationAbortControllerRef.current?.abort();
    validationAbortControllerRef.current = null;
  }, []);

  const applyDrawerWidth = useCallback((side: DrawerSide, width: number) => {
    const drawer = side === "left" ? treeDrawerRef.current : propertiesDrawerRef.current;
    if (!drawer) {
      return;
    }

    drawer.style.width = `${width}px`;
  }, []);

  const flushPendingDrawerPreview = useCallback(() => {
    drawerAnimationFrameRef.current = null;

    const pendingWidth = pendingDrawerWidthRef.current;
    if (!pendingWidth) {
      return;
    }

    applyDrawerWidth(pendingWidth.side, pendingWidth.width);
  }, [applyDrawerWidth]);

  const scheduleDrawerPreview = useCallback(
    (side: DrawerSide, width: number) => {
      pendingDrawerWidthRef.current = { side, width };

      if (drawerAnimationFrameRef.current !== null) {
        return;
      }

      drawerAnimationFrameRef.current = window.requestAnimationFrame(flushPendingDrawerPreview);
    },
    [flushPendingDrawerPreview],
  );

  const stopPendingDrawerPreview = useCallback(() => {
    if (drawerAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(drawerAnimationFrameRef.current);
      drawerAnimationFrameRef.current = null;
    }
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
          : COLLAPSED_DRAWER_WIDTH
        : showTree
          ? treeDrawerWidth
          : COLLAPSED_DRAWER_WIDTH;
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
    stopPendingDrawerPreview();
    drawerDragStateRef.current = null;
    setDrawerDragState(null);

    const pendingWidth = pendingDrawerWidthRef.current;
    pendingDrawerWidthRef.current = null;
    if (pendingWidth) {
      applyDrawerWidth(pendingWidth.side, pendingWidth.width);
      if (pendingWidth.side === "left") {
        setTreeDrawerWidth(pendingWidth.width);
      } else {
        setPropertiesDrawerWidth(pendingWidth.width);
      }
    }

    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, [applyDrawerWidth, stopPendingDrawerPreview]);

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
    const dragState = drawerDragStateRef.current;
    if (!dragState) {
      return;
    }

    const delta = clientX - dragState.startX;
    const nextWidth =
      dragState.side === "left"
        ? clampDrawerWidth("left", dragState.startWidth + delta)
        : clampDrawerWidth("right", dragState.startWidth - delta);

    scheduleDrawerPreview(dragState.side, nextWidth);
  }, [clampDrawerWidth, scheduleDrawerPreview]);

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
    if (!showDataTable) {
      setShowDataTableInWindow(false);
    }
  }, [showDataTable]);

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
    applyDrawerWidth("left", treeDrawerWidth);
  }, [applyDrawerWidth, treeDrawerWidth]);

  useEffect(() => {
    applyDrawerWidth("right", propertiesDrawerWidth);
  }, [applyDrawerWidth, propertiesDrawerWidth]);

  useEffect(() => {
    return () => {
      stopPendingDrawerPreview();
    };
  }, [stopPendingDrawerPreview]);

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

    if (!metadata || status.phase !== "loaded" || !effectiveDataTableData) {
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
          message: `No indexed elements match the current rule IFC types. Rules: ${summarizeIfcTypes(
            runnableRuleIfcTypes,
          )}. Indexed: ${summarizeIfcTypes(indexedIfcTypes)}.`,
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
    effectiveDataTableData,
    deferredRules.length,
    metadata,
    runnableRuleCount,
    runnableRuleIfcTypes,
    status.phase,
    stopValidationRequest,
    stopValidationWorker,
    validationPayload,
    indexedIfcTypes,
  ]);

  const openFilePicker = () => {
    inputRef.current?.click();
  };

  const openDataTableImportPicker = () => {
    dataTableImportInputRef.current?.click();
  };

  const loadModelFromFile = useCallback(async (file: File) => {
    const sourceResult = await source.read(file);
    activeSourceRef.current = sourceResult;
    startTransition(() => {
      setDataTableDraft(null);
      setDataTableImportReport(null);
      setDataTableActionStatus(initialDataTableActionStatus);
    });
    await viewportRef.current?.loadIfc(sourceResult);
  }, []);

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

      await loadModelFromFile(file);
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

    await loadModelFromFile(file);
    event.target.value = "";
  };

  const handleDataTableImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!metadata?.sourceId || !dataTableState.data || !effectiveDataTableData) {
      startTransition(() => {
        setDataTableActionStatus({
          phase: "error",
          message: "Load and index a model before importing Excel edits.",
          issues: [],
        });
      });
      event.target.value = "";
      return;
    }

    startTransition(() => {
      setDataTableActionStatus({
        phase: "running",
        message: `Importing ${file.name}...`,
        issues: [],
      });
    });

    try {
      const result = await importViewerDataTableFromExcel({
        file,
        sourceId: metadata.sourceId,
        baseData: dataTableState.data,
        currentData: effectiveDataTableData,
      });

      startTransition(() => {
        setDataTableDraft(result.draft);
        setDataTableImportReport(result.report);
        setDataTableActionStatus({
          phase: "success",
          message:
            result.report.skippedCellCount > 0
              ? `Imported ${result.report.appliedEditCount} edits and skipped ${result.report.skippedCellCount} cells.`
              : `Imported ${result.report.appliedEditCount} edits from ${file.name}.`,
          issues: result.report.issues,
        });
      });
    } catch (error) {
      startTransition(() => {
        setDataTableActionStatus({
          phase: "error",
          message: error instanceof Error ? error.message : "Excel import failed.",
          issues: [],
        });
      });
    } finally {
      event.target.value = "";
    }
  };

  const handleExportExcel = useCallback(async () => {
    if (!metadata?.sourceId || !effectiveDataTableData) {
      setDataTableActionStatus({
        phase: "error",
        message: "Load and index a model before exporting Excel.",
        issues: [],
      });
      return;
    }

    setDataTableActionStatus({
      phase: "running",
      message: "Preparing Excel export...",
      issues: [],
    });

    try {
      await exportViewerDataTableToExcel({
        data: effectiveDataTableData,
        sourceId: metadata.sourceId,
        fileName: buildViewerDataTableExcelFileName(metadata.name),
      });
      setDataTableActionStatus({
        phase: "success",
        message: `Exported ${effectiveDataTableData.rows.length} rows to Excel.`,
        issues: [],
      });
    } catch (error) {
      setDataTableActionStatus({
        phase: "error",
        message: error instanceof Error ? error.message : "Excel export failed.",
        issues: [],
      });
    }
  }, [effectiveDataTableData, metadata]);

  const handleClearImportedEdits = useCallback(() => {
    const sourceId = metadata?.sourceId;
    setDataTableDraft(null);
    setDataTableImportReport(null);
    if (sourceId) {
      clearPersistedViewerDataTableDraft(sourceId);
    }
    setDataTableActionStatus({
      phase: "success",
      message: "Cleared imported data-table edits.",
      issues: [],
    });
  }, [metadata?.sourceId]);

  const handleExportEditedIfc = useCallback(async () => {
    if (!dataTableState.data || !metadata || !activeSourceRef.current) {
      setDataTableActionStatus({
        phase: "error",
        message: "Load a model before exporting an edited IFC.",
        issues: [],
      });
      return;
    }

    setDataTableActionStatus({
      phase: "running",
      message: "Preparing edited IFC export...",
      issues: [],
    });

    const result = await exportEditedIfc({
      baseData: dataTableState.data,
      draft: dataTableDraft,
      bytes: activeSourceRef.current.bytes,
      fileName: buildViewerDataTableIfcFileName(metadata.name),
    });
    setDataTableActionStatus(result);
  }, [dataTableDraft, dataTableState.data, metadata]);

  const startDrawerResize = (side: DrawerSide) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    event.currentTarget.setPointerCapture(event.pointerId);

    const nextDragState = {
      side,
      startX: event.clientX,
      startWidth: side === "left" ? treeDrawerWidth : propertiesDrawerWidth,
    } satisfies DrawerDragState;

    drawerDragStateRef.current = nextDragState;
    pendingDrawerWidthRef.current = { side, width: nextDragState.startWidth };
    applyDrawerWidth(side, nextDragState.startWidth);
    setDrawerDragState(nextDragState);
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

  const showDataTableDialog = useCallback(() => {
    setShowDataTable(true);
    setShowDataTableInWindow(false);
  }, []);

  const showDataTableWindow = useCallback(() => {
    setShowDataTable(true);
    setShowDataTableInWindow(true);
  }, []);

  const hideDataTable = useCallback(() => {
    setShowDataTable(false);
    setShowDataTableInWindow(false);
  }, []);

  const dataTableHeader = (
    <div className="flex items-start justify-between gap-3 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]/90 px-4 py-2.5">
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
          {isDataTableDetached ? (
            <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
              Detached window
            </span>
          ) : null}
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
          {draftEditCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-[#edf7f1] px-2.5 py-1 text-[#1e6b45]">
              {draftEditCount} imported edits
            </span>
          ) : null}
        </div>
        {dataTableActionStatus.message ? (
          <div className="mt-2 max-w-3xl text-xs text-[color:var(--muted-ink)]">
            {dataTableActionStatus.message}
          </div>
        ) : null}
        {dataTableImportReport?.issues.length ? (
          <div className="mt-1 max-w-3xl text-xs text-[#8a3e1f]">
            {dataTableImportReport.issues[0]?.message}
            {dataTableImportReport.issues.length > 1
              ? ` (+${dataTableImportReport.issues.length - 1} more)`
              : ""}
          </div>
        ) : null}
      </div>

      <div
        className="flex flex-wrap items-center justify-end gap-2"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => {
            void handleExportExcel();
          }}
          disabled={!effectiveDataTableData || dataTableActionStatus.phase === "running"}
          className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export Excel
        </button>
        <button
          type="button"
          onClick={openDataTableImportPicker}
          disabled={!effectiveDataTableData || dataTableActionStatus.phase === "running"}
          className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Import Excel
        </button>
        <button
          type="button"
          onClick={handleClearImportedEdits}
          disabled={draftEditCount === 0 || dataTableActionStatus.phase === "running"}
          className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear Edits
        </button>
        <button
          type="button"
          onClick={() => {
            void handleExportEditedIfc();
          }}
          disabled={draftEditCount === 0 || dataTableActionStatus.phase === "running"}
          className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export IFC
        </button>
        <button
          type="button"
          onClick={isDataTableDetached ? showDataTableDialog : showDataTableWindow}
          className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
        >
          <PopOutIcon className="h-3.5 w-3.5" />
          <span>{isDataTableDetached ? "Dock" : "Pop Out"}</span>
        </button>
        {!isDataTableDetached ? (
          <button
            type="button"
            onClick={resetDataTableDialogLayout}
            className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
          >
            Reset
          </button>
        ) : null}
        <button
          type="button"
          onClick={hideDataTable}
          className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
        >
          Close
        </button>
      </div>
    </div>
  );

  const dataTablePanelContent = (
    <div className="min-h-0 flex-1">
      <DataTablePanel
        embedded
        metadata={metadata}
        tableState={effectiveDataTableState}
        activeSelection={session.selected}
        onSelectRow={handleDataTableRowSelect}
        showMetaHeader={false}
      />
    </div>
  );

  const dataTableSurface = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {dataTableHeader}
      {dataTablePanelContent}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="w-full border-b border-[color:var(--viewer-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(234,242,255,0.94))] shadow-[var(--viewer-shadow)]">
        <div className="flex w-full flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <h1 className="mt-1 text-lg font-extrabold tracking-tight text-[#4f7dc8] text-shadow-sm sm:text-xl">
                    COREY
                  </h1>
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
              <input
                ref={dataTableImportInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleDataTableImport}
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
                <HeaderActionButton
                  label={isDataTableDetached ? "Dock data table" : "Open data table in a new window"}
                  active={showDataTable}
                  onClick={() => {
                    if (showDataTable) {
                      hideDataTable();
                    } else {
                      showDataTableWindow();
                    }
                  }}
                >
                  <PopOutIcon className="h-4 w-4" />
                </HeaderActionButton>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/72 px-3 py-1.5 text-[color:var(--muted-ink)]">
              <span className="inline-flex items-center gap-2">
                <StatusDot phase={metadata ? "loaded" : "idle"} />
              </span>{" "}
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
              <ViewerDrawer
                side="left"
                open={showTree}
                width={treeDrawerWidth}
                drawerRef={treeDrawerRef}
                mobileZIndexClass="z-30"
                dragLabel="Drag to resize model tree panel"
                toggleLabel={showTree ? "Hide model tree panel" : "Show model tree panel"}
                isDragging={activeDrawerResizeSide === "left"}
                onPointerDown={startDrawerResize("left")}
                onToggle={() => setShowTree((value) => !value)}
                renderPanel={() => (
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
                )}
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

              <ViewerDrawer
                side="right"
                open={showProperties}
                width={propertiesDrawerWidth}
                drawerRef={propertiesDrawerRef}
                mobileZIndexClass="z-40"
                dragLabel="Drag to resize properties panel"
                toggleLabel={showProperties ? "Hide properties panel" : "Show properties panel"}
                isDragging={activeDrawerResizeSide === "right"}
                onPointerDown={startDrawerResize("right")}
                onToggle={() => setShowProperties((value) => !value)}
                renderPanel={() => (
                  <PropertiesPanel embedded details={validatedSelectionDetails} />
                )}
              />
            </div>

            {showDataTable && !isDataTableDetached && dataTableDialogLayout.initialized ? (
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
                    className="cursor-move"
                  >
                    {dataTableHeader}
                  </div>

                  {dataTablePanelContent}

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
            {isDataTableDetached ? (
              <DetachedWindow
                title={`Data Table${metadata ? ` · ${metadata.name}` : ""}`}
                name="corey-data-table"
                width={Math.max(dataTableDialogLayout.width, DEFAULT_DATA_TABLE_DIALOG_WIDTH)}
                height={Math.max(dataTableDialogLayout.height, DEFAULT_DATA_TABLE_DIALOG_HEIGHT)}
                onClose={hideDataTable}
                onOpenBlocked={showDataTableDialog}
              >
                <div className="flex h-screen min-h-0 flex-col bg-[color:var(--panel-bg)] text-[color:var(--foreground)]">
                  {dataTableSurface}
                </div>
              </DetachedWindow>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
