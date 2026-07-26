import {
  applyViewerDataTableDraft,
  coerceViewerDataTableInputValue,
  sanitizeViewerDataTableDraft,
} from "@/features/viewer/lib/data-table-draft";
import type {
  ViewerDataTableCell,
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerDataTableDraft,
  ViewerDataTableEdit,
  ViewerValidationRunResult,
} from "@/features/viewer/types";
import type {
  CoreyMcpDraftEditRequest,
  CoreyMcpElementQuery,
  CoreyMcpExpectedValue,
  CoreyMcpFieldDescriptor,
  CoreyMcpFieldPredicate,
  CoreyMcpFieldRef,
} from "@/features/viewer/mcp/contracts";

const DEFAULT_QUERY_LIMIT = 25;
const MAX_QUERY_LIMIT = 100;
const MAX_ELEMENT_DETAILS = 25;
const MAX_DRAFT_EDITS = 50;

type CursorPayload = {
  revision: string;
  offset: number;
};

function encodeCursor(payload: CursorPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined, revision: string) {
  if (!cursor) return 0;

  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;
  } catch {
    throw new Error("The pagination cursor is invalid.");
  }

  if (payload.revision !== revision) {
    throw new Error("The model changed after this cursor was issued. Restart the query.");
  }
  if (!Number.isInteger(payload.offset) || payload.offset < 0) {
    throw new Error("The pagination cursor is invalid.");
  }
  return payload.offset;
}

export function fieldKey(field: CoreyMcpFieldRef) {
  return field.kind === "attribute"
    ? `attribute:${field.name}`
    : `property:${field.group}::${field.label}`;
}

function findColumn(data: ViewerDataTableData, field: CoreyMcpFieldRef) {
  const wanted = fieldKey(field).toLowerCase();
  return data.columns.find((column) => column.key.toLowerCase() === wanted) ?? null;
}

function globalIdForRow(row: ViewerDataTableData["rows"][number]) {
  const cell = row.cells.globalId;
  if (!cell || cell.state !== "present") return null;
  const value = typeof cell.raw === "string" ? cell.raw : cell.text;
  return value.trim() || null;
}

function scalarCellValue(cell: ViewerDataTableCell | undefined) {
  if (!cell || cell.state !== "present") return undefined;
  if (
    typeof cell.raw === "string" ||
    typeof cell.raw === "number" ||
    typeof cell.raw === "boolean"
  ) {
    return cell.raw;
  }
  return cell.text;
}

function valuesEqual(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left === right;
  if (typeof left === "boolean" && typeof right === "boolean") return left === right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    sensitivity: "base",
  }) === 0;
}

function matchesPredicate(
  row: ViewerDataTableData["rows"][number],
  data: ViewerDataTableData,
  predicate: CoreyMcpFieldPredicate,
) {
  const column = findColumn(data, predicate.field);
  const cell = column ? row.cells[column.key] : undefined;

  if (predicate.operator === "exists") return cell?.state === "present";
  if (predicate.operator === "missing") return !cell || cell.state !== "present";

  const current = scalarCellValue(cell);
  if (current === undefined) return predicate.operator === "neq";

  if (predicate.operator === "eq") return valuesEqual(current, predicate.value);
  if (predicate.operator === "neq") return !valuesEqual(current, predicate.value);
  if (predicate.operator === "contains") {
    return String(current).toLowerCase().includes(String(predicate.value).toLowerCase());
  }
  if (predicate.operator === "in") {
    return predicate.value.some((candidate) => valuesEqual(current, candidate));
  }

  const left = Number(current);
  const right = Number(
    (predicate as Extract<CoreyMcpFieldPredicate, { value: string | number | boolean }>).value,
  );
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (predicate.operator === "gt") return left > right;
  if (predicate.operator === "gte") return left >= right;
  if (predicate.operator === "lt") return left < right;
  return left <= right;
}

function validationByLocalId(result: ViewerValidationRunResult | null) {
  return new Map(result?.results.map((entry) => [entry.localId, entry]) ?? []);
}

function toElementSummary(
  row: ViewerDataTableData["rows"][number],
  validation: ReturnType<typeof validationByLocalId>,
) {
  const match = validation.get(row.localId);
  return {
    globalId: globalIdForRow(row),
    ifcType: row.ifcType,
    name: row.cells.name?.state === "present" ? row.cells.name.text : row.selection.label,
    localId: row.localId,
    validation: match?.result ?? "ok",
  };
}

export function listMcpFields(data: ViewerDataTableData): CoreyMcpFieldDescriptor[] {
  return data.columns
    .filter((column) => column.binding && column.kind !== "base")
    .map((column) => ({
      field: column.binding as CoreyMcpFieldRef,
      key: column.key,
      label: column.label,
      group: column.group,
      editable: column.editable,
      editableReason: column.editableReason,
      valueKind: column.valueKind,
      populatedRowCount: column.populatedRowCount,
    }));
}

export function queryMcpElements(input: {
  data: ViewerDataTableData;
  validation: ViewerValidationRunResult | null;
  query: CoreyMcpElementQuery;
  revision: string;
}) {
  const { data, query, revision } = input;
  const limit = Math.min(MAX_QUERY_LIMIT, Math.max(1, query.limit ?? DEFAULT_QUERY_LIMIT));
  const offset = decodeCursor(query.cursor, revision);
  const wantedTypes = new Set((query.ifcTypes ?? []).map((value) => value.toUpperCase()));
  const wantedValidation = new Set(query.validation ?? []);
  const normalizedText = query.text?.trim().toLowerCase() ?? "";
  const validation = validationByLocalId(input.validation);

  const matched = data.rows.filter((row) => {
    if (wantedTypes.size > 0 && !wantedTypes.has((row.ifcType ?? "").toUpperCase())) return false;
    if (normalizedText && !row.searchText.includes(normalizedText)) return false;
    const severity = validation.get(row.localId)?.result ?? "ok";
    if (wantedValidation.size > 0 && !wantedValidation.has(severity)) return false;
    return (query.where ?? []).every((predicate) => matchesPredicate(row, data, predicate));
  });

  const items = matched.slice(offset, offset + limit).map((row) => toElementSummary(row, validation));
  const nextOffset = offset + items.length;
  return {
    total: matched.length,
    items,
    nextCursor: nextOffset < matched.length ? encodeCursor({ revision, offset: nextOffset }) : null,
  };
}

function serializeCell(cell: ViewerDataTableCell | undefined) {
  if (!cell) return { state: "missing" as const, value: null, text: "MISSING", source: "ifc" as const };
  return {
    state: cell.state,
    value:
      typeof cell.raw === "string" ||
      typeof cell.raw === "number" ||
      typeof cell.raw === "boolean" ||
      cell.raw === null
        ? cell.raw
        : cell.text,
    text: cell.text,
    source: cell.source,
    ...(cell.original ? { original: cell.original } : {}),
  };
}

export function getMcpElements(input: {
  data: ViewerDataTableData;
  validation: ViewerValidationRunResult | null;
  globalIds: string[];
}) {
  const ids = [...new Set(input.globalIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error("At least one GlobalId is required.");
  if (ids.length > MAX_ELEMENT_DETAILS) {
    throw new Error(`At most ${MAX_ELEMENT_DETAILS} elements can be requested at once.`);
  }

  const rowsById = new Map(
    input.data.rows
      .map((row) => [globalIdForRow(row), row] as const)
      .filter((entry): entry is [string, ViewerDataTableData["rows"][number]] => Boolean(entry[0])),
  );
  const validation = validationByLocalId(input.validation);
  const columnsByKey = new Map(input.data.columns.map((column) => [column.key, column]));
  const items = ids.map((globalId) => {
    const row = rowsById.get(globalId);
    if (!row) return { globalId, found: false as const };
    const fields = Object.fromEntries(
      Object.entries(row.cells)
        .filter(([key]) => key !== "globalId" && key !== "ifcType" && key !== "name")
        .map(([key, cell]) => {
          const column = columnsByKey.get(key);
          return [
            key,
            {
              label: column?.label ?? key,
              group: column?.group ?? null,
              binding: column?.binding ?? null,
              editable: column?.editable ?? false,
              ...serializeCell(cell),
            },
          ];
        }),
    );
    return {
      found: true as const,
      ...toElementSummary(row, validation),
      fields,
      validationFailures: validation.get(row.localId)?.failedClauses ?? [],
    };
  });
  return { items };
}

function expectedMatches(cell: ViewerDataTableCell | undefined, expected: CoreyMcpExpectedValue) {
  const state = cell?.state ?? "missing";
  if (state !== expected.state) return false;
  if (!("value" in expected)) return true;
  return valuesEqual(scalarCellValue(cell) ?? cell?.raw ?? null, expected.value ?? null);
}

function columnForEdit(data: ViewerDataTableData, field: CoreyMcpFieldRef) {
  const column = findColumn(data, field);
  if (!column) throw new Error(`Unknown field ${fieldKey(field)}.`);
  if (!column.editable) {
    throw new Error(column.editableReason ?? `Field ${fieldKey(field)} is read-only.`);
  }
  return column;
}

export function prepareMcpDraftEdits(input: {
  sourceId: string;
  baseData: ViewerDataTableData;
  currentDraft: ViewerDataTableDraft | null;
  edits: CoreyMcpDraftEditRequest[];
}) {
  if (input.edits.length === 0) throw new Error("At least one edit is required.");
  if (input.edits.length > MAX_DRAFT_EDITS) {
    throw new Error(`At most ${MAX_DRAFT_EDITS} edits can be applied at once.`);
  }

  const currentData = applyViewerDataTableDraft(input.baseData, input.currentDraft);
  const rowByGlobalId = new Map(
    currentData.rows
      .map((row) => [globalIdForRow(row), row] as const)
      .filter((entry): entry is [string, ViewerDataTableData["rows"][number]] => Boolean(entry[0])),
  );
  const nextEdits: ViewerDataTableEdit[] = [...(input.currentDraft?.edits ?? [])];
  const applied: Array<{ globalId: string; field: string; value: unknown }> = [];

  for (const request of input.edits) {
    const row = rowByGlobalId.get(request.globalId);
    if (!row) throw new Error(`Element ${request.globalId} was not found.`);
    const column = columnForEdit(currentData, request.field);
    const currentCell = row.cells[column.key];
    if (!expectedMatches(currentCell, request.expected)) {
      throw new Error(`Edit conflict for ${request.globalId} ${column.key}: the current value changed.`);
    }
    const coerced = coerceViewerDataTableInputValue(request.value, column.valueKind);
    if (!coerced.ok) throw new Error(`${request.globalId} ${column.key}: ${coerced.message}`);

    const index = nextEdits.findIndex(
      (edit) => edit.rowKey === row.key && edit.columnKey === column.key,
    );
    const nextEdit = { rowKey: row.key, columnKey: column.key, value: coerced.value };
    if (index >= 0) nextEdits[index] = nextEdit;
    else nextEdits.push(nextEdit);
    applied.push({ globalId: request.globalId, field: column.key, value: coerced.value.raw });
  }

  const sanitized = sanitizeViewerDataTableDraft(
    input.sourceId,
    input.baseData,
    nextEdits,
    input.currentDraft?.importedColumns ?? [],
  );
  if (sanitized.issues.length > 0) {
    throw new Error(sanitized.issues[0]?.message ?? "The draft edits could not be applied.");
  }
  return { draft: sanitized.draft, applied };
}

export function validationSummary(result: ViewerValidationRunResult | null, rowCount: number) {
  const errors = result?.results.filter((entry) => entry.result === "error").length ?? 0;
  const warnings = result?.results.filter((entry) => entry.result === "warn").length ?? 0;
  return {
    rowCount,
    evaluatedIssueCount: errors + warnings,
    okCount: Math.max(0, rowCount - errors - warnings),
    warnCount: warnings,
    errorCount: errors,
    failedClauseCount: result?.failedClauseCount ?? 0,
    failedClauses: result?.failedClauses ?? [],
  };
}

export function queryValidationIssues(input: {
  data: ViewerDataTableData;
  result: ViewerValidationRunResult | null;
  severities?: Array<"warn" | "error">;
  clauseIds?: string[];
  ifcTypes?: string[];
  cursor?: string;
  limit?: number;
  revision: string;
}) {
  const limit = Math.min(MAX_QUERY_LIMIT, Math.max(1, input.limit ?? DEFAULT_QUERY_LIMIT));
  const offset = decodeCursor(input.cursor, input.revision);
  const rowsByLocalId = new Map(input.data.rows.map((row) => [row.localId, row]));
  const severities = new Set(input.severities ?? []);
  const clauseIds = new Set(input.clauseIds ?? []);
  const ifcTypes = new Set((input.ifcTypes ?? []).map((value) => value.toUpperCase()));
  const matches = (input.result?.results ?? []).filter((entry) => {
    if (severities.size > 0 && !severities.has(entry.result)) return false;
    const row = rowsByLocalId.get(entry.localId);
    if (ifcTypes.size > 0 && !ifcTypes.has((row?.ifcType ?? "").toUpperCase())) return false;
    return (
      clauseIds.size === 0 ||
      entry.failedClauses.some((clause) => clauseIds.has(clause.clauseId))
    );
  });
  const items = matches.slice(offset, offset + limit).map((entry) => {
    const row = rowsByLocalId.get(entry.localId);
    return {
      globalId: row ? globalIdForRow(row) : null,
      ifcType: row?.ifcType ?? null,
      name: row?.selection.label ?? null,
      severity: entry.result,
      failedClauses: entry.failedClauses,
    };
  });
  const nextOffset = offset + items.length;
  return {
    total: matches.length,
    items,
    nextCursor:
      nextOffset < matches.length
        ? encodeCursor({ revision: input.revision, offset: nextOffset })
        : null,
  };
}

export function columnBindingKey(column: ViewerDataTableColumn) {
  return column.binding ? fieldKey(column.binding) : column.key;
}

export { MAX_DRAFT_EDITS, MAX_ELEMENT_DETAILS, MAX_QUERY_LIMIT };
