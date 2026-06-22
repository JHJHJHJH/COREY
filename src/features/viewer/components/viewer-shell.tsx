"use client";

import {
  BookOpenText,
  ChevronDown,
  ClipboardCheck,
  FileOutput,
  FileSpreadsheet,
  FolderOpen,
  Import,
  Moon,
  PanelLeftOpen,
  PanelRightOpen,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  applyViewerValidationToInspection,
  buildViewerValidationRows,
  compileViewerValidationRules,
  groupViewerValidationResultsBySeverity,
  VIEWER_VALIDATION_CONFIG_VERSION,
} from "@/features/rules/lib/validation";
import { evaluateViewerValidationViaApi } from "@/features/rules/lib/validation-api";
import { useViewerRules } from "@/features/rules/rules-provider";
import { RulesModal } from "@/features/rules/components/rules-modal";
import { StatusBar, type StatusSegment, type StatusTone } from "@/components/status-bar/status-bar";
import { InspectorDetailList, JsonInspectorTabs } from "@/components/status-bar/status-inspector";
import { DataTablePanel } from "@/features/viewer/components/data-table-panel";
import { DetachedWindow } from "@/features/viewer/components/detached-window";
import { ModelTreePanel } from "@/features/viewer/components/model-tree-panel";
import { IfcViewport } from "@/features/viewer/components/ifc-viewport";
import { PropertiesPanel } from "@/features/viewer/components/properties-panel";
import { ViewerToolbar } from "@/features/viewer/components/viewer-toolbar";
import {
  applyViewerDataTableDraft,
  clearPersistedViewerDataTableDraft,
  coerceViewerDataTableInputValue,
  readPersistedViewerDataTableDraft,
  sanitizeViewerDataTableDraft,
  writePersistedViewerDataTableDraft,
} from "@/features/viewer/lib/data-table-draft";
import {
  clearServerViewerDataTableDraft,
  readServerViewerDataTableDraft,
  writeServerViewerDataTableDraft,
} from "@/features/viewer/lib/data-table-draft-api";
import {
  exportEditedIfcViaApi,
  exportViewerDataTableToExcelViaApi,
  importViewerDataTableFromExcelViaApi,
} from "@/features/viewer/lib/data-table-compute-api";
import {
  buildViewerDataTableExcelFileName,
  buildViewerDataTableIfcFileName,
  exportViewerDataTableToExcel,
  importViewerDataTableFromExcel,
} from "@/features/viewer/lib/data-table-excel";
import {
  applyViewerDataTableToInspection,
  buildViewerTreeDebugSample,
  formatBytes,
  sanitizeViewerDebugValue,
} from "@/features/viewer/lib/ifc-data";
import { LocalFileModelSource, RemoteModelSource } from "@/features/viewer/lib/model-source";
import { isServerStorageAvailable, uploadModelToServer } from "@/features/viewer/lib/model-api";
import { ServerModelsMenu } from "@/features/viewer/components/server-models-menu";
import { buildViewerValidationClauseTableViews } from "@/features/viewer/lib/validation-clauses";
import { exportEditedIfc } from "@/features/viewer/lib/ifc-writeback";
import type {
  ModelMetadata,
  ModelSourceResult,
  ViewerCategorySummary,
  ViewerDebugData,
  ViewerDataTableCellEditRequest,
  ViewerDataTableDraft,
  ViewerDataTableExportStatus,
  ViewerDataTableImportReport,
  ViewerDataTableState,
  ViewerSelectionDetails,
  ViewerSessionState,
  ViewerStatus,
  ViewerValidationHighlights,
  ViewerValidationClauseTableView,
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

const DEFAULT_TREE_DRAWER_WIDTH = 520;
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
const VALIDATION_API_ROW_THRESHOLD = 1000;
const VIEWER_THEME_STORAGE_KEY = "corey.viewer.theme";

const validationWorkerUrl = new URL("../../rules/workers/validation-worker.ts", import.meta.url);
const source = new LocalFileModelSource();
const remoteSource = new RemoteModelSource();

const emptyValidationHighlights: ViewerValidationHighlights = {
  warn: {},
  error: {},
};

function areValidationElementMapsEqual(
  left: ViewerValidationHighlights["warn"],
  right: ViewerValidationHighlights["warn"],
) {
  const leftModelIds = Object.keys(left);
  const rightModelIds = Object.keys(right);
  if (leftModelIds.length !== rightModelIds.length) {
    return false;
  }

  for (const modelId of leftModelIds) {
    const leftIds = left[modelId] ?? [];
    const rightIds = right[modelId] ?? [];
    if (leftIds.length !== rightIds.length) {
      return false;
    }

    const rightIdSet = new Set(rightIds);
    for (const localId of leftIds) {
      if (!rightIdSet.has(localId)) {
        return false;
      }
    }
  }

  return true;
}

function areValidationHighlightsEqual(
  left: ViewerValidationHighlights,
  right: ViewerValidationHighlights,
) {
  return (
    areValidationElementMapsEqual(left.warn, right.warn) &&
    areValidationElementMapsEqual(left.error, right.error)
  );
}

const initialDataTableActionStatus: ViewerDataTableExportStatus = {
  phase: "idle",
  message: "",
  issues: [],
};

const initialDebugData: ViewerDebugData = {
  sampleItem: null,
  sampleLocalId: null,
  selectedItem: null,
  selectedLocalId: null,
};

type ViewerValidationPhase = "idle" | "running" | "ready" | "error";

type ViewerValidationState = {
  phase: ViewerValidationPhase;
  mode: "worker" | "api" | null;
  progress: number;
  issueCount: number;
  failedClauseCount: number;
  message: string;
};

const initialValidationState: ViewerValidationState = {
  phase: "idle",
  mode: null,
  progress: 0,
  issueCount: 0,
  failedClauseCount: 0,
  message: "No validation rules configured.",
};

type DrawerSide = "left" | "right";
type ServerStorageStatus = "checking" | "available" | "unavailable";
type ViewerTheme = "light" | "dark";

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

type WorkspaceDrawerWidths = {
  treeDrawerWidth: number;
  propertiesDrawerWidth: number;
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

function clampDrawerWidthToWorkspace(
  nextWidth: number,
  otherDrawerWidth: number,
  workspaceWidth: number,
) {
  if (workspaceWidth === 0) {
    return clamp(nextWidth, MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH);
  }

  const handleCount = 2;
  const availableWidth =
    workspaceWidth - otherDrawerWidth - handleCount * DRAWER_HANDLE_WIDTH - MIN_VIEWPORT_WIDTH;
  const maxWidth = Math.min(
    MAX_DRAWER_WIDTH,
    Math.max(MIN_CONSTRAINED_DRAWER_WIDTH, availableWidth),
  );
  const minWidth = Math.min(MIN_DRAWER_WIDTH, maxWidth);

  return clamp(nextWidth, minWidth, maxWidth);
}

function clampWorkspaceDrawerWidths({
  treeDrawerWidth,
  propertiesDrawerWidth,
  showTree,
  showProperties,
  workspaceWidth,
}: WorkspaceDrawerWidths & {
  showTree: boolean;
  showProperties: boolean;
  workspaceWidth: number;
}) {
  if (workspaceWidth === 0) {
    return {
      treeDrawerWidth: showTree
        ? clamp(treeDrawerWidth, MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH)
        : treeDrawerWidth,
      propertiesDrawerWidth: showProperties
        ? clamp(propertiesDrawerWidth, MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH)
        : propertiesDrawerWidth,
    } satisfies WorkspaceDrawerWidths;
  }

  if (showTree && !showProperties) {
    return {
      treeDrawerWidth: clampDrawerWidthToWorkspace(
        treeDrawerWidth,
        COLLAPSED_DRAWER_WIDTH,
        workspaceWidth,
      ),
      propertiesDrawerWidth,
    } satisfies WorkspaceDrawerWidths;
  }

  if (!showTree && showProperties) {
    return {
      treeDrawerWidth,
      propertiesDrawerWidth: clampDrawerWidthToWorkspace(
        propertiesDrawerWidth,
        COLLAPSED_DRAWER_WIDTH,
        workspaceWidth,
      ),
    } satisfies WorkspaceDrawerWidths;
  }

  if (!showTree || !showProperties) {
    return { treeDrawerWidth, propertiesDrawerWidth } satisfies WorkspaceDrawerWidths;
  }

  const handleCount = 2;
  const availableDrawerWidth =
    workspaceWidth - handleCount * DRAWER_HANDLE_WIDTH - MIN_VIEWPORT_WIDTH;
  const minimumDrawerWidth =
    availableDrawerWidth >= MIN_DRAWER_WIDTH * 2
      ? MIN_DRAWER_WIDTH
      : MIN_CONSTRAINED_DRAWER_WIDTH;
  const maximumTotalDrawerWidth = Math.max(minimumDrawerWidth * 2, availableDrawerWidth);
  let nextTreeDrawerWidth = clamp(treeDrawerWidth, minimumDrawerWidth, MAX_DRAWER_WIDTH);
  let nextPropertiesDrawerWidth = clamp(
    propertiesDrawerWidth,
    minimumDrawerWidth,
    MAX_DRAWER_WIDTH,
  );
  let excessWidth =
    nextTreeDrawerWidth + nextPropertiesDrawerWidth - maximumTotalDrawerWidth;

  if (excessWidth <= 0) {
    return {
      treeDrawerWidth: nextTreeDrawerWidth,
      propertiesDrawerWidth: nextPropertiesDrawerWidth,
    } satisfies WorkspaceDrawerWidths;
  }

  const treeShrinkRoom = Math.max(0, nextTreeDrawerWidth - minimumDrawerWidth);
  const propertiesShrinkRoom = Math.max(0, nextPropertiesDrawerWidth - minimumDrawerWidth);
  const totalShrinkRoom = treeShrinkRoom + propertiesShrinkRoom;

  if (totalShrinkRoom === 0) {
    return {
      treeDrawerWidth: nextTreeDrawerWidth,
      propertiesDrawerWidth: nextPropertiesDrawerWidth,
    } satisfies WorkspaceDrawerWidths;
  }

  const treeReduction = Math.min(
    treeShrinkRoom,
    excessWidth * (treeShrinkRoom / totalShrinkRoom),
  );
  nextTreeDrawerWidth -= treeReduction;
  excessWidth -= treeReduction;

  const propertiesReduction = Math.min(propertiesShrinkRoom, excessWidth);
  nextPropertiesDrawerWidth -= propertiesReduction;
  excessWidth -= propertiesReduction;

  if (excessWidth > 0) {
    nextTreeDrawerWidth -= Math.min(
      Math.max(0, nextTreeDrawerWidth - minimumDrawerWidth),
      excessWidth,
    );
  }

  return {
    treeDrawerWidth: nextTreeDrawerWidth,
    propertiesDrawerWidth: nextPropertiesDrawerWidth,
  } satisfies WorkspaceDrawerWidths;
}

function dataTablePhaseTone(phase: ViewerDataTableState["phase"]) {
  switch (phase) {
    case "loading":
      return "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]";
    case "error":
      return "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]";
    case "loaded":
      return "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)]";
    default:
      return "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)]";
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

type HeaderActionButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

type HeaderActionFileButtonProps = {
  label: string;
  disabled?: boolean;
  accept: string;
  onFileSelect: (file: File) => Promise<void> | void;
  children: React.ReactNode;
};

function HeaderActionButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: HeaderActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-[var(--r-control)] border transition ${
        active
          ? "border-[color:var(--accent-strong)] bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
          : "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] hover:border-[color:var(--viewer-border-strong)] hover:bg-[color:var(--surface-strong)]"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

function HeaderActionFileButton({
  label,
  disabled = false,
  accept,
  onFileSelect,
  children,
}: HeaderActionFileButtonProps) {
  const className =
    "flex h-10 w-10 items-center justify-center rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] transition hover:border-[color:var(--viewer-border-strong)] hover:bg-[color:var(--surface-strong)]";

  if (disabled) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled
        className={`${className} cursor-not-allowed opacity-50`}
      >
        {children}
      </button>
    );
  }

  return (
    <label
      aria-label={label}
      title={label}
      className={`${className} cursor-pointer`}
    >
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) {
            return;
          }

          void onFileSelect(file);
        }}
      />
      {children}
    </label>
  );
}

type HeaderEditsControlProps = {
  draftEditCount: number;
  busy?: boolean;
  onExportIfc: () => void;
  onDiscard: () => void;
};

// Model-level home for pending corrections: the deliverable (Export IFC) lives
// in the global header so it survives closing the data table, and the
// destructive reset is tucked behind a confirm in the overflow menu.
function HeaderEditsControl({
  draftEditCount,
  busy = false,
  onExportIfc,
  onDiscard,
}: HeaderEditsControlProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setConfirmingDiscard(false);
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, menuOpen]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <div className="inline-flex h-10 items-center overflow-hidden rounded-[var(--r-control)] border border-[color:var(--success-border)] shadow-sm">
        <button
          type="button"
          onClick={onExportIfc}
          disabled={busy}
          className="inline-flex h-full items-center gap-2 bg-[color:var(--success-bg)] px-4 text-sm font-semibold text-[color:var(--success-fg)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileOutput className="h-4 w-4 shrink-0" />
          <span>Export IFC</span>
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[color:var(--success-fg)]/15 px-1.5 text-[11px] font-bold tabular-nums">
            {draftEditCount}
          </span>
        </button>
        <button
          type="button"
          aria-label="More edit actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          disabled={busy}
          className="inline-flex h-full items-center border-l border-[color:var(--success-border)] bg-[color:var(--success-bg)] px-2 text-[color:var(--success-fg)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ChevronDown className={`h-4 w-4 transition ${menuOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.375rem)] z-50 w-64 rounded-[var(--r-panel)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] p-1.5 shadow-[var(--viewer-shadow-lift)]"
        >
          {confirmingDiscard ? (
            <div className="px-2 py-1.5">
              <p className="text-xs leading-relaxed text-[color:var(--foreground)]">
                Discard {draftEditCount} {draftEditCount === 1 ? "edit" : "edits"}? This can’t be
                undone.
              </p>
              <div className="mt-2.5 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setConfirmingDiscard(false)}
                  className="inline-flex h-8 items-center rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-2.5 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDiscard();
                    closeMenu();
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-2.5 text-xs font-semibold text-[color:var(--danger-fg)] transition hover:opacity-90"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirmingDiscard(true)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--danger-bg)] hover:text-[color:var(--danger-fg)]"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              <span>Discard all edits</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
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
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
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
        className={`absolute top-3 flex h-9 w-9 cursor-pointer items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] ${togglePositionClass} ${
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
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const treeDrawerRef = useRef<HTMLDivElement | null>(null);
  const propertiesDrawerRef = useRef<HTMLDivElement | null>(null);
  const dataTableDialogRef = useRef<HTMLDivElement | null>(null);
  const activeSourceRef = useRef<ModelSourceResult | null>(null);
  const dataTableDraftPersistenceVersionRef = useRef(0);
  const dataTableDraftWriteThroughRef = useRef(false);
  const [serverNotice, setServerNotice] = useState<{
    tone: "info" | "success" | "error";
    message: string;
    sticky?: boolean;
  } | null>(null);
  const [serverStorageStatus, setServerStorageStatus] =
    useState<ServerStorageStatus>("checking");
  const validationWorkerRef = useRef<Worker | null>(null);
  const validationAbortControllerRef = useRef<AbortController | null>(null);
  const validationRunIdRef = useRef(0);
  const drawerDragStateRef = useRef<DrawerDragState | null>(null);
  const treeDrawerWidthRef = useRef(DEFAULT_TREE_DRAWER_WIDTH);
  const propertiesDrawerWidthRef = useRef(DEFAULT_PROPERTIES_DRAWER_WIDTH);
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
  const [dataTableImportFocus, setDataTableImportFocus] = useState<{
    revision: number;
    columnKeys: string[];
  }>({
    revision: 0,
    columnKeys: [],
  });
  const [dataTableVisibleRowKeysInView, setDataTableVisibleRowKeysInView] =
    useState<Set<string> | null>(null);
  const [selectionDetails, setSelectionDetails] = useState<ViewerSelectionDetails>({
    selection: null,
    inspection: null,
    loading: false,
  });
  const [debugData, setDebugData] = useState<ViewerDebugData>(initialDebugData);
  const [validationState, setValidationState] = useState(initialValidationState);
  const [validationHighlights, setValidationHighlights] = useState<ViewerValidationHighlights>(
    emptyValidationHighlights,
  );
  const [validationResult, setValidationResult] = useState<ViewerValidationRunResult | null>(null);
  const [selectedValidationClauseId, setSelectedValidationClauseId] = useState("");
  const [viewerTheme, setViewerTheme] = useState<ViewerTheme>("light");
  const [viewerThemeLoaded, setViewerThemeLoaded] = useState(false);
  const [showTree, setShowTree] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [showDataTable, setShowDataTable] = useState(false);
  const [showDataTableInWindow, setShowDataTableInWindow] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
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
  const serverStorageAvailable = serverStorageStatus === "available";
  const openFileLabel = serverStorageStatus === "unavailable" ? "Open" : "Upload";
  const OpenFileIcon = openFileLabel === "Open" ? FolderOpen : Upload;
  const filesDisabledReason =
    serverStorageStatus === "checking"
      ? "Checking server storage..."
      : serverStorageStatus === "unavailable"
        ? "Files are disabled because S3 storage is not configured."
        : undefined;
  const toggleViewerTheme = useCallback(() => {
    setViewerTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);
  const deferredClauses = useDeferredValue(config.clauses);
  const compiledValidationRules = useMemo(
    () => compileViewerValidationRules(deferredClauses),
    [deferredClauses],
  );
  const runnableRuleCount = useMemo(
    () =>
      [...compiledValidationRules.values()].reduce(
        (count, rulesForType) =>
          count + [...rulesForType.values()].reduce((ruleCount, rulesForTarget) => ruleCount + rulesForTarget.length, 0),
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
  const isDataTableSyncedToView = dataTableVisibleRowKeysInView !== null;
  const indexedIfcTypes = useMemo(() => effectiveDataTableData?.ifcTypes ?? [], [effectiveDataTableData]);
  const draftEditCount = dataTableDraft?.edits.length ?? 0;
  const commitDataTableDraft = useCallback(
    (
      next: SetStateAction<ViewerDataTableDraft | null>,
      options: { writeThrough?: boolean } = {},
    ) => {
      dataTableDraftWriteThroughRef.current = options.writeThrough ?? false;
      dataTableDraftPersistenceVersionRef.current += 1;
      setDataTableDraft(next);
    },
    [],
  );
  const validatedSelectionDetails = useMemo<ViewerSelectionDetails>(
    () => ({
      ...selectionDetails,
      inspection: applyViewerValidationToInspection(
        applyViewerDataTableToInspection(selectionDetails.inspection, effectiveDataTableData),
        deferredClauses,
      ),
    }),
    [deferredClauses, effectiveDataTableData, selectionDetails],
  );
  const validationClauseTableViews = useMemo<ViewerValidationClauseTableView[]>(
    () =>
      buildViewerValidationClauseTableViews({
        data: effectiveDataTableData,
        result: validationResult,
      }),
    [effectiveDataTableData, validationResult],
  );
  const debugTreeSample = useMemo(
    () => (tree.length > 0 ? buildViewerTreeDebugSample(tree) : null),
    [tree],
  );
  const debugRowSample = useMemo(() => {
    const rows = dataTableState.data?.rows ?? [];
    if (rows.length === 0) {
      return null;
    }

    const activeRow =
      (session.selected
        ? rows.find((row) => row.localId === session.selected?.localId)
        : null) ?? rows[0];

    return sanitizeViewerDebugValue(activeRow, {
      maxDepth: 5,
      maxArrayLength: 10,
      maxObjectEntries: 14,
    });
  }, [dataTableState.data?.rows, session.selected]);
  const debugSelectionSample = useMemo(
    () =>
      selectionDetails.selection || selectionDetails.loading || selectionDetails.inspection
        ? sanitizeViewerDebugValue(selectionDetails, {
            maxDepth: 5,
            maxArrayLength: 10,
            maxObjectEntries: 14,
          })
        : null,
    [selectionDetails],
  );
  const activeRawDebugItem = debugData.selectedItem ?? debugData.sampleItem;
  const activeRawDebugLabel =
    debugData.selectedLocalId !== null
      ? `selected localId ${debugData.selectedLocalId}`
      : debugData.sampleLocalId !== null
        ? `sample localId ${debugData.sampleLocalId}`
        : "no item sample";

  const viewerStatusTone: StatusTone =
    status.phase === "error"
      ? "error"
      : status.phase === "loading"
        ? "warn"
        : status.phase === "loaded"
          ? "success"
          : "muted";

  const viewerValidationLabel =
    validationState.phase === "running"
      ? `Validation ${validationState.progress}%`
      : validationState.phase === "ready"
        ? validationState.issueCount === 0
          ? "Validation clear"
          : `${validationState.issueCount} flagged · ${validationState.failedClauseCount} clauses`
        : validationState.phase === "error"
          ? "Validation error"
          : "Validation idle";

  const viewerValidationTone: StatusTone =
    validationState.phase === "error"
      ? "error"
      : validationState.phase === "ready"
        ? validationState.issueCount === 0
          ? "success"
          : "warn"
        : validationState.phase === "running"
          ? "warn"
          : "muted";

  const viewerStatusSegments = useMemo<StatusSegment[]>(() => {
    const segments: StatusSegment[] = [
      metadata
        ? { id: "model", label: metadata.name, tone: "default", title: metadata.name }
        : { id: "model", label: "No file loaded" },
    ];

    if (metadata) {
      segments.push({ id: "size", label: formatBytes(metadata.size) });
    }

    segments.push(
      { id: "tool", label: `${session.activeTool} tool` },
      { id: "phase", label: `${status.phase} status` },
      { id: "clauses", label: `${config.clauses.length} clauses` },
      {
        id: "validation",
        label: viewerValidationLabel,
        tone: viewerValidationTone,
        title: validationState.message,
      },
    );

    return segments;
  }, [
    config.clauses.length,
    metadata,
    session.activeTool,
    status.phase,
    validationState.message,
    viewerValidationLabel,
    viewerValidationTone,
  ]);

  const viewerDebugTabs = useMemo(
    () => [
      {
        id: "raw",
        label: `Raw IFC · ${activeRawDebugLabel}`,
        value: activeRawDebugItem,
        emptyMessage: "Load a model to inspect the raw parsed IFC item payload.",
      },
      {
        id: "selection",
        label: "Selection",
        value: debugSelectionSample,
        emptyMessage: "Select an element to inspect the normalized selection payload.",
      },
      {
        id: "row",
        label: "Row",
        value: debugRowSample,
        emptyMessage: "Load a model to inspect an indexed data table row.",
      },
      {
        id: "tree",
        label: "Tree",
        value: debugTreeSample,
        emptyMessage: "Load a model to inspect a sample of the spatial tree.",
      },
    ],
    [activeRawDebugItem, activeRawDebugLabel, debugRowSample, debugSelectionSample, debugTreeSample],
  );

  const validationPayload = useMemo<ViewerValidationRunPayload | null>(() => {
    if (
      !metadata ||
      status.phase !== "loaded" ||
      !effectiveDataTableData ||
      deferredClauses.length === 0 ||
      runnableRuleCount === 0
    ) {
      return null;
    }

    return {
      version: VIEWER_VALIDATION_CONFIG_VERSION,
      sourceId: metadata.sourceId ?? metadata.name,
      clauses: deferredClauses,
      rows: buildViewerValidationRows(effectiveDataTableData, deferredClauses),
    };
  }, [deferredClauses, effectiveDataTableData, metadata, runnableRuleCount, status.phase]);

  useEffect(() => {
    const persistedTheme = window.localStorage.getItem(VIEWER_THEME_STORAGE_KEY);
    if (persistedTheme === "light" || persistedTheme === "dark") {
      setViewerTheme(persistedTheme);
    }
    setViewerThemeLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void isServerStorageAvailable().then((available) => {
      if (!cancelled) {
        setServerStorageStatus(available ? "available" : "unavailable");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!viewerThemeLoaded) {
      return;
    }
    window.localStorage.setItem(VIEWER_THEME_STORAGE_KEY, viewerTheme);
  }, [viewerTheme, viewerThemeLoaded]);

  useEffect(() => {
    const sourceId = metadata?.sourceId;
    const serverModelId = metadata?.serverModelId;
    if (!sourceId || !dataTableState.data) {
      commitDataTableDraft(null);
      return;
    }

    const cachedDraft = readPersistedViewerDataTableDraft(sourceId);
    commitDataTableDraft(cachedDraft);
    setDataTableImportReport(null);
    setDataTableActionStatus(
      cachedDraft &&
        (cachedDraft.edits.length > 0 || cachedDraft.importedColumns.length > 0)
        ? {
            phase: "success",
            message: `Restored ${cachedDraft.edits.length} draft edits from draft cache.`,
            issues: [],
          }
        : initialDataTableActionStatus,
    );

    if (!serverModelId) {
      return;
    }

    const cacheHydrationVersion = dataTableDraftPersistenceVersionRef.current;
    const controller = new AbortController();

    readServerViewerDataTableDraft(serverModelId, controller.signal)
      .then((serverDraft) => {
        if (dataTableDraftPersistenceVersionRef.current !== cacheHydrationVersion) {
          return;
        }

        if (serverDraft) {
          writePersistedViewerDataTableDraft(serverDraft);
        } else {
          clearPersistedViewerDataTableDraft(sourceId);
        }
        commitDataTableDraft(serverDraft);
        setDataTableActionStatus(
          serverDraft &&
            (serverDraft.edits.length > 0 || serverDraft.importedColumns.length > 0)
            ? {
                phase: "success",
                message: `Restored ${serverDraft.edits.length} draft edits from server draft.`,
                issues: [],
              }
            : initialDataTableActionStatus,
        );
      })
      .catch(() => {
        // Offline / server error — keep the cache snapshot.
      });

    return () => controller.abort();
  }, [commitDataTableDraft, dataTableState.data, metadata?.serverModelId, metadata?.sourceId]);

  useEffect(() => {
    const sourceId = metadata?.sourceId;
    const serverModelId = metadata?.serverModelId;
    if (!sourceId) {
      return;
    }

    if (!dataTableDraftWriteThroughRef.current) {
      return;
    }

    const controller = serverModelId ? new AbortController() : null;

    if (dataTableDraft) {
      const persisted = writePersistedViewerDataTableDraft(dataTableDraft);
      if (!persisted.ok) {
        setDataTableActionStatus((current) => ({
          phase: current.phase === "error" ? current.phase : "success",
          message: `${current.message || `Saved ${dataTableDraft.edits.length} draft edits.`} Local draft restore is unavailable: ${persisted.message}`,
          issues: current.issues,
        }));
      }

      if (serverModelId && dataTableDraft.sourceId === serverModelId) {
        void writeServerViewerDataTableDraft(dataTableDraft, controller?.signal).catch(() => {
          // Best-effort write-through; localStorage keeps the latest draft for reload.
        });
      }

      return () => controller?.abort();
    }

    clearPersistedViewerDataTableDraft(sourceId);
    if (serverModelId) {
      void clearServerViewerDataTableDraft(serverModelId, controller?.signal).catch(() => {
        // Best-effort delete; the next successful write replaces server state.
      });
    }

    return () => controller?.abort();
  }, [dataTableDraft, metadata?.serverModelId, metadata?.sourceId]);

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
    const otherDrawerWidth =
      side === "left"
        ? showProperties
          ? propertiesDrawerWidthRef.current
          : COLLAPSED_DRAWER_WIDTH
        : showTree
          ? treeDrawerWidthRef.current
          : COLLAPSED_DRAWER_WIDTH;

    return clampDrawerWidthToWorkspace(nextWidth, otherDrawerWidth, workspaceWidth);
  }, [showProperties, showTree]);

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
    const nextWidths = clampWorkspaceDrawerWidths({
      treeDrawerWidth: treeDrawerWidthRef.current,
      propertiesDrawerWidth: propertiesDrawerWidthRef.current,
      showTree,
      showProperties,
      workspaceWidth: workspaceRef.current?.clientWidth ?? 0,
    });

    if (showTree && nextWidths.treeDrawerWidth !== treeDrawerWidthRef.current) {
      treeDrawerWidthRef.current = nextWidths.treeDrawerWidth;
      setTreeDrawerWidth((current) =>
        current === nextWidths.treeDrawerWidth ? current : nextWidths.treeDrawerWidth,
      );
    }

    if (
      showProperties &&
      nextWidths.propertiesDrawerWidth !== propertiesDrawerWidthRef.current
    ) {
      propertiesDrawerWidthRef.current = nextWidths.propertiesDrawerWidth;
      setPropertiesDrawerWidth((current) =>
        current === nextWidths.propertiesDrawerWidth
          ? current
          : nextWidths.propertiesDrawerWidth,
      );
    }
  }, [showProperties, showTree]);

  const stopDrawerResize = useCallback(() => {
    stopPendingDrawerPreview();
    drawerDragStateRef.current = null;
    setDrawerDragState(null);

    const pendingWidth = pendingDrawerWidthRef.current;
    pendingDrawerWidthRef.current = null;
    if (pendingWidth) {
      applyDrawerWidth(pendingWidth.side, pendingWidth.width);
      if (pendingWidth.side === "left") {
        treeDrawerWidthRef.current = pendingWidth.width;
        setTreeDrawerWidth(pendingWidth.width);
      } else {
        propertiesDrawerWidthRef.current = pendingWidth.width;
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
    treeDrawerWidthRef.current = treeDrawerWidth;
    applyDrawerWidth("left", treeDrawerWidth);
  }, [applyDrawerWidth, treeDrawerWidth]);

  useEffect(() => {
    propertiesDrawerWidthRef.current = propertiesDrawerWidth;
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
        setValidationHighlights((current) =>
          areValidationHighlightsEqual(current, emptyValidationHighlights)
            ? current
            : emptyValidationHighlights,
        );
        setValidationResult(null);
        setValidationState({
          phase: "idle",
          mode: null,
          progress: 0,
          issueCount: 0,
          failedClauseCount: 0,
          message:
            deferredClauses.length === 0
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
        setValidationHighlights((current) =>
          areValidationHighlightsEqual(current, emptyValidationHighlights)
            ? current
            : emptyValidationHighlights,
        );
        setValidationResult(null);
        setValidationState({
          phase: "idle",
          mode: null,
          progress: 0,
          issueCount: 0,
          failedClauseCount: 0,
          message:
            deferredClauses.length === 0
              ? "No validation rules configured."
              : "Complete at least one rule to start validation.",
        });
      });
      return;
    }

    if (validationPayload.rows.length === 0) {
      startTransition(() => {
        setValidationHighlights((current) =>
          areValidationHighlightsEqual(current, emptyValidationHighlights)
            ? current
            : emptyValidationHighlights,
        );
        setValidationResult(null);
        setValidationState({
          phase: "ready",
          mode: null,
          progress: 100,
          issueCount: 0,
          failedClauseCount: 0,
          message: `No indexed elements match the current rule IFC types. Rules: ${summarizeIfcTypes(
            runnableRuleIfcTypes,
          )}. Indexed: ${summarizeIfcTypes(indexedIfcTypes)}.`,
        });
      });
      return;
    }

    const runToken = ++validationRunIdRef.current;
    const runId = String(runToken);
    const shouldRunViaApi =
      Boolean(metadata.serverModelId) ||
      validationPayload.rows.length >= VALIDATION_API_ROW_THRESHOLD;
    let apiStarted = false;
    let workerStarted = false;

    const commitSuccess = (mode: "worker" | "api", result: ViewerValidationRunResult) => {
      if (validationRunIdRef.current !== runToken) {
        return;
      }

      startTransition(() => {
        const nextHighlights = groupViewerValidationResultsBySeverity(result.results);
        setValidationHighlights((current) =>
          areValidationHighlightsEqual(current, nextHighlights) ? current : nextHighlights,
        );
        setValidationResult(result);
        setValidationState({
          phase: "ready",
          mode,
          progress: 100,
          issueCount: result.results.length,
          failedClauseCount: result.failedClauseCount,
          message:
            result.results.length === 0
              ? `Validated ${validationPayload.rows.length} elements with no issues.`
              : `Validated ${validationPayload.rows.length} elements. ${result.results.length} flagged across ${result.failedClauseCount} clauses.`,
        });
      });
    };

    const commitError = (mode: "worker" | "api" | null, message: string) => {
      if (validationRunIdRef.current !== runToken) {
        return;
      }

      startTransition(() => {
        setValidationResult(null);
        setValidationState((current) => ({
          phase: "error",
          mode,
          progress: current.progress,
          issueCount: current.issueCount,
          failedClauseCount: current.failedClauseCount,
          message,
        }));
      });
    };

    const runApiValidation = async (strategy: "primary" | "fallback") => {
      if (apiStarted || validationRunIdRef.current !== runToken) {
        return;
      }

      apiStarted = true;
      stopValidationWorker();

      const controller = new AbortController();
      validationAbortControllerRef.current = controller;

      startTransition(() => {
        setValidationResult((current) =>
          current?.sourceId === validationPayload.sourceId ? current : null,
        );
        setValidationState({
          phase: "running",
          mode: "api",
          progress: 0,
          issueCount: 0,
          failedClauseCount: 0,
          message:
            strategy === "primary"
              ? `Validating ${validationPayload.rows.length} elements via API...`
              : `Validating ${validationPayload.rows.length} elements via API fallback...`,
        });
      });

      try {
        commitSuccess(
          "api",
          await evaluateViewerValidationViaApi(validationPayload, controller.signal),
        );
      } catch (error) {
        if (controller.signal.aborted || validationRunIdRef.current !== runToken) {
          return;
        }

        if (strategy === "primary") {
          runWorkerValidation("fallback");
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

    const runWorkerValidation = (strategy: "primary" | "fallback") => {
      if (workerStarted || validationRunIdRef.current !== runToken) {
        return;
      }

      workerStarted = true;
      stopValidationRequest();

      startTransition(() => {
        setValidationResult((current) =>
          current?.sourceId === validationPayload.sourceId ? current : null,
        );
        setValidationState({
          phase: "running",
          mode: "worker",
          progress: 0,
          issueCount: 0,
          failedClauseCount: 0,
          message:
            strategy === "primary"
              ? `Validating ${validationPayload.rows.length} elements in a worker...`
              : `Validating ${validationPayload.rows.length} elements in a worker fallback...`,
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
                failedClauseCount: 0,
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

          stopValidationWorker();
          if (strategy === "primary") {
            void runApiValidation("fallback");
            return;
          }

          commitError("worker", message.message);
        };

        worker.onerror = (event) => {
          event.preventDefault();
          stopValidationWorker();

          if (strategy === "primary") {
            void runApiValidation("fallback");
            return;
          }

          commitError("worker", "Validation worker failed.");
        };

        worker.postMessage({
          type: "run",
          runId,
          payload: validationPayload,
        });
      } catch (error) {
        stopValidationWorker();
        if (strategy === "primary") {
          void runApiValidation("fallback");
          return;
        }

        commitError(
          "worker",
          error instanceof Error ? error.message : "Validation worker failed.",
        );
      }
    };

    if (shouldRunViaApi) {
      void runApiValidation("primary");
    } else {
      runWorkerValidation("primary");
    }

    return () => {
      stopValidationWorker();
      stopValidationRequest();
    };
  }, [
    effectiveDataTableData,
    deferredClauses.length,
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

  const loadModelFromSource = useCallback(async (sourceResult: ModelSourceResult) => {
    activeSourceRef.current = sourceResult;
    startTransition(() => {
      commitDataTableDraft(null);
      setDataTableImportReport(null);
      setDataTableActionStatus(initialDataTableActionStatus);
    });
    await viewportRef.current?.loadIfc(sourceResult);
  }, [commitDataTableDraft]);

  const loadModelFromFile = useCallback(
    async (file: File) => {
      await loadModelFromSource(await source.read({ kind: "file", file }));
    },
    [loadModelFromSource],
  );

  const loadModelById = useCallback(
    async (modelId: string) => {
      startTransition(() => {
        setStatus({ phase: "loading", message: "Fetching model from server..." });
      });

      try {
        await loadModelFromSource(await remoteSource.read({ kind: "remote", modelId }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        startTransition(() => {
          setStatus({ phase: "error", message: `Failed to load server model: ${message}` });
        });
      }
    },
    [loadModelFromSource],
  );

  const autoSaveToServer = useCallback(async () => {
    const activeSource = activeSourceRef.current;
    if (!activeSource) {
      return;
    }

    // Already a server-backed model (e.g. loaded from the catalog) — nothing to do.
    if (activeSource.metadata.serverModelId) {
      return;
    }

    const storageAvailable = await isServerStorageAvailable();
    setServerStorageStatus(storageAvailable ? "available" : "unavailable");
    if (!storageAvailable) {
      setServerNotice({
        tone: "info",
        message:
          "Server storage isn’t configured — this model is available for the current session only.",
      });
      return;
    }

    const previousSourceId = activeSource.metadata.sourceId;
    setServerNotice({ tone: "info", message: "Saving model to server…", sticky: true });
    try {
      const summary = await uploadModelToServer(
        activeSource.metadata.name,
        activeSource.bytes as BodyInit,
      );
      const rekeyedDraft = dataTableDraft
        ? { ...dataTableDraft, sourceId: summary.modelId, updatedAt: new Date().toISOString() }
        : null;
      if (rekeyedDraft) {
        writePersistedViewerDataTableDraft(rekeyedDraft);
      }
      if (previousSourceId && previousSourceId !== summary.modelId) {
        clearPersistedViewerDataTableDraft(previousSourceId);
      }

      activeSourceRef.current = {
        ...activeSource,
        metadata: {
          ...activeSource.metadata,
          sourceId: summary.modelId,
          serverModelId: summary.modelId,
        },
      };
      commitDataTableDraft(rekeyedDraft, { writeThrough: true });
      setMetadata((current) =>
        current
          ? { ...current, sourceId: summary.modelId, serverModelId: summary.modelId }
          : current,
      );
      setServerNotice({ tone: "success", message: `Saved “${summary.name}” to server.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setServerNotice({ tone: "error", message: `Failed to save to server: ${message}` });
    }
  }, [commitDataTableDraft, dataTableDraft]);

  useEffect(() => {
    if (!serverNotice || serverNotice.sticky) {
      return;
    }
    const timer = window.setTimeout(() => setServerNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [serverNotice]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await loadModelFromFile(file);
    event.target.value = "";
    void autoSaveToServer();
  };

  const handleDataTableCellEdit = useCallback(
    (edit: ViewerDataTableCellEditRequest) => {
      if (!metadata?.sourceId || !dataTableState.data || !effectiveDataTableData) {
        setDataTableActionStatus({
          phase: "error",
          message: "Load and index a model before editing table cells.",
          issues: [],
        });
        return;
      }

      const column = effectiveDataTableData.columns.find(
        (candidate) => candidate.key === edit.columnKey,
      );
      if (!column) {
        setDataTableActionStatus({
          phase: "error",
          message: "The edited column no longer exists in the data table.",
          issues: [],
        });
        return;
      }

      if (!column.editable) {
        setDataTableActionStatus({
          phase: "error",
          message: column.editableReason ?? "This column is read-only.",
          issues: [],
        });
        return;
      }

      const coerced = coerceViewerDataTableInputValue(edit.raw, column.valueKind);
      if (!coerced.ok) {
        setDataTableActionStatus({
          phase: "error",
          message: coerced.message,
          issues: [{ rowKey: edit.rowKey, columnKey: edit.columnKey, message: coerced.message }],
        });
        return;
      }

      const nextEdits = [
        ...(dataTableDraft?.edits.filter(
          (currentEdit) =>
            currentEdit.rowKey !== edit.rowKey || currentEdit.columnKey !== edit.columnKey,
        ) ?? []),
        {
          rowKey: edit.rowKey,
          columnKey: edit.columnKey,
          value: coerced.value,
        },
      ];
      const importedColumns =
        dataTableDraft?.importedColumns ??
        effectiveDataTableData.columns.filter((candidate) => candidate.origin === "import");
      const { draft, issues } = sanitizeViewerDataTableDraft(
        metadata.sourceId,
        dataTableState.data,
        nextEdits,
        importedColumns,
      );
      const editStillApplied = Boolean(
        draft?.edits.some(
          (currentEdit) =>
            currentEdit.rowKey === edit.rowKey && currentEdit.columnKey === edit.columnKey,
        ),
      );

      commitDataTableDraft(draft, { writeThrough: true });
      setDataTableActionStatus({
        phase: issues.length > 0 ? "error" : "success",
        message:
          issues.length > 0
            ? issues[0]?.message ?? "The edit could not be applied."
            : editStillApplied
              ? `Updated ${column.label}.`
              : `Cleared edit for ${column.label}.`,
        issues,
      });
    },
    [
      commitDataTableDraft,
      dataTableDraft,
      dataTableState.data,
      effectiveDataTableData,
      metadata?.sourceId,
    ],
  );

  const handleDataTableImport = async (file: File) => {
    if (!metadata?.sourceId || !dataTableState.data || !effectiveDataTableData) {
      startTransition(() => {
        setDataTableActionStatus({
          phase: "error",
          message: "Load and index a model before importing Excel edits.",
          issues: [],
        });
      });
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
      let result;
      try {
        result = metadata.serverModelId
          ? await importViewerDataTableFromExcelViaApi({
              file,
              sourceId: metadata.sourceId,
              baseData: dataTableState.data,
              currentData: effectiveDataTableData,
            })
          : await importViewerDataTableFromExcel({
              file,
              sourceId: metadata.sourceId,
              baseData: dataTableState.data,
              currentData: effectiveDataTableData,
            });
      } catch (error) {
        if (!metadata.serverModelId) {
          throw error;
        }

        result = await importViewerDataTableFromExcel({
          file,
          sourceId: metadata.sourceId,
          baseData: dataTableState.data,
          currentData: effectiveDataTableData,
        });
      }
      const importedColumnKeys = [
        ...new Set(result.draft?.edits.map((edit) => edit.columnKey) ?? []),
      ];
      const importedEditCount = result.report.appliedEditCount;
      const skippedCellCount = result.report.skippedCellCount;

      startTransition(() => {
        commitDataTableDraft(result.draft, { writeThrough: true });
        setDataTableImportReport(result.report);
        setDataTableImportFocus((current) => ({
          revision: current.revision + Number(importedEditCount > 0),
          columnKeys: importedColumnKeys,
        }));
        setDataTableVisibleRowKeysInView(null);
        setDataTableActionStatus({
          phase:
            importedEditCount > 0
              ? "success"
              : skippedCellCount > 0
                ? "error"
                : "success",
          message:
            importedEditCount === 0
              ? skippedCellCount > 0
                ? `No edits were applied from ${file.name}; skipped ${skippedCellCount} cells.`
                : `No editable cell changes were detected in ${file.name}.`
              : skippedCellCount > 0
                ? `Imported ${importedEditCount} edits and skipped ${skippedCellCount} cells.`
                : `Imported ${importedEditCount} edits from ${file.name}.`,
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
      const fileName = buildViewerDataTableExcelFileName(metadata.name);
      let result;
      try {
        result = metadata.serverModelId
          ? await exportViewerDataTableToExcelViaApi({
              data: effectiveDataTableData,
              sourceId: metadata.sourceId,
              fileName,
            })
          : await exportViewerDataTableToExcel({
              data: effectiveDataTableData,
              sourceId: metadata.sourceId,
              fileName,
            });
      } catch (error) {
        if (!metadata.serverModelId) {
          throw error;
        }

        result = await exportViewerDataTableToExcel({
          data: effectiveDataTableData,
          sourceId: metadata.sourceId,
          fileName,
        });
      }
      setDataTableActionStatus({
        phase: "success",
        message: `Exported ${effectiveDataTableData.rows.length} rows to ${result.fileName}.`,
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
    commitDataTableDraft(null, { writeThrough: true });
    setDataTableImportReport(null);
    if (sourceId) {
      clearPersistedViewerDataTableDraft(sourceId);
    }
    setDataTableActionStatus({
      phase: "success",
      message: "Cleared data-table edits.",
      issues: [],
    });
  }, [commitDataTableDraft, metadata?.sourceId]);

  const handleExportEditedIfc = useCallback(async () => {
    if (!effectiveDataTableData || !metadata || !activeSourceRef.current) {
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

    const fileName = buildViewerDataTableIfcFileName(metadata.name);
    let result = metadata.serverModelId
      ? await exportEditedIfcViaApi({
          modelId: metadata.serverModelId,
          data: effectiveDataTableData,
          fileName,
        })
      : await exportEditedIfc({
          data: effectiveDataTableData,
          bytes: activeSourceRef.current.bytes,
          fileName,
        });

    if (result.phase === "error" && metadata.serverModelId) {
      result = await exportEditedIfc({
        data: effectiveDataTableData,
        bytes: activeSourceRef.current.bytes,
        fileName,
      });
    }
    setDataTableActionStatus(result);
  }, [effectiveDataTableData, metadata]);

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

  const handleDataTableRowSelect = useCallback((localId: number) => {
    void viewportRef.current?.selectNode(localId);
  }, []);

  const syncDataTableToView = useCallback(() => {
    if (!effectiveDataTableData) {
      setDataTableVisibleRowKeysInView(null);
      return;
    }

    const hiddenElements = viewportRef.current?.getHiddenElements() ?? null;
    const visibleRowKeys = new Set<string>();

    for (const row of effectiveDataTableData.rows) {
      if (!hiddenElements?.[row.modelId]?.has(row.localId)) {
        visibleRowKeys.add(row.key);
      }
    }

    setDataTableVisibleRowKeysInView(visibleRowKeys);
  }, [effectiveDataTableData]);

  const handleSyncDataTableToView = useCallback(async () => {
    if (dataTableVisibleRowKeysInView) {
      setDataTableVisibleRowKeysInView(null);
      return;
    }

    syncDataTableToView();
  }, [dataTableVisibleRowKeysInView, syncDataTableToView]);

  const runViewportVisibilityAction = useCallback(
    async (action: () => Promise<void>) => {
      await action();

      if (dataTableVisibleRowKeysInView) {
        syncDataTableToView();
      }
    },
    [dataTableVisibleRowKeysInView, syncDataTableToView],
  );

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

  useEffect(() => {
    setDataTableVisibleRowKeysInView(null);
  }, [metadata?.sourceId]);

  useEffect(() => {
    setSelectedValidationClauseId("");
  }, [metadata?.sourceId]);

  useEffect(() => {
    if (validationClauseTableViews.length === 0) {
      setSelectedValidationClauseId("");
      return;
    }

    if (
      !selectedValidationClauseId ||
      validationClauseTableViews.some((clause) => clause.clauseId === selectedValidationClauseId)
    ) {
      return;
    }

    setSelectedValidationClauseId("");
  }, [selectedValidationClauseId, validationClauseTableViews]);

  useEffect(() => {
    if (!isDataTableSyncedToView) {
      return;
    }

    syncDataTableToView();
  }, [effectiveDataTableData, isDataTableSyncedToView, syncDataTableToView]);

  const dataTableHeader = (
    <div className="flex items-start justify-between gap-3 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]/90 px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-sm font-semibold text-[color:var(--foreground)]">
            Data table
          </div>
          <span
            className={`corey-mono-label inline-flex items-center rounded-[var(--r-chip)] border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${dataTablePhaseTone(dataTableState.phase)}`}
          >
            {dataTableState.phase}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--muted-ink)]">
          {metadata ? (
            <span className="corey-mono-label inline-flex items-center rounded-[var(--r-chip)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 py-1">
              {metadata.name}
            </span>
          ) : null}
          {metadata ? (
            <span className="corey-mono-label inline-flex items-center rounded-[var(--r-chip)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 py-1">
              {formatBytes(metadata.size)}
            </span>
          ) : null}
          {draftEditCount > 0 ? (
            <span className="corey-mono-label inline-flex items-center rounded-[var(--r-chip)] border border-[color:var(--success-border)] bg-[color:var(--success-bg)] px-2.5 py-1 text-[color:var(--success-fg)]">
              {draftEditCount} draft edits
            </span>
          ) : null}
        </div>
        {dataTableActionStatus.message ? (
          <div className="mt-2 max-w-3xl text-xs text-[color:var(--muted-ink)]">
            {dataTableActionStatus.message}
          </div>
        ) : null}
        {dataTableImportReport?.issues.length ? (
          <div className="mt-1 max-w-3xl text-xs text-[color:var(--danger-fg)]">
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
        <HeaderActionButton
          label="Export Excel"
          onClick={() => {
            void handleExportExcel();
          }}
          disabled={!effectiveDataTableData || dataTableActionStatus.phase === "running"}
        >
          <FileSpreadsheet className="h-4 w-4" />
        </HeaderActionButton>
        <HeaderActionFileButton
          label="Import Excel"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onFileSelect={handleDataTableImport}
          disabled={!effectiveDataTableData || dataTableActionStatus.phase === "running"}
        >
          <Import className="h-4 w-4" />
        </HeaderActionFileButton>
        <HeaderActionButton
          label="Close"
          onClick={hideDataTable}
        >
          <X className="h-4 w-4" />
        </HeaderActionButton>
      </div>
    </div>
  );

  const dataTablePanelContent = (
    <div className="min-h-0 flex-1">
      <DataTablePanel
        embedded
        metadata={metadata}
        tableState={effectiveDataTableState}
        validationClauseViews={validationClauseTableViews}
        selectedValidationClauseId={selectedValidationClauseId}
        activeSelection={session.selected}
        visibleRowKeysInView={dataTableVisibleRowKeysInView}
        importRevision={dataTableImportFocus.revision}
        importedColumnKeys={dataTableImportFocus.columnKeys}
        onSyncToView={handleSyncDataTableToView}
        onValidationClauseChange={setSelectedValidationClauseId}
        onEditCell={handleDataTableCellEdit}
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
    <div
      data-viewer-theme={viewerTheme}
      className="flex h-full min-h-0 flex-col bg-[color:var(--background)] text-[color:var(--foreground)]"
    >
      <header className="w-full border-b border-[color:var(--viewer-border)] [background:var(--viewer-header-bg)] shadow-[var(--viewer-shadow)]">
        <div className="flex w-full flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <Image
                  src="/corey-robot-builder.png"
                  alt=""
                  width={44}
                  height={44}
                  priority
                  aria-hidden="true"
                  className="h-11 w-11 shrink-0"
                />
                <div className="mr-9 min-w-0">
                  <h1 className="mt-1 text-lg font-extrabold tracking-tight text-[color:var(--viewer-brand)] text-shadow-sm sm:text-xl">
                    COREY
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={openFilePicker}
                    className="inline-flex h-10 items-center gap-2 rounded-[var(--r-control)] bg-[color:var(--accent)] px-4 text-sm font-semibold text-[color:var(--accent-ink)] shadow-sm transition hover:bg-[color:var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2"
                  >
                    <OpenFileIcon className="h-4 w-4" />
                    <span>{openFileLabel}</span>
                  </button>
                  <ServerModelsMenu
                    theme={viewerTheme}
                    disabled={!serverStorageAvailable}
                    disabledReason={filesDisabledReason}
                    onLoadModel={(modelId) => {
                      void loadModelById(modelId);
                    }}
                  />
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
                onClick={() => setShowRulesModal(true)}
                className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-4 text-sm font-semibold text-[color:var(--foreground)] no-underline shadow-sm transition hover:border-[color:var(--viewer-border-strong)] hover:bg-[color:var(--surface-hover)]"
              >
                <ClipboardCheck className="h-4 w-4 shrink-0" />
                <span>Clauses</span>
              </button>
              {hasModel && draftEditCount > 0 ? (
                <HeaderEditsControl
                  draftEditCount={draftEditCount}
                  busy={dataTableActionStatus.phase === "running"}
                  onExportIfc={() => {
                    void handleExportEditedIfc();
                  }}
                  onDiscard={handleClearImportedEdits}
                />
              ) : null}
              <Link
                href="/docs"
                className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-4 text-sm font-semibold text-[color:var(--foreground)] no-underline shadow-sm transition hover:border-[color:var(--viewer-border-strong)] hover:bg-[color:var(--surface-hover)]"
              >
                <BookOpenText className="h-4 w-4 shrink-0" />
                <span>Docs</span>
              </Link>
            </div>
          </div>

        </div>
      </header>

      <div className="flex min-h-0 w-full flex-1 flex-col">
        <main className="flex min-h-0 flex-1">
          <div
            ref={workspaceRef}
            className="corey-blueprint relative -mt-px flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[var(--r-panel)] border border-t-0 border-[color:var(--viewer-border)] shadow-[var(--viewer-shadow)]"
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
                      void runViewportVisibilityAction(async () => {
                        await viewportRef.current?.hideCategory(category);
                      });
                    }}
                    onIsolateCategory={(category) => {
                      void runViewportVisibilityAction(async () => {
                        await viewportRef.current?.isolateCategory(category);
                      });
                    }}
                  />
                )}
              />

              <section className="relative flex min-w-0 flex-1 flex-col">
                <StatusBar
                  placement="top"
                  statusTone={viewerStatusTone}
                  segments={viewerStatusSegments}
                  inspectorLabel="IFC Debug"
                  inspector={
                    <div className="space-y-4">
                      <InspectorDetailList
                        items={[
                          { label: "Active tool", value: session.activeTool },
                          { label: "Validation", value: validationState.message },
                          { label: "Mode", value: validationState.mode ?? "—" },
                        ]}
                      />
                      <JsonInspectorTabs tabs={viewerDebugTabs} />
                    </div>
                  }
                  trailing={
                    <button
                      type="button"
                      onClick={toggleViewerTheme}
                      aria-label={viewerTheme === "dark" ? "Use light theme" : "Use dark theme"}
                      title={viewerTheme === "dark" ? "Use light theme" : "Use dark theme"}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)] transition hover:text-[color:var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
                    >
                      {viewerTheme === "dark" ? (
                        <Sun className="h-3.5 w-3.5" />
                      ) : (
                        <Moon className="h-3.5 w-3.5" />
                      )}
                    </button>
                  }
                />

                <div className="relative min-h-0 flex-1">
                  <IfcViewport
                    ref={viewportRef}
                    embedded
                    theme={viewerTheme}
                    status={status}
                    activeTool={session.activeTool}
                    validationHighlights={validationHighlights}
                    onOpenFile={openFilePicker}
                    openFileLabel={openFileLabel}
                    filesButton={
                      <ServerModelsMenu
                        variant="empty-state"
                        theme={viewerTheme}
                        disabled={!serverStorageAvailable}
                        disabledReason={filesDisabledReason}
                        onLoadModel={(modelId) => {
                          void loadModelById(modelId);
                        }}
                      />
                    }
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
                        setDebugData(initialDebugData);
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
                    onDebugDataChange={(nextDebugData) => {
                      startTransition(() => {
                        setDebugData(nextDebugData);
                      });
                    }}
                  />

                  <ViewerToolbar
                    disabled={!hasModel}
                    dataTableOpen={showDataTable}
                    session={session}
                    status={status}
                    onToggleDataTable={() => {
                      if (showDataTable) {
                        hideDataTable();
                      } else {
                        showDataTableWindow();
                      }
                    }}
                    onToolChange={(tool) => {
                      setSession((current) => ({ ...current, activeTool: tool }));
                      viewportRef.current?.setTool(tool);
                    }}
                    onFocusSelection={() => {
                      void viewportRef.current?.focusSelection();
                    }}
                    onShowAll={() => {
                      void runViewportVisibilityAction(async () => {
                        await viewportRef.current?.showAll();
                      });
                    }}
                    onHideSelection={() => {
                      void runViewportVisibilityAction(async () => {
                        await viewportRef.current?.hideSelection();
                      });
                    }}
                    onIsolateSelection={() => {
                      void runViewportVisibilityAction(async () => {
                        await viewportRef.current?.isolateSelection();
                      });
                    }}
                    onClearSections={() => {
                      viewportRef.current?.clearSections();
                    }}
                    onClearMeasurements={() => {
                      viewportRef.current?.clearMeasurements();
                    }}
                  />
                </div>
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

            {showDataTable && !isDataTableDetached ? (
              <div className="absolute inset-0 z-50 overflow-hidden border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]">
                <div className="flex h-full min-h-0 flex-col bg-[color:var(--panel-bg)] text-[color:var(--foreground)]">
                  {dataTableSurface}
                </div>
              </div>
            ) : null}
            {isDataTableDetached ? (
              <DetachedWindow
                title={`Data Table${metadata ? ` · ${metadata.name}` : ""}`}
                name="corey-data-table"
                width={1}
                height={1}
                fullscreen
                preferExtendedScreen
                onClose={hideDataTable}
                onOpenBlocked={showDataTableDialog}
              >
                <div
                  data-viewer-theme={viewerTheme}
                  style={{
                    // Render the popped-out data table at 67% zoom (more rows/columns visible).
                    // The popup inherits the global `html { zoom: 0.75 }`, so 0.67 / 0.75 nets to
                    // a 67% effective scale; sizing to 100v*/0.67 keeps the surface filling the
                    // window despite the down-scale instead of leaving a gap.
                    zoom: "calc(0.67 / 0.75)",
                    width: "calc(100vw / 0.67)",
                    height: "calc(100vh / 0.67)",
                  }}
                  className="flex min-h-0 flex-col bg-[color:var(--panel-bg)] text-[color:var(--foreground)]"
                >
                  {dataTableSurface}
                </div>
              </DetachedWindow>
            ) : null}
          </div>
        </main>
      </div>
      {serverNotice ? (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-[var(--r-control)] border px-4 py-3 text-sm font-medium shadow-[var(--viewer-shadow-lift)] ${
            serverNotice.tone === "error"
              ? "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]"
              : serverNotice.tone === "success"
                ? "border-[color:var(--accent)] bg-[color:var(--surface-strong)] text-[color:var(--foreground)]"
                : "border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] text-[color:var(--foreground)]"
          }`}
        >
          <span className="min-w-0 flex-1">{serverNotice.message}</span>
          <button
            type="button"
            onClick={() => setServerNotice(null)}
            aria-label="Dismiss notification"
            className="-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {showRulesModal ? <RulesModal onClose={() => setShowRulesModal(false)} /> : null}
    </div>
  );
}
