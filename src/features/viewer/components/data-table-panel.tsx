"use client";

import { RefreshCw } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  filterViewerDataTableRows,
  formatBytes,
  getDefaultViewerDataTableColumnKeys,
  sortViewerDataTableRows,
} from "@/features/viewer/lib/ifc-data";
import type {
  ModelMetadata,
  ViewerDataTableColumn,
  ViewerDataTableSort,
  ViewerDataTableState,
  ViewerSelection,
} from "@/features/viewer/types";

type DataTablePanelProps = {
  embedded?: boolean;
  metadata: ModelMetadata | null;
  tableState: ViewerDataTableState;
  activeSelection: ViewerSelection | null;
  visibleRowKeysInView: Set<string> | null;
  importRevision?: number;
  importedColumnKeys?: string[];
  onSyncToView: () => Promise<void>;
  onSelectRow: (localId: number) => void;
  showMetaHeader?: boolean;
};

type DataTableUiState = {
  dataSignature: string;
  query: string;
  ifcTypeFilter: string;
  showEditedOnly: boolean;
  sort: ViewerDataTableSort | null;
  visibleColumnKeys: string[];
  selectedRowKeys: Set<string>;
};

function statusTone(phase: ViewerDataTableState["phase"]) {
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

function cellTone(column: ViewerDataTableColumn, state: "present" | "missing" | "empty" | "null" | "undefined") {
  if (state !== "present") {
    return "text-[#915217]";
  }

  if (column.kind === "base") {
    return "text-[color:var(--foreground)]";
  }

  return "text-[color:var(--foreground)]";
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
    showEditedOnly: false,
    sort: null,
    visibleColumnKeys: state ? getDefaultViewerDataTableColumnKeys(state.columns) : [],
    selectedRowKeys: new Set<string>(),
  };
}

function rowHasImportedEdits(row: NonNullable<ViewerDataTableState["data"]>["rows"][number]) {
  return Object.values(row.cells).some((cell) => cell.source === "draft");
}

const DataTablePanelComponent = function DataTablePanel({
  embedded = false,
  metadata,
  tableState,
  activeSelection,
  visibleRowKeysInView,
  importRevision = 0,
  importedColumnKeys = [],
  onSyncToView,
  onSelectRow,
  showMetaHeader = true,
}: DataTablePanelProps) {
  const selectAllRef = useRef<HTMLInputElement | null>(null);
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

  const updateUiState = useCallback((updater: (current: DataTableUiState) => DataTableUiState) => {
    setUiState((current) => {
      const base =
        current.dataSignature === dataSignature
          ? current
          : buildDefaultUiState(dataSignature, data);
      return updater(base);
    });
  }, [data, dataSignature]);

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
    if (activeUiState.showEditedOnly) {
      nextRows = nextRows.filter(rowHasImportedEdits);
    }
    if (visibleRowKeysInView) {
      nextRows = nextRows.filter((row) => visibleRowKeysInView.has(row.key));
    }
    return nextRows;
  }, [activeUiState.showEditedOnly, data, deferredIfcTypeFilter, deferredQuery, visibleRowKeysInView]);

  const editedRowCount = useMemo(
    () => (data ? data.rows.filter(rowHasImportedEdits).length : 0),
    [data],
  );

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

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !allVisibleSelected && someVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

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
        showEditedOnly: true,
        visibleColumnKeys: [...nextVisibleColumnKeys],
        selectedRowKeys: new Set<string>(),
      };
    });
  }, [importRevision, importedColumnKeys, updateUiState]);

  const toggleSort = (columnKey: string) => {
    updateUiState((current) => {
      if (!current.sort || current.sort.columnKey !== columnKey) {
        return { ...current, sort: { columnKey, direction: "asc" } };
      }

      if (current.sort?.direction === "asc") {
        return { ...current, sort: { columnKey, direction: "desc" } };
      }

      return { ...current, sort: null };
    });
  };

  const toggleRow = (rowKey: string) => {
    updateUiState((current) => {
      const next = new Set(current.selectedRowKeys);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return { ...current, selectedRowKeys: next };
    });
  };

  const toggleAllVisibleRows = () => {
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
  };

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

  return (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden ${
        embedded
          ? "bg-[color:var(--panel-bg)]/96"
          : "rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]"
      }`}
    >
      <div id="dev-stats" className="border-b border-[color:var(--viewer-border)] px-4 py-3">
        {showMetaHeader ? (
          <div className="flex flex-wrap gap-2 text-[11px] font-medium tracking-[0.08em]">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 uppercase ${statusTone(tableState.phase)}`}
            >
              {tableState.phase}
            </span>
            {metadata ? (
              <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-3 py-1 text-[color:var(--muted-ink)]">
                {metadata.name}
              </span>
            ) : null}
            {metadata ? (
              <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-white/70 px-3 py-1 text-[color:var(--muted-ink)]">
                {formatBytes(metadata.size)}
              </span>
            ) : null}
          </div>
        ) : null}

        <div
          className={`flex flex-wrap gap-x-3 gap-y-1 text-xs text-[color:var(--muted-ink)] ${
            showMetaHeader ? "mt-3" : ""
          }`}
        >
          <span>{data?.rows.length ?? 0} elements</span>
          <span>{data?.columns.length ?? 0} columns discovered</span>
          <span>{visibleRows.length} visible rows</span>
          <span>{editedRowCount} edited rows</span>
          <span>{activeUiState.selectedRowKeys.size} checked rows</span>
          <span>{tableState.message}</span>
        </div>

        
      </div>

      <div className="border-b border-[color:var(--viewer-border)] px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              Text Filter
            </span>
            <input
              value={activeUiState.query}
              onChange={(event) =>
                updateUiState((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="Filter by element values, attributes, or property set values"
              disabled={!data}
              className="w-full rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-ink)] focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          <label className="w-full min-w-[14rem] sm:w-auto">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              IFC Type
            </span>
            <select
              value={activeUiState.ifcTypeFilter}
              onChange={(event) =>
                updateUiState((current) => ({
                  ...current,
                  ifcTypeFilter: event.target.value,
                }))
              }
              disabled={!data}
              className="w-full rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[14rem]"
            >
              <option value="">All IFC types</option>
              {data?.ifcTypes.map((ifcType) => (
                <option key={ifcType} value={ifcType}>
                  {ifcType}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={!data || editedRowCount === 0}
            onClick={() =>
              updateUiState((current) => ({
                ...current,
                showEditedOnly: !current.showEditedOnly,
              }))
            }
            className={`rounded-2xl border px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              activeUiState.showEditedOnly
                ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
                : "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-strong)]"
            }`}
          >
            Show edited only
          </button>

          <button
            type="button"
            disabled={!data || isSyncingToView}
            onClick={() => {
              void handleSyncToView();
            }}
            className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              visibleRowKeysInView
                ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
                : "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-strong)]"
            }`}
          >
            <RefreshCw className={`h-4 w-4 ${isSyncingToView ? "animate-spin" : ""}`} />
            {isSyncingToView ? "Syncing view..." : "Sync to view"}
          </button>

          <details className="relative">
            <summary className="list-none rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]">
              Columns
            </summary>
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-[min(30rem,85vw)] rounded-[1.25rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] p-4 shadow-[var(--viewer-shadow)]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                  Visible Columns
                </div>
                <button
                  type="button"
                  disabled={!data}
                  onClick={() => {
                    updateUiState((current) => ({
                      ...current,
                      visibleColumnKeys: data
                        ? getDefaultViewerDataTableColumnKeys(data.columns)
                        : [],
                    }));
                  }}
                  className="rounded-full border border-[color:var(--viewer-border)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset
                </button>
              </div>

              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {data?.columns.filter((column) => column.kind !== "base").map((column) => (
                  <label
                    key={column.key}
                    className="flex items-start gap-3 rounded-2xl border border-[color:var(--viewer-border)] bg-white/55 px-3 py-3 text-sm text-[color:var(--foreground)]"
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
                {!data?.columns.some((column) => column.kind !== "base") ? (
                  <div className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-4 text-sm text-[color:var(--muted-ink)]">
                    Load a model to discover dynamic columns.
                  </div>
                ) : null}
              </div>
            </div>
          </details>

          <button
            type="button"
            disabled={activeUiState.selectedRowKeys.size === 0}
            onClick={() =>
              updateUiState((current) => ({ ...current, selectedRowKeys: new Set() }))
            }
            className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 py-3 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear checked
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {!data && tableState.phase === "loading" ? (
          <div className="flex h-full items-center justify-center px-5 py-6">
            <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[#d8af80] bg-[#fff7ed] px-6 py-6 text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#915217]">
                Loading Table
              </div>
              <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
                Building the IFC data table
              </div>
              <p className="mt-2 text-sm leading-6 text-[#915217]">{tableState.message}</p>
            </div>
          </div>
        ) : !data && tableState.phase === "error" ? (
          <div className="flex h-full items-center justify-center px-5 py-6">
            <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[#c78972] bg-[#fff0ea] px-6 py-6 text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8a3e1f]">
                Table Unavailable
              </div>
              <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
                The data table could not be indexed
              </div>
              <p className="mt-2 text-sm leading-6 text-[#8a3e1f]">{tableState.message}</p>
            </div>
          </div>
        ) : !data ? (
          <div className="flex h-full items-center justify-center px-5 py-6">
            <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[color:var(--viewer-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.54),rgba(245,239,230,0.76))] px-6 py-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
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
            <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[color:var(--viewer-border)] bg-white/60 px-6 py-6 text-center">
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
            <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[color:var(--viewer-border)] bg-white/60 px-6 py-6 text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                No Matching Rows
              </div>
              <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
                The current filters hide every element
              </div>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">
                Adjust the text filter, IFC type filter, edited-only toggle, or visible columns to
                bring matching rows back into view.
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
                      onChange={toggleAllVisibleRows}
                      className="h-4 w-4 rounded border-[color:var(--viewer-border)] text-[color:var(--accent)]"
                      aria-label="Select all visible rows"
                    />
                  </th>
                  {visibleColumns.map((column) => (
                    <th
                      key={column.key}
                      aria-sort={
                        activeUiState.sort?.columnKey === column.key
                          ? activeUiState.sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      className="min-w-[12rem] border-b border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-3 align-bottom"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="flex w-full items-end justify-between gap-3 text-left"
                        aria-label={`${sortLabel(activeUiState.sort, column.key)} by ${column.label}`}
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
                        <SortIndicator sort={activeUiState.sort} columnKey={column.key} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {visibleRows.map((row) => {
                  const checked = activeUiState.selectedRowKeys.has(row.key);
                  const selected = activeSelection?.localId === row.localId;

                  return (
                    <tr
                      key={row.key}
                      onClick={() => onSelectRow(row.localId)}
                      className={`cursor-pointer transition hover:bg-white/45 ${
                        selected
                          ? "bg-[#e7f3ee]"
                          : checked
                            ? "bg-[#f6efe3]"
                            : "bg-transparent"
                      }`}
                    >
                      <td className="border-b border-[color:var(--viewer-border)] px-3 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRow(row.key)}
                          onClick={(event) => event.stopPropagation()}
                          className="h-4 w-4 rounded border-[color:var(--viewer-border)] text-[color:var(--accent)]"
                          aria-label={`Select row ${row.localId}`}
                        />
                      </td>
                      {visibleColumns.map((column) => {
                        const cell = row.cells[column.key];
                        const draftCell = cell?.source === "draft";

                        return (
                          <td
                            key={column.key}
                            className={`border-b border-[color:var(--viewer-border)] px-3 py-3 align-top text-sm ${
                              draftCell
                                ? "bg-[#edf7f1] text-[#1e6b45]"
                                : cell
                                  ? cellTone(column, cell.state)
                                  : "text-[color:var(--muted-ink)]"
                            }`}
                          >
                            <div className="min-w-0 break-words font-mono text-[12px] leading-5">
                              {cell?.text ?? "MISSING"}
                            </div>
                            {draftCell ? (
                              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#1e6b45]">
                                Imported
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
    </aside>
  );
};

export const DataTablePanel = memo(DataTablePanelComponent);
DataTablePanel.displayName = "DataTablePanel";
