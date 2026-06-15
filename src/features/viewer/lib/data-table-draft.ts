import type {
  ViewerDataTableCell,
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerDataTableDraft,
  ViewerDataTableDraftValue,
  ViewerDataTableEdit,
  ViewerDataTableEditableValueKind,
  ViewerDataTableIssue,
  ViewerInspectionValueState,
} from "@/features/viewer/types";

const VIEWER_DATA_TABLE_DRAFT_VERSION = 2;
const VIEWER_DATA_TABLE_DRAFT_STORAGE_PREFIX = "corey:data-table-draft:";
const LEGACY_VIEWER_DATA_TABLE_DRAFT_STORAGE_PREFIX = "corey:data-table-draft:v1:";

type PersistedViewerDataTableDraft =
  | {
      version: 1;
      sourceId: string;
      updatedAt: string;
      edits: Array<[rowKey: string, columnKey: string, raw: unknown, valueKind: ViewerDataTableEditableValueKind | null]>;
    }
  | {
      version: 2;
      sourceId: string;
      updatedAt: string;
      importedColumns?: ViewerDataTableColumn[];
      edits: Array<[rowKey: string, columnKey: string, raw: unknown, valueKind: ViewerDataTableEditableValueKind | null]>;
    }
  | ViewerDataTableDraft;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCompactPersistedEdit(
  entry: unknown,
): entry is [string, string, unknown, ViewerDataTableEditableValueKind | null] {
  return Array.isArray(entry);
}

function normalizeEditableValueKind(value: unknown): ViewerDataTableEditableValueKind | null {
  if (value === "string" || value === "number" || value === "boolean") {
    return value;
  }

  return null;
}

function normalizeUpdatedAt(value: unknown) {
  if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value))) {
    return value;
  }

  return new Date().toISOString();
}

function normalizeValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    Object.keys(value as Record<string, unknown>).every((key) => key === "value" || key === "type")
  ) {
    return normalizeValue((value as { value: unknown }).value);
  }

  return value;
}

function formatValue(value: unknown): string {
  const normalized = normalizeValue(value);

  if (typeof normalized === "string") {
    return normalized;
  }

  if (
    typeof normalized === "number" ||
    typeof normalized === "boolean" ||
    typeof normalized === "bigint"
  ) {
    return String(normalized);
  }

  if (Array.isArray(normalized)) {
    return normalized.map((entry) => formatValue(entry)).join(", ");
  }

  if (normalized && typeof normalized === "object") {
    try {
      return JSON.stringify(normalized);
    } catch {
      return String(normalized);
    }
  }

  return String(normalized);
}

function buildValueState(value: unknown): ViewerInspectionValueState {
  const normalized = normalizeValue(value);

  if (normalized === undefined) {
    return "missing";
  }

  if (normalized === null) {
    return "null";
  }

  if (typeof normalized === "string" && normalized.trim().length === 0) {
    return "empty";
  }

  if (Array.isArray(normalized) && normalized.length === 0) {
    return "empty";
  }

  if (normalized && typeof normalized === "object" && Object.keys(normalized).length === 0) {
    return "empty";
  }

  return "present";
}

function buildValueText(value: unknown, state: ViewerInspectionValueState) {
  if (state === "missing") {
    return "MISSING";
  }

  if (state === "null") {
    return "Null";
  }

  if (state === "empty") {
    if (typeof normalizeValue(value) === "string") {
      return "Empty string";
    }

    if (Array.isArray(normalizeValue(value))) {
      return "Empty list";
    }

    return "Empty";
  }

  return formatValue(value);
}

function toSearchText(columns: ViewerDataTableColumn[], cells: Record<string, ViewerDataTableCell>) {
  const columnMap = new Map(columns.map((column) => [column.key, column]));
  const parts: string[] = [];

  for (const [columnKey, cell] of Object.entries(cells)) {
    if (cell.state !== "present") {
      continue;
    }

    const column = columnMap.get(columnKey);
    if (!column) {
      continue;
    }

    parts.push([column.group, column.label, cell.text].filter(Boolean).join(" ").toLowerCase());
  }

  return parts.join(" ");
}

function normalizeImportedColumn(column: ViewerDataTableColumn): ViewerDataTableColumn {
  return {
    key: String(column.key ?? ""),
    label: String(column.label ?? ""),
    kind:
      column.kind === "base" || column.kind === "attribute" || column.kind === "property"
        ? column.kind
        : "property",
    group: column.group ? String(column.group) : null,
    populatedRowCount:
      typeof column.populatedRowCount === "number" && Number.isFinite(column.populatedRowCount)
        ? column.populatedRowCount
        : 0,
    editable: Boolean(column.editable),
    editableReason: column.editableReason ? String(column.editableReason) : null,
    binding: column.binding ?? null,
    valueKind: normalizeEditableValueKind(column.valueKind),
    origin: column.origin === "import" ? "import" : "ifc",
    importHeader: column.importHeader ? String(column.importHeader) : null,
  };
}

function normalizePersistedEdit(entry: unknown): ViewerDataTableEdit | null {
  if (isCompactPersistedEdit(entry)) {
    const rowKey = String(entry[0] ?? "");
    const columnKey = String(entry[1] ?? "");
    if (!rowKey || !columnKey) {
      return null;
    }

    return {
      rowKey,
      columnKey,
      value: buildViewerDataTableDraftValue(entry[2], normalizeEditableValueKind(entry[3])),
    };
  }

  if (!isRecord(entry)) {
    return null;
  }

  const rowKey = String(entry.rowKey ?? "");
  const columnKey = String(entry.columnKey ?? "");
  if (!rowKey || !columnKey) {
    return null;
  }

  const value = isRecord(entry.value) ? entry.value : {};
  return {
    rowKey,
    columnKey,
    value: buildViewerDataTableDraftValue(
      "raw" in value ? value.raw : undefined,
      normalizeEditableValueKind(value.valueKind),
    ),
  };
}

function mergeViewerDataTableColumns(
  baseColumns: ViewerDataTableColumn[],
  importedColumns: ViewerDataTableColumn[],
) {
  if (importedColumns.length === 0) {
    return baseColumns;
  }

  const existingKeys = new Set(baseColumns.map((column) => column.key));
  const nextColumns = [...baseColumns];
  for (const importedColumn of importedColumns) {
    if (existingKeys.has(importedColumn.key)) {
      continue;
    }

    nextColumns.push(importedColumn);
    existingKeys.add(importedColumn.key);
  }

  return nextColumns;
}

export function buildViewerDataTableDraftValue(
  raw: unknown,
  valueKind: ViewerDataTableEditableValueKind | null,
): ViewerDataTableDraftValue {
  const state = buildValueState(raw);

  return {
    raw,
    text: buildValueText(raw, state),
    state,
    valueKind,
  };
}

export function coerceViewerDataTableInputValue(
  input: unknown,
  valueKind: ViewerDataTableEditableValueKind | null,
): { ok: true; value: ViewerDataTableDraftValue } | { ok: false; message: string } {
  if (input === undefined || input === null || (typeof input === "string" && input.trim().length === 0)) {
    return {
      ok: true,
      value: buildViewerDataTableDraftValue(undefined, valueKind),
    };
  }

  if (!valueKind || valueKind === "string") {
    return {
      ok: true,
      value: buildViewerDataTableDraftValue(String(input), valueKind),
    };
  }

  if (valueKind === "number") {
    const numeric =
      typeof input === "number"
        ? input
        : typeof input === "string"
          ? Number(input.trim())
          : Number.NaN;

    if (!Number.isFinite(numeric)) {
      return {
        ok: false,
        message: "Expected a number.",
      };
    }

    return {
      ok: true,
      value: buildViewerDataTableDraftValue(numeric, valueKind),
    };
  }

  if (typeof input === "boolean") {
    return {
      ok: true,
      value: buildViewerDataTableDraftValue(input, valueKind),
    };
  }

  if (typeof input === "number") {
    if (input === 1 || input === 0) {
      return {
        ok: true,
        value: buildViewerDataTableDraftValue(input === 1, valueKind),
      };
    }

    return {
      ok: false,
      message: "Expected a boolean.",
    };
  }

  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) {
      return {
        ok: true,
        value: buildViewerDataTableDraftValue(true, valueKind),
      };
    }

    if (["false", "no", "n", "0"].includes(normalized)) {
      return {
        ok: true,
        value: buildViewerDataTableDraftValue(false, valueKind),
      };
    }
  }

  return {
    ok: false,
    message: "Expected a boolean.",
  };
}

export function createViewerDataTableDraft(
  sourceId: string,
  edits: ViewerDataTableEdit[],
  importedColumns: ViewerDataTableColumn[] = [],
): ViewerDataTableDraft {
  return {
    version: VIEWER_DATA_TABLE_DRAFT_VERSION,
    sourceId,
    updatedAt: new Date().toISOString(),
    importedColumns,
    edits,
  };
}

export function applyViewerDataTableDraft(
  data: ViewerDataTableData,
  draft: ViewerDataTableDraft | null,
) {
  if (!draft || (draft.edits.length === 0 && draft.importedColumns.length === 0)) {
    return data;
  }

  const columns = mergeViewerDataTableColumns(
    data.columns,
    draft.importedColumns.map(normalizeImportedColumn),
  );
  const columnMap = new Map(columns.map((column) => [column.key, column]));

  const rowEditMap = new Map<string, Map<string, ViewerDataTableEdit>>();
  for (const edit of draft.edits) {
    const editsForRow = rowEditMap.get(edit.rowKey) ?? new Map<string, ViewerDataTableEdit>();
    editsForRow.set(edit.columnKey, edit);
    rowEditMap.set(edit.rowKey, editsForRow);
  }

  const rows = data.rows.map((row) => {
    const rowEdits = rowEditMap.get(row.key);
    if (!rowEdits || rowEdits.size === 0) {
      return row;
    }

    let changed = false;
    const cells = { ...row.cells };
    for (const [columnKey, edit] of rowEdits.entries()) {
      const column = columnMap.get(columnKey);
      if (!column) {
        continue;
      }

      const baseCell = row.cells[columnKey];
      const nextCell: ViewerDataTableCell = {
        raw: edit.value.raw,
        text: edit.value.text,
        state: edit.value.state,
        source: "draft",
        binding: column.binding,
        valueKind: column.valueKind,
        original: baseCell
          ? {
              raw: baseCell.raw,
              text: baseCell.text,
              state: baseCell.state,
            }
          : null,
      };

      cells[columnKey] = nextCell;
      changed = true;
    }

    if (!changed) {
      return row;
    }

    return {
      ...row,
      cells,
      searchText: toSearchText(columns, cells),
    };
  });

  return {
    ...data,
    columns,
    rows,
  };
}

export function sanitizeViewerDataTableDraft(
  sourceId: string,
  data: ViewerDataTableData,
  edits: ViewerDataTableEdit[],
  importedColumns: ViewerDataTableColumn[] = [],
): { draft: ViewerDataTableDraft | null; issues: ViewerDataTableIssue[] } {
  const rowMap = new Map(data.rows.map((row) => [row.key, row]));
  const columnMap = new Map(data.columns.map((column) => [column.key, column]));
  const importedColumnMap = new Map<string, ViewerDataTableColumn>();
  const nextEdits: ViewerDataTableEdit[] = [];
  const issues: ViewerDataTableIssue[] = [];

  for (const importedColumn of importedColumns) {
    if (!importedColumn.key) {
      continue;
    }

    if (columnMap.has(importedColumn.key)) {
      continue;
    }

    importedColumnMap.set(importedColumn.key, normalizeImportedColumn(importedColumn));
  }

  for (const edit of edits) {
    const row = rowMap.get(edit.rowKey);
    const column = columnMap.get(edit.columnKey) ?? importedColumnMap.get(edit.columnKey);
    if (!row || !column) {
      issues.push({
        rowKey: edit.rowKey,
        columnKey: edit.columnKey,
        message: "Skipped an edit for a missing row or column.",
      });
      continue;
    }

    if (!column.editable) {
      issues.push({
        rowKey: edit.rowKey,
        columnKey: edit.columnKey,
        message: column.editableReason ?? "This column is read-only.",
      });
      continue;
    }

    const baseCell = row.cells[column.key];
    if (!baseCell && edit.value.state === "missing") {
      continue;
    }

    if (
      baseCell &&
      baseCell.state === edit.value.state &&
      baseCell.text === edit.value.text &&
      baseCell.raw === edit.value.raw
    ) {
      continue;
    }

    nextEdits.push({
      rowKey: edit.rowKey,
      columnKey: edit.columnKey,
      value: edit.value,
    });
  }

  const referencedImportedColumns = [...new Set(
    nextEdits
      .map((edit) => edit.columnKey)
      .filter((columnKey) => !columnMap.has(columnKey)),
  )]
    .map((columnKey) => importedColumnMap.get(columnKey))
    .filter((column): column is ViewerDataTableColumn => Boolean(column));

  if (nextEdits.length === 0 && referencedImportedColumns.length === 0) {
    return { draft: null, issues };
  }

  return {
    draft: createViewerDataTableDraft(sourceId, nextEdits, referencedImportedColumns),
    issues,
  };
}

function buildStorageKey(sourceId: string) {
  return `${VIEWER_DATA_TABLE_DRAFT_STORAGE_PREFIX}${sourceId}`;
}

function buildLegacyStorageKey(sourceId: string) {
  return `${LEGACY_VIEWER_DATA_TABLE_DRAFT_STORAGE_PREFIX}${sourceId}`;
}

export function serializeViewerDataTableDraft(
  draft: ViewerDataTableDraft,
): PersistedViewerDataTableDraft {
  return {
    version: draft.version,
    sourceId: draft.sourceId,
    updatedAt: draft.updatedAt,
    importedColumns: draft.importedColumns.map(normalizeImportedColumn),
    edits: draft.edits.map((edit) => [
      edit.rowKey,
      edit.columnKey,
      edit.value.raw,
      edit.value.valueKind,
    ] as [string, string, unknown, ViewerDataTableEditableValueKind | null]),
  };
}

export function parseStoredViewerDataTableDraft(
  sourceId: string,
  input: unknown,
): ViewerDataTableDraft {
  if (!isRecord(input)) {
    throw new Error("Stored data-table draft must be an object.");
  }

  if (
    (input.version !== 1 && input.version !== VIEWER_DATA_TABLE_DRAFT_VERSION) ||
    input.sourceId !== sourceId ||
    !Array.isArray(input.edits)
  ) {
    throw new Error("Stored data-table draft does not match this model.");
  }

  const importedColumns =
    input.version === VIEWER_DATA_TABLE_DRAFT_VERSION && Array.isArray(input.importedColumns)
      ? input.importedColumns
          .filter(isRecord)
          .map((column) => normalizeImportedColumn(column as unknown as ViewerDataTableColumn))
          .filter((column) => column.key.length > 0)
      : [];
  const edits = input.edits
    .map(normalizePersistedEdit)
    .filter((edit): edit is ViewerDataTableEdit => Boolean(edit));

  return {
    version: VIEWER_DATA_TABLE_DRAFT_VERSION,
    sourceId,
    updatedAt: normalizeUpdatedAt(input.updatedAt),
    importedColumns,
    edits,
  };
}

export function readPersistedViewerDataTableDraft(sourceId: string): ViewerDataTableDraft | null {
  if (typeof window === "undefined") {
    return null;
  }

  for (const storageKey of [buildStorageKey(sourceId), buildLegacyStorageKey(sourceId)]) {
    const text = window.localStorage.getItem(storageKey);
    if (!text) {
      continue;
    }

    try {
      const parsed = JSON.parse(text) as PersistedViewerDataTableDraft;
      return parseStoredViewerDataTableDraft(sourceId, parsed);
    } catch {
      continue;
    }
  }

  return null;
}

export function writePersistedViewerDataTableDraft(draft: ViewerDataTableDraft | null) {
  if (typeof window === "undefined" || !draft) {
    return { ok: true as const };
  }

  try {
    window.localStorage.setItem(
      buildStorageKey(draft.sourceId),
      JSON.stringify(serializeViewerDataTableDraft(draft)),
    );
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "The imported edits could not be stored locally.",
    };
  }
}

export function clearPersistedViewerDataTableDraft(sourceId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(buildStorageKey(sourceId));
  window.localStorage.removeItem(buildLegacyStorageKey(sourceId));
}
