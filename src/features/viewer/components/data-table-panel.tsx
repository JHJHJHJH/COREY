"use client";

import {
  ChevronDown,
  ClipboardCheck,
  Columns3,
  FilterX,
  PanelTopClose,
  PanelTopOpen,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { StatusBar, type StatusSegment, type StatusTone } from "@/components/status-bar/status-bar";
import { InspectorDetailList } from "@/components/status-bar/status-inspector";
import {
  filterViewerDataTableRows,
  formatBytes,
  getDefaultViewerDataTableColumnKeys,
  sortViewerDataTableRows,
} from "@/features/viewer/lib/ifc-data";
import type {
  ModelMetadata,
  ViewerValidationClauseTableView,
  ViewerDataTableCell,
  ViewerDataTableCellEditRequest,
  ViewerDataTableColumn,
  ViewerDataTableSort,
  ViewerDataTableState,
  ViewerSelection,
} from "@/features/viewer/types";

type DataTablePanelProps = {
  embedded?: boolean;
  metadata: ModelMetadata | null;
  tableState: ViewerDataTableState;
  validationClauseViews: ViewerValidationClauseTableView[];
  selectedValidationClauseId?: string;
  activeSelection: ViewerSelection | null;
  visibleRowKeysInView: Set<string> | null;
  importRevision?: number;
  importedColumnKeys?: string[];
  onSyncToView: () => Promise<void>;
  onValidationClauseChange?: (clauseId: string) => void;
  onEditCell: (edit: ViewerDataTableCellEditRequest) => void;
  onSelectRow: (localId: number) => void;
  showMetaHeader?: boolean;
};

type DataTableUiState = {
  dataSignature: string;
  query: string;
  ifcTypeFilter: string;
  validationClauseId: string;
  showEditedOnly: boolean;
  sort: ViewerDataTableSort | null;
  visibleColumnKeys: string[];
  selectedRowKeys: Set<string>;
};

function validationClauseTone(result: ViewerValidationClauseTableView["result"]) {
  return result === "error"
    ? "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]"
    : "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]";
}

function compactButtonTone(active: boolean) {
  return active
    ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
    : "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-strong)]";
}

function cellTone(state: "present" | "missing" | "empty" | "null" | "undefined") {
  return state === "present"
    ? "text-[color:var(--foreground)]"
    : "text-[color:var(--warning-fg)]";
}

function sortLabel(sort: ViewerDataTableSort | null, columnKey: string) {
  if (!sort || sort.columnKey !== columnKey) {
    return "Sort";
  }

  return sort.direction === "asc" ? "Ascending" : "Descending";
}

function SortIndicator({ sort, columnKey }: { sort: ViewerDataTableSort | null; columnKey: string }) {
  if (!sort || sort.columnKey !== columnKey) {
    return <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">Sort</span>;
  }

  return (
    <span className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
      {sort.direction === "asc" ? "Asc" : "Desc"}
    </span>
  );
}

function buildDataSignature(state: ViewerDataTableState["data"]) {
  if (!state) {
    return "no-data";
  }

  const firstRowKey = state.rows[0]?.key ?? "none";
  const lastRowKey = state.rows[state.rows.length - 1]?.key ?? "none";
  const columnKeys = state.columns.map((column) => column.key).join("|");

  return `${state.rows.length}:${state.columns.length}:${firstRowKey}:${lastRowKey}:${columnKeys}`;
}

function buildDefaultUiState(dataSignature: string, state: ViewerDataTableState["data"]): DataTableUiState {
  return {
    dataSignature,
    query: "",
    ifcTypeFilter: "",
    validationClauseId: "",
    showEditedOnly: false,
    sort: null,
    visibleColumnKeys: state ? getDefaultViewerDataTableColumnKeys(state.columns) : [],
    selectedRowKeys: new Set<string>(),
  };
}

function rowHasImportedEdits(row: NonNullable<ViewerDataTableState["data"]>["rows"][number]) {
  return Object.values(row.cells).some((cell) => cell.source === "draft");
}

function cellInputValue(cell: ViewerDataTableCell | undefined) {
  if (!cell || cell.state !== "present") {
    return "";
  }

  if (
    typeof cell.raw === "string" ||
    typeof cell.raw === "number" ||
    typeof cell.raw === "boolean"
  ) {
    return String(cell.raw);
  }

  return cell.text;
}

type EditableDataTableCellProps = {
  rowKey: string;
  rowLabel: string;
  column: ViewerDataTableColumn;
  cell: ViewerDataTableCell | undefined;
  onEditCell: (edit: ViewerDataTableCellEditRequest) => void;
};

function EditableDataTableCell({
  rowKey,
  rowLabel,
  column,
  cell,
  onEditCell,
}: EditableDataTableCellProps) {
  const value = cellInputValue(cell);

  const commitValue = (nextValue: string) => {
    if (nextValue === value) {
      return;
    }

    onEditCell({
      rowKey,
      columnKey: column.key,
      raw: nextValue,
    });
  };

  return (
    <input
      key={`${cell?.source ?? "none"}:${cell?.state ?? "missing"}:${cell?.text ?? ""}`}
      defaultValue={value}
      onBlur={(event) => commitValue(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.currentTarget.value = value;
          event.currentTarget.blur();
        }
      }}
      aria-label={`Edit ${column.label} for ${rowLabel}`}
      className="min-h-8 w-full min-w-[10rem] rounded-lg border border-transparent bg-transparent px-2 py-1 font-mono text-[12px] leading-5 text-current outline-none transition hover:border-[color:var(--viewer-border)] hover:bg-[color:var(--surface-soft)] focus:border-[color:var(--accent)] focus:bg-[color:var(--surface-strong)]"
    />
  );
}

type DataTableContentProps = {
  data: ViewerDataTableState["data"];
  tablePhase: ViewerDataTableState["phase"];
  tableMessage: string;
  visibleRows: NonNullable<ViewerDataTableState["data"]>["rows"];
  visibleColumns: ViewerDataTableColumn[];
  activeSelection: ViewerSelection | null;
  selectedRowKeys: Set<string>;
  sort: ViewerDataTableSort | null;
  allVisibleSelected: boolean;
  selectAllRef: RefObject<HTMLInputElement | null>;
  onToggleAllVisibleRows: () => void;
  onToggleSort: (columnKey: string) => void;
  onToggleRow: (rowKey: string) => void;
  onEditCell: (edit: ViewerDataTableCellEditRequest) => void;
  onSelectRow: (localId: number) => void;
};

const DataTableContent = memo(function DataTableContent({
  data,
  tablePhase,
  tableMessage,
  visibleRows,
  visibleColumns,
  activeSelection,
  selectedRowKeys,
  sort,
  allVisibleSelected,
  selectAllRef,
  onToggleAllVisibleRows,
  onToggleSort,
  onToggleRow,
  onEditCell,
  onSelectRow,
}: DataTableContentProps) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {!data && tablePhase === "loading" ? (
        <div className="flex h-full items-center justify-center px-5 py-6">
          <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-6 py-6 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--warning-fg)]">
              Loading Table
            </div>
            <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
              Building the IFC data table
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--warning-fg)]">{tableMessage}</p>
          </div>
        </div>
      ) : !data && tablePhase === "error" ? (
        <div className="flex h-full items-center justify-center px-5 py-6">
          <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-6 py-6 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--danger-fg)]">
              Table Unavailable
            </div>
            <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
              The data table could not be indexed
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--danger-fg)]">{tableMessage}</p>
          </div>
        </div>
      ) : !data ? (
        <div className="flex h-full items-center justify-center px-5 py-6">
          <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-6 py-6 text-center shadow-[inset_0_1px_0_var(--hairline)]">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              No Table Data
            </div>
            <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
              Load an IFC model to populate the review grid
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">
              The table view will flatten IFC attributes and property sets into reusable review
              columns once a model is indexed.
            </p>
          </div>
        </div>
      ) : data.rows.length === 0 ? (
        <div className="flex h-full items-center justify-center px-5 py-6">
          <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-6 py-6 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              Empty Model Table
            </div>
            <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
              No geometry-backed IFC elements were found
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">
              The model loaded, but the viewer did not find elements with geometry to index into
              the review grid.
            </p>
          </div>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="flex h-full items-center justify-center px-5 py-6">
          <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-6 py-6 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              No Matching Rows
            </div>
            <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
              The current filters hide every element
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">
              Adjust the text filter, IFC type filter, validation clause view, edited-only
              toggle, or visible columns to bring matching rows back into view.
            </p>
          </div>
        </div>
      ) : (
        <div className="h-full overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left">
            <thead className="sticky top-0 z-10 bg-[color:var(--panel-bg)]">
              <tr>
                <th className="w-12 border-b border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={onToggleAllVisibleRows}
                    className="h-4 w-4 rounded border-[color:var(--viewer-border)] text-[color:var(--accent)]"
                    aria-label="Select all visible rows"
                  />
                </th>
                {visibleColumns.map((column) => (
                  <th
                    key={column.key}
                    aria-sort={
                      sort?.columnKey === column.key
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className="min-w-[12rem] border-b border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-3 align-bottom"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleSort(column.key)}
                      className="flex w-full items-end justify-between gap-3 text-left"
                      aria-label={`${sortLabel(sort, column.key)} by ${column.label}`}
                    >
                      <span className="min-w-0">
                        {column.group ? (
                          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                            {column.group}
                          </span>
                        ) : null}
                        <span className="mt-1 block break-words text-sm font-semibold text-[color:var(--foreground)]">
                          {column.label}
                        </span>
                      </span>
                      <SortIndicator sort={sort} columnKey={column.key} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {visibleRows.map((row) => {
                const checked = selectedRowKeys.has(row.key);
                const selected = activeSelection?.localId === row.localId;

                return (
                  <tr
                    key={row.key}
                    onClick={() => onSelectRow(row.localId)}
                    className={`cursor-pointer transition hover:bg-[color:var(--surface-soft)] ${
                      selected
                        ? "bg-[color:var(--accent-wash)]"
                        : checked
                          ? "bg-[color:var(--surface-strong)]"
                          : "bg-transparent"
                    }`}
                  >
                    <td className="border-b border-[color:var(--viewer-border)] px-3 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleRow(row.key)}
                        onClick={(event) => event.stopPropagation()}
                        className="h-4 w-4 rounded border-[color:var(--viewer-border)] text-[color:var(--accent)]"
                        aria-label={`Select row ${row.localId}`}
                      />
                    </td>
                    {visibleColumns.map((column) => {
                      const cell = row.cells[column.key];
                      const draftCell = cell?.source === "draft";
                      const editable = column.editable && Boolean(column.binding);

                      return (
                        <td
                          key={column.key}
                          className={`border-b border-[color:var(--viewer-border)] px-3 py-3 align-top text-sm ${
                            draftCell
                              ? "bg-[color:var(--success-bg)] text-[color:var(--success-fg)]"
                              : cell
                                ? cellTone(cell.state)
                                : "text-[color:var(--muted-ink)]"
                          }`}
                        >
                          {editable ? (
                            <EditableDataTableCell
                              rowKey={row.key}
                              rowLabel={row.selection.label}
                              column={column}
                              cell={cell}
                              onEditCell={onEditCell}
                            />
                          ) : (
                            <div className="min-w-0 break-words font-mono text-[12px] leading-5">
                              {cell?.text ?? "MISSING"}
                            </div>
                          )}
                          {draftCell ? (
                            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--success-fg)]">
                              Edited
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});
DataTableContent.displayName = "DataTableContent";

const DataTablePanelComponent = function DataTablePanel({
  embedded = false,
  metadata,
  tableState,
  validationClauseViews,
  selectedValidationClauseId = "",
  activeSelection,
  visibleRowKeysInView,
  importRevision = 0,
  importedColumnKeys = [],
  onSyncToView,
  onValidationClauseChange,
  onEditCell,
  onSelectRow,
  showMetaHeader = true,
}: DataTablePanelProps) {
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const clauseMenuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const data = tableState.data;
  const dataSignature = useMemo(() => buildDataSignature(data), [data]);
  const [uiState, setUiState] = useState<DataTableUiState>(() =>
    buildDefaultUiState(dataSignature, data),
  );
  const activeUiState =
    uiState.dataSignature === dataSignature ? uiState : buildDefaultUiState(dataSignature, data);
  const deferredQuery = useDeferredValue(activeUiState.query);
  const deferredIfcTypeFilter = useDeferredValue(activeUiState.ifcTypeFilter);
  const [isSyncingToView, setIsSyncingToView] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showClauseMenu, setShowClauseMenu] = useState(false);
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const updateUiState = useCallback((updater: (current: DataTableUiState) => DataTableUiState) => {
    setUiState((current) => {
      const base =
        current.dataSignature === dataSignature
          ? current
          : buildDefaultUiState(dataSignature, data);
      return updater(base);
    });
  }, [data, dataSignature]);
  const activeClauseView = useMemo(
    () =>
      validationClauseViews.find((clause) => clause.clauseId === activeUiState.validationClauseId) ??
      null,
    [activeUiState.validationClauseId, validationClauseViews],
  );
  const activeClauseRowKeySet = useMemo(
    () => (activeClauseView ? new Set(activeClauseView.rowKeys) : null),
    [activeClauseView],
  );

  const visibleColumns = useMemo(() => {
    if (!data) {
      return [];
    }

    const visibleKeySet = new Set(activeUiState.visibleColumnKeys);
    return data.columns.filter(
      (column) => column.kind === "base" || visibleKeySet.has(column.key),
    );
  }, [activeUiState.visibleColumnKeys, data]);

  const filteredRows = useMemo(() => {
    if (!data) {
      return [];
    }

    let nextRows = filterViewerDataTableRows(data.rows, {
      query: deferredQuery,
      ifcType: deferredIfcTypeFilter,
    });
    if (activeClauseRowKeySet) {
      nextRows = nextRows.filter((row) => activeClauseRowKeySet.has(row.key));
    }
    if (activeUiState.showEditedOnly) {
      nextRows = nextRows.filter(rowHasImportedEdits);
    }
    if (visibleRowKeysInView) {
      nextRows = nextRows.filter((row) => visibleRowKeysInView.has(row.key));
    }
    return nextRows;
  }, [
    activeClauseRowKeySet,
    activeUiState.showEditedOnly,
    data,
    deferredIfcTypeFilter,
    deferredQuery,
    visibleRowKeysInView,
  ]);

  const editedRowCount = useMemo(
    () => (data ? data.rows.filter(rowHasImportedEdits).length : 0),
    [data],
  );
  const dynamicColumns = useMemo(
    () => data?.columns.filter((column) => column.kind !== "base") ?? [],
    [data],
  );
  const visibleDynamicColumnCount = useMemo(
    () =>
      dynamicColumns.filter((column) => activeUiState.visibleColumnKeys.includes(column.key)).length,
    [activeUiState.visibleColumnKeys, dynamicColumns],
  );
  const defaultVisibleColumnKeys = useMemo(
    () => (data ? getDefaultViewerDataTableColumnKeys(data.columns) : []),
    [data],
  );
  const hasCustomVisibleColumns = useMemo(() => {
    if (!data) {
      return false;
    }

    const current = new Set(activeUiState.visibleColumnKeys);
    const defaults = new Set(defaultVisibleColumnKeys);
    if (current.size !== defaults.size) {
      return true;
    }

    for (const key of defaults) {
      if (!current.has(key)) {
        return true;
      }
    }

    return false;
  }, [activeUiState.visibleColumnKeys, data, defaultVisibleColumnKeys]);

  const visibleRows = useMemo(
    () => sortViewerDataTableRows(filteredRows, activeUiState.sort),
    [activeUiState.sort, filteredRows],
  );

  const allVisibleSelected =
    visibleRows.length > 0 &&
    visibleRows.every((row) => activeUiState.selectedRowKeys.has(row.key));
  const someVisibleSelected = visibleRows.some((row) =>
    activeUiState.selectedRowKeys.has(row.key),
  );

  const dataTableTone: StatusTone =
    tableState.phase === "error"
      ? "error"
      : tableState.phase === "loading"
        ? "warn"
        : tableState.phase === "loaded"
          ? "success"
          : "muted";

  const statusSegments = useMemo<StatusSegment[]>(() => {
    const segments: StatusSegment[] = [];

    if (showMetaHeader && metadata) {
      segments.push({ id: "model", label: metadata.name, tone: "default" });
    }

    segments.push(
      { id: "elements", label: `${data?.rows.length ?? 0} elements` },
      { id: "columns", label: `${data?.columns.length ?? 0} columns` },
      { id: "shown", label: `${visibleRows.length} shown` },
      { id: "edited", label: `${editedRowCount} edited` },
      { id: "selected", label: `${activeUiState.selectedRowKeys.size} selected` },
    );

    if (activeClauseView) {
      segments.push({
        id: "clause",
        label: `Clause: ${activeClauseView.clauseTitle}`,
        tone: "default",
        title: activeClauseView.clauseTitle,
      });
    }

    return segments;
  }, [
    activeClauseView,
    activeUiState.selectedRowKeys.size,
    data?.columns.length,
    data?.rows.length,
    editedRowCount,
    metadata,
    showMetaHeader,
    visibleRows.length,
  ]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !allVisibleSelected && someVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  useEffect(() => {
    if (!showClauseMenu && !showColumnMenu) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (showClauseMenu && clauseMenuRef.current?.contains(target)) {
        return;
      }

      if (showColumnMenu && columnMenuRef.current?.contains(target)) {
        return;
      }

      setShowClauseMenu(false);
      setShowColumnMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowClauseMenu(false);
        setShowColumnMenu(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showClauseMenu, showColumnMenu]);

  useEffect(() => {
    if (showFilters) {
      return;
    }

    setShowClauseMenu(false);
    setShowColumnMenu(false);
  }, [showFilters]);

  useEffect(() => {
    if (selectedValidationClauseId === activeUiState.validationClauseId) {
      return;
    }

    updateUiState((current) => ({
      ...current,
      validationClauseId: selectedValidationClauseId,
      selectedRowKeys: new Set<string>(),
    }));
  }, [activeUiState.validationClauseId, selectedValidationClauseId, updateUiState]);

  useEffect(() => {
    if (importRevision === 0 || importedColumnKeys.length === 0) {
      return;
    }

    updateUiState((current) => {
      const nextVisibleColumnKeys = new Set(current.visibleColumnKeys);
      for (const columnKey of importedColumnKeys) {
        nextVisibleColumnKeys.add(columnKey);
      }

      return {
        ...current,
        query: "",
        ifcTypeFilter: "",
        validationClauseId: "",
        showEditedOnly: true,
        visibleColumnKeys: [...nextVisibleColumnKeys],
        selectedRowKeys: new Set<string>(),
      };
    });
    onValidationClauseChange?.("");
  }, [importRevision, importedColumnKeys, onValidationClauseChange, updateUiState]);

  useEffect(() => {
    if (!activeUiState.validationClauseId) {
      return;
    }

    if (validationClauseViews.some((clause) => clause.clauseId === activeUiState.validationClauseId)) {
      return;
    }

    updateUiState((current) => ({
      ...current,
      validationClauseId: "",
    }));
    onValidationClauseChange?.("");
  }, [activeUiState.validationClauseId, onValidationClauseChange, updateUiState, validationClauseViews]);

  const toggleSort = useCallback((columnKey: string) => {
    updateUiState((current) => {
      if (!current.sort || current.sort.columnKey !== columnKey) {
        return { ...current, sort: { columnKey, direction: "asc" } };
      }

      if (current.sort?.direction === "asc") {
        return { ...current, sort: { columnKey, direction: "desc" } };
      }

      return { ...current, sort: null };
    });
  }, [updateUiState]);

  const toggleRow = useCallback((rowKey: string) => {
    updateUiState((current) => {
      const next = new Set(current.selectedRowKeys);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return { ...current, selectedRowKeys: next };
    });
  }, [updateUiState]);

  const toggleAllVisibleRows = useCallback(() => {
    updateUiState((current) => {
      const next = new Set(current.selectedRowKeys);
      if (allVisibleSelected) {
        for (const row of visibleRows) {
          next.delete(row.key);
        }
      } else {
        for (const row of visibleRows) {
          next.add(row.key);
        }
      }
      return { ...current, selectedRowKeys: next };
    });
  }, [allVisibleSelected, updateUiState, visibleRows]);

  const toggleColumn = (columnKey: string) => {
    updateUiState((current) => {
      const next = new Set(current.visibleColumnKeys);
      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      return { ...current, visibleColumnKeys: [...next] };
    });
  };

  const handleSyncToView = async () => {
    setIsSyncingToView(true);
    try {
      await onSyncToView();
    } finally {
      setIsSyncingToView(false);
    }
  };

  const setValidationClauseFilter = (clauseId: string) => {
    updateUiState((current) => ({
      ...current,
      validationClauseId: clauseId,
      selectedRowKeys: new Set<string>(),
    }));
    onValidationClauseChange?.(clauseId);
    setShowClauseMenu(false);
  };

  const resetFilters = async () => {
    updateUiState((current) => ({
      ...current,
      query: "",
      ifcTypeFilter: "",
      validationClauseId: "",
      showEditedOnly: false,
    }));
    onValidationClauseChange?.("");
    setShowClauseMenu(false);
    setShowColumnMenu(false);

    if (visibleRowKeysInView) {
      setIsSyncingToView(true);
      try {
        await onSyncToView();
      } finally {
        setIsSyncingToView(false);
      }
    }
  };

  const hasActiveFilters =
    Boolean(activeUiState.query.trim()) ||
    Boolean(activeUiState.ifcTypeFilter) ||
    Boolean(activeUiState.validationClauseId) ||
    activeUiState.showEditedOnly ||
    Boolean(visibleRowKeysInView);
  const clauseSummary = activeClauseView ? activeClauseView.clauseTitle : "All rows";
  const columnSummary =
    dynamicColumns.length === 0
      ? "No dynamic columns"
      : `${visibleDynamicColumnCount} of ${dynamicColumns.length} visible`;
  const showClearChecked = activeUiState.selectedRowKeys.size > 0;
  const activeFilterLabels = [
    activeUiState.query.trim() ? "Search" : null,
    activeUiState.ifcTypeFilter || null,
    activeClauseView ? "Clause" : null,
    activeUiState.showEditedOnly ? "Edited only" : null,
    visibleRowKeysInView ? "View synced" : null,
  ].filter((value): value is string => Boolean(value));
  const FiltersToggleIcon = showFilters ? PanelTopClose : PanelTopOpen;

  return (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden ${
        embedded
          ? "bg-[color:var(--panel-bg)]/96"
          : "rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]"
      }`}
    >
      <div
        id="table-filters"
        className="relative z-20 border-b border-[color:var(--viewer-border)] px-4 py-3"
      >
        <div className="rounded-[1.4rem] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] p-3 shadow-[inset_0_1px_0_var(--hairline)]">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                  Table Filters
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--muted-ink)]">
                  <span>{showFilters ? "Expanded" : "Collapsed"}</span>
                  {activeFilterLabels.length > 0 ? (
                    <span>{activeFilterLabels.length} active</span>
                  ) : (
                    <span>No active filters</span>
                  )}
                  {!showFilters
                    ? activeFilterLabels.slice(0, 3).map((label) => (
                        <span
                          key={label}
                          className="rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 py-1"
                        >
                          {label}
                        </span>
                      ))
                    : null}
                </div>
              </div>

              <div className="min-w-[16rem] flex-1">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-ink)]"
                    aria-hidden="true"
                  />
                  <input
                    value={activeUiState.query}
                    onChange={(event) =>
                      updateUiState((current) => ({ ...current, query: event.target.value }))
                    }
                    placeholder="Filter by element values, attributes, or property set values"
                    aria-label="Filter table rows"
                    disabled={!data}
                    className="h-10 w-full rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] py-2 pl-11 pr-10 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-ink)] focus:border-[color:var(--accent)] focus:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {activeUiState.query ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateUiState((current) => ({
                          ...current,
                          query: "",
                        }))
                      }
                      className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                      aria-label="Clear text filter"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>

              {hasActiveFilters ? (
                <div className="flex h-10 min-w-[18rem] max-w-[24rem] shrink-0 items-center gap-2 rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 text-[11px] text-[color:var(--muted-ink)]">
                  <span className="shrink-0 font-semibold uppercase tracking-[0.16em] text-[color:var(--foreground)]">
                    Active Filters
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                    {activeFilterLabels.map((label) => (
                      <span
                        key={label}
                        className="shrink-0 rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 py-1"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void resetFilters();
                    }}
                    disabled={!data || isSyncingToView}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-3 py-1 font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)] transition hover:border-[color:var(--accent)] hover:bg-[color:var(--accent-wash)] hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FilterX className="h-3.5 w-3.5" />
                    Reset
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                aria-controls="table-filters-content"
                aria-expanded={showFilters}
                onClick={() => setShowFilters((current) => !current)}
                className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
                aria-label={showFilters ? "Collapse filters drawer" : "Expand filters drawer"}
                title={showFilters ? "Collapse filters" : "Expand filters"}
              >
                <FiltersToggleIcon className="h-4 w-4" />
              </button>
            </div>

            <div
              id="table-filters-content"
              aria-hidden={!showFilters}
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                showFilters ? "grid-rows-[1fr] overflow-visible" : "grid-rows-[0fr] overflow-hidden"
              }`}
            >
              <div className={`min-h-0 ${showFilters ? "overflow-visible" : "overflow-hidden"}`}>
                <div
                  className={`flex flex-nowrap items-end gap-3 transition-[opacity,transform] duration-200 ease-out ${
                    showFilters ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
                  }`}
                >
                  <label className="w-[16rem] shrink-0">
                    <select
                      value={activeUiState.ifcTypeFilter}
                      onChange={(event) =>
                        updateUiState((current) => ({
                          ...current,
                          ifcTypeFilter: event.target.value,
                        }))
                      }
                      disabled={!data}
                      className="w-full rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] focus:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">All IFC types</option>
                      {data?.ifcTypes.map((ifcType) => (
                        <option key={ifcType} value={ifcType}>
                          {ifcType}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex shrink-0 items-center gap-2">
                    <div className="relative" ref={clauseMenuRef}>
                      <button
                        type="button"
                        aria-expanded={showClauseMenu}
                        onClick={() => {
                          setShowClauseMenu((current) => !current);
                          setShowColumnMenu(false);
                        }}
                        disabled={!data}
                        className={`inline-flex max-w-full items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${activeClauseView ? validationClauseTone(activeClauseView.result) : compactButtonTone(showClauseMenu)}`}
                      >
                        <ClipboardCheck className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 truncate">
                          {activeClauseView ? activeClauseView.clauseTitle : "Clauses"}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 transition ${showClauseMenu ? "rotate-180" : ""}`}
                        />
                      </button>

                      {showClauseMenu ? (
                        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-[min(28rem,85vw)] rounded-[1.25rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] p-3 shadow-[var(--viewer-shadow)]">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                                Validation Clauses
                              </div>
                              <div className="mt-1 text-[11px] text-[color:var(--muted-ink)]">
                                {clauseSummary}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowClauseMenu(false)}
                              className="flex h-8 w-8 items-center justify-center rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                              aria-label="Close validation clause filter"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="mt-3 space-y-2">
                            <button
                              type="button"
                              onClick={() => setValidationClauseFilter("")}
                              className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left text-sm transition ${
                                activeClauseView
                                  ? "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-strong)]"
                                  : "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
                              }`}
                            >
                              <span className="font-medium">Show all rows</span>
                              <span className="text-[11px] uppercase tracking-[0.16em]">
                                {data?.rows.length ?? 0} elements
                              </span>
                            </button>

                            {validationClauseViews.length > 0 ? (
                              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                                {validationClauseViews.map((clause) => (
                                  <button
                                    key={clause.clauseId}
                                    type="button"
                                    onClick={() => setValidationClauseFilter(clause.clauseId)}
                                    className={`flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left text-sm transition ${
                                      activeClauseView?.clauseId === clause.clauseId
                                        ? validationClauseTone(clause.result)
                                        : "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-strong)]"
                                    }`}
                                  >
                                    <span className="min-w-0">
                                      <span className="block break-words font-medium">{clause.clauseTitle}</span>
                                      <span className="mt-1 block text-[11px] uppercase tracking-[0.16em]">
                                        {clause.result}
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-[11px] uppercase tracking-[0.16em]">
                                      {clause.elementCount} elements
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-4 text-sm text-[color:var(--muted-ink)]">
                                Run validation to filter the table by clause.
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      disabled={!data || editedRowCount === 0}
                      onClick={() =>
                        updateUiState((current) => ({
                          ...current,
                          showEditedOnly: !current.showEditedOnly,
                        }))
                      }
                      className={`rounded-2xl border px-3.5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${compactButtonTone(activeUiState.showEditedOnly)}`}
                    >
                      Show edited only
                    </button>

                    <button
                      type="button"
                      disabled={!data || isSyncingToView}
                      onClick={() => {
                        void handleSyncToView();
                      }}
                      className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${compactButtonTone(Boolean(visibleRowKeysInView))}`}
                    >
                      <RefreshCw className={`h-4 w-4 ${isSyncingToView ? "animate-spin" : ""}`} />
                      {isSyncingToView ? "Syncing view..." : "Sync to view"}
                    </button>

                    <div className="relative" ref={columnMenuRef}>
                      <button
                        type="button"
                        aria-expanded={showColumnMenu}
                        onClick={() => {
                          setShowColumnMenu((current) => !current);
                          setShowClauseMenu(false);
                        }}
                        disabled={!data}
                        className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${compactButtonTone(showColumnMenu || hasCustomVisibleColumns)}`}
                      >
                        <Columns3 className="h-4 w-4 shrink-0" />
                        <span>Columns</span>
                        {dynamicColumns.length > 0 ? (
                          <span className="rounded-full bg-[color:var(--accent-wash)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--accent-strong)]">
                            {visibleDynamicColumnCount}
                          </span>
                        ) : null}
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 transition ${showColumnMenu ? "rotate-180" : ""}`}
                        />
                      </button>

                      {showColumnMenu ? (
                        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[min(30rem,85vw)] rounded-[1.25rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] p-3 shadow-[var(--viewer-shadow)]">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                                Visible Columns
                              </div>
                              <div className="mt-1 text-[11px] text-[color:var(--muted-ink)]">
                                {columnSummary}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={!data}
                                onClick={() => {
                                  updateUiState((current) => ({
                                    ...current,
                                    visibleColumnKeys: defaultVisibleColumnKeys,
                                  }));
                                }}
                                className="rounded-full border border-[color:var(--viewer-border)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Reset
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowColumnMenu(false)}
                                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                                aria-label="Close columns menu"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                            {dynamicColumns.map((column) => (
                              <label
                                key={column.key}
                                className="flex items-start gap-3 rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-3 text-sm text-[color:var(--foreground)]"
                              >
                                <input
                                  type="checkbox"
                                  checked={activeUiState.visibleColumnKeys.includes(column.key)}
                                  onChange={() => toggleColumn(column.key)}
                                  className="mt-0.5 h-4 w-4 rounded border-[color:var(--viewer-border)] text-[color:var(--accent)]"
                                />
                                <span className="min-w-0">
                                  <span className="block break-words font-medium">{column.label}</span>
                                  <span className="mt-1 block text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                                    {column.group ?? column.kind}
                                  </span>
                                </span>
                              </label>
                            ))}
                            {dynamicColumns.length === 0 ? (
                              <div className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-4 text-sm text-[color:var(--muted-ink)]">
                                Load a model to discover dynamic columns.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {showClearChecked ? (
                      <button
                        type="button"
                        onClick={() =>
                          updateUiState((current) => ({ ...current, selectedRowKeys: new Set() }))
                        }
                        className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3.5 py-2.5 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
                      >
                        Clear checked
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <DataTableContent
        data={data}
        tablePhase={tableState.phase}
        tableMessage={tableState.message}
        visibleRows={visibleRows}
        visibleColumns={visibleColumns}
        activeSelection={activeSelection}
        selectedRowKeys={activeUiState.selectedRowKeys}
        sort={activeUiState.sort}
        allVisibleSelected={allVisibleSelected}
        selectAllRef={selectAllRef}
        onToggleAllVisibleRows={toggleAllVisibleRows}
        onToggleSort={toggleSort}
        onToggleRow={toggleRow}
        onEditCell={onEditCell}
        onSelectRow={onSelectRow}
      />

      <StatusBar
        statusTone={dataTableTone}
        segments={statusSegments}
        inspector={
          <InspectorDetailList
            items={[
              { label: "Phase", value: tableState.phase },
              { label: "Message", value: tableState.message || "—" },
              { label: "Model", value: metadata?.name ?? "—" },
              { label: "Size", value: metadata ? formatBytes(metadata.size) : "—" },
              { label: "Clause view", value: activeClauseView?.clauseTitle ?? "None" },
            ]}
          />
        }
      />
    </aside>
  );
};

export const DataTablePanel = memo(DataTablePanelComponent);
DataTablePanel.displayName = "DataTablePanel";
