import {
  coerceViewerDataTableInputValue,
  createViewerDataTableDraft,
} from "@/features/viewer/lib/data-table-draft";
import type { CellValue, Workbook, Worksheet } from "exceljs";
import type {
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerDataTableDraft,
  ViewerDataTableEdit,
  ViewerDataTableEditableValueKind,
  ViewerDataTableImportReport,
  ViewerDataTableIssue,
} from "@/features/viewer/types";

export const DATA_TABLE_EXCEL_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const VIEWER_DATA_TABLE_WORKBOOK_VERSION = 2;
const DATA_SHEET_NAME = "Data Table";
const META_SHEET_NAME = "_corey_meta";
const TECHNICAL_COLUMNS = ["__rowKey", "__modelId", "__localId"] as const;
const IMPORTED_COLUMN_FALLBACK_GROUP = "Excel Import";
const WORKBOOK_GROUP_DELIMITER = "|||";

type ColumnMetaRow = {
  header: string;
  columnKey: string;
  label: string;
  kind: string;
  group: string;
  editable: string;
  valueKind: string;
  bindingKind: string;
  bindingName: string;
  bindingGroup: string;
  bindingLabel: string;
  origin: string;
  importHeader: string;
};

async function createWorkbook(): Promise<Workbook> {
  const ExcelJS = await import("exceljs");
  return new ExcelJS.Workbook();
}

function appendRows(worksheet: Worksheet, rows: unknown[][]) {
  for (const row of rows) {
    worksheet.addRow(row);
  }
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toUint8Array(bytes: ArrayBuffer) {
  return new Uint8Array(bytes);
}

function normalizeCellValue(value: CellValue): unknown {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== "object") {
    return value;
  }

  if ("result" in value) {
    return normalizeCellValue(value.result as CellValue);
  }

  if ("text" in value && typeof value.text === "string") {
    return value.text;
  }

  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("");
  }

  return String(value);
}

function worksheetRows(worksheet: Worksheet) {
  const rows: unknown[][] = [];
  const columnCount = worksheet.columnCount;

  worksheet.eachRow((row) => {
    const values: unknown[] = [];
    for (let index = 1; index <= columnCount; index++) {
      values.push(normalizeCellValue(row.getCell(index).value));
    }
    rows.push(values);
  });

  return rows;
}

function getSheetNames(workbook: Workbook) {
  return workbook.worksheets.map((worksheet) => worksheet.name);
}

async function loadWorkbook(bytes: Uint8Array) {
  const workbook = await createWorkbook();
  await workbook.xlsx.load(toArrayBuffer(bytes));
  return workbook;
}

function formatByteSignature(bytes: Uint8Array, length = 8) {
  return [...bytes.slice(0, length)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function toWorkbookCellValue(row: ViewerDataTableData["rows"][number], column: ViewerDataTableColumn) {
  const cell = row.cells[column.key];
  if (!cell) {
    return "";
  }

  if (cell.state !== "present") {
    return "";
  }

  if (
    column.editable &&
    (typeof cell.raw === "string" || typeof cell.raw === "number" || typeof cell.raw === "boolean")
  ) {
    return cell.raw;
  }

  return cell.text;
}

function getWorkbookColumnHeader(column: ViewerDataTableColumn) {
  if (column.kind === "base" || !column.group) {
    return column.label;
  }

  return `${column.group}${WORKBOOK_GROUP_DELIMITER}${column.label}`;
}

function buildMetaRows(sourceId: string, columns: ViewerDataTableColumn[]) {
  const rows: unknown[][] = [
    ["key", "value"],
    ["version", VIEWER_DATA_TABLE_WORKBOOK_VERSION],
    ["sourceId", sourceId],
    ["exportedAt", new Date().toISOString()],
    [],
    [
      "header",
      "columnKey",
      "label",
      "kind",
      "group",
      "editable",
      "valueKind",
      "bindingKind",
      "bindingName",
      "bindingGroup",
      "bindingLabel",
      "origin",
      "importHeader",
    ],
  ];

  for (const column of columns) {
    rows.push([
      getWorkbookColumnHeader(column),
      column.key,
      column.label,
      column.kind,
      column.group ?? "",
      column.editable ? "true" : "false",
      column.valueKind ?? "",
      column.binding?.kind ?? "",
      column.binding?.kind === "attribute" ? column.binding.name : "",
      column.binding?.kind === "property" ? column.binding.group : "",
      column.binding?.kind === "property" ? column.binding.label : "",
      column.origin,
      column.importHeader ?? "",
    ]);
  }

  return rows;
}

function parseMetaRows(rows: unknown[][]) {
  const settings = new Map<string, string>();
  const columns: ColumnMetaRow[] = [];
  let inColumns = false;

  for (const row of rows) {
    if (!inColumns) {
      if (row[0] === "header") {
        inColumns = true;
        continue;
      }

      if (typeof row[0] === "string" && typeof row[1] !== "undefined" && row[0].length > 0) {
        settings.set(row[0], String(row[1]));
      }
      continue;
    }

    if (typeof row[0] !== "string" || row[0].length === 0) {
      continue;
    }

    columns.push({
      header: String(row[0] ?? ""),
      columnKey: String(row[1] ?? ""),
      label: String(row[2] ?? ""),
      kind: String(row[3] ?? ""),
      group: String(row[4] ?? ""),
      editable: String(row[5] ?? ""),
      valueKind: String(row[6] ?? ""),
      bindingKind: String(row[7] ?? ""),
      bindingName: String(row[8] ?? ""),
      bindingGroup: String(row[9] ?? ""),
      bindingLabel: String(row[10] ?? ""),
      origin: String(row[11] ?? ""),
      importHeader: String(row[12] ?? ""),
    });
  }

  return { settings, columns };
}

function normalizeDisplayValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  return String(value);
}

function isEmptyWorkbookImportValue(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

function buildPropertyColumnKey(group: string, label: string) {
  return `property:${group}::${label}`;
}

function buildDelimitedHeader(group: string, label: string) {
  return `${group}${WORKBOOK_GROUP_DELIMITER}${label}`;
}

function parseImportedColumnHeader(header: string) {
  const delimiters = [WORKBOOK_GROUP_DELIMITER, "-"];

  for (const delimiter of delimiters) {
    const delimiterIndex = header.indexOf(delimiter);
    if (delimiterIndex <= 0) {
      continue;
    }

    const group = header.slice(0, delimiterIndex).trim();
    const label = header.slice(delimiterIndex + delimiter.length).trim();
    if (!group || !label) {
      continue;
    }

    return { group, label };
  }

  return {
    group: IMPORTED_COLUMN_FALLBACK_GROUP,
    label: header.trim(),
  };
}

function isBooleanLikeValue(value: unknown) {
  if (typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return value === 0 || value === 1;
  }

  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return ["true", "false", "yes", "no", "y", "n", "1", "0"].includes(normalized);
}

function isNumericLikeValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "string") {
    return false;
  }

  if (value.trim().length === 0) {
    return false;
  }

  return Number.isFinite(Number(value.trim()));
}

function inferImportedColumnValueKind(values: unknown[]): ViewerDataTableEditableValueKind | null {
  if (values.length === 0) {
    return null;
  }

  if (values.every((value) => isBooleanLikeValue(value))) {
    return "boolean";
  }

  if (values.every((value) => isNumericLikeValue(value))) {
    return "number";
  }

  return "string";
}

function buildImportedColumnFromHeader(
  header: string,
  values: unknown[],
): ViewerDataTableColumn | null {
  const trimmedHeader = header.trim();
  if (!trimmedHeader) {
    return null;
  }

  const valueKind = inferImportedColumnValueKind(values);
  if (!valueKind) {
    return null;
  }

  const { group, label } = parseImportedColumnHeader(trimmedHeader);

  return {
    key: buildPropertyColumnKey(group, label),
    label,
    kind: "property",
    group,
    populatedRowCount: values.length,
    editable: true,
    editableReason: null,
    binding: { kind: "property", group, label },
    valueKind,
    origin: "import",
    importHeader: buildDelimitedHeader(group, label),
  };
}

function buildImportedColumnFromMeta(metaColumn: ColumnMetaRow): ViewerDataTableColumn | null {
  const importHeader = metaColumn.importHeader || metaColumn.header;
  const bindingGroup = metaColumn.bindingGroup || metaColumn.group || IMPORTED_COLUMN_FALLBACK_GROUP;
  const bindingLabel = metaColumn.bindingLabel || metaColumn.label || importHeader;
  if (!importHeader || !bindingLabel) {
    return null;
  }

  return {
    key: metaColumn.columnKey || buildPropertyColumnKey(bindingGroup, bindingLabel),
    label: metaColumn.label || bindingLabel,
    kind: "property",
    group: metaColumn.group || bindingGroup,
    populatedRowCount: 0,
    editable: metaColumn.editable !== "false",
    editableReason: metaColumn.editable === "false" ? "This column is read-only." : null,
    binding: {
      kind: "property",
      group: bindingGroup,
      label: bindingLabel,
    },
    valueKind:
      metaColumn.valueKind === "number" || metaColumn.valueKind === "boolean"
        ? metaColumn.valueKind
        : "string",
    origin: "import",
    importHeader: buildDelimitedHeader(bindingGroup, bindingLabel),
  };
}

function verifyWorkbook(workbook: Workbook, requiredSheets: string[], context: string) {
  for (const sheetName of requiredSheets) {
    if (!workbook.getWorksheet(sheetName)) {
      const sheetNames = getSheetNames(workbook).join(", ");
      throw new Error(
        `${context} verification failed. Found sheets: ${sheetNames || "none"}.`,
      );
    }
  }
}

export async function buildViewerDataTableExcelBytes(input: {
  data: ViewerDataTableData;
  sourceId: string;
}) {
  const workbook = await createWorkbook();
  const visibleColumns = input.data.columns;
  const headerRow = [
    ...TECHNICAL_COLUMNS,
    ...visibleColumns.map((column) => getWorkbookColumnHeader(column)),
  ];
  const dataRows = input.data.rows.map((row) => [
    row.key,
    row.modelId,
    row.localId,
    ...visibleColumns.map((column) => toWorkbookCellValue(row, column)),
  ]);
  const dataSheet = workbook.addWorksheet(DATA_SHEET_NAME);
  const metaSheet = workbook.addWorksheet(META_SHEET_NAME, { state: "hidden" });
  appendRows(dataSheet, [headerRow, ...dataRows]);
  appendRows(metaSheet, buildMetaRows(input.sourceId, visibleColumns));

  const bytes = toUint8Array(await workbook.xlsx.writeBuffer({ useSharedStrings: true }));
  const verificationWorkbook = await loadWorkbook(bytes);
  verifyWorkbook(verificationWorkbook, [DATA_SHEET_NAME, META_SHEET_NAME], "Exported workbook");

  return bytes;
}

export async function parseViewerDataTableExcelBytes(input: {
  bytes: Uint8Array;
  fileName: string;
  sourceId: string;
  baseData: ViewerDataTableData;
  currentData: ViewerDataTableData;
}) {
  const workbook = await loadWorkbook(input.bytes);
  const dataSheet = workbook.getWorksheet(DATA_SHEET_NAME);
  const metaSheet = workbook.getWorksheet(META_SHEET_NAME);

  if (!dataSheet || !metaSheet) {
    const sheetNames = getSheetNames(workbook);
    const signature = formatByteSignature(input.bytes);
    throw new Error(
      `Workbook is missing the required Data Table or _corey_meta sheet. Found sheets: ${sheetNames.length > 0 ? sheetNames.join(", ") : "none"}. Signature: ${signature || "none"}. Size: ${input.bytes.byteLength} bytes.`,
    );
  }

  const metaRows = worksheetRows(metaSheet);
  const { settings, columns: metaColumns } = parseMetaRows(metaRows);
  const version = Number(settings.get("version") ?? Number.NaN);
  const workbookSourceId = settings.get("sourceId") ?? "";

  if (![1, VIEWER_DATA_TABLE_WORKBOOK_VERSION].includes(version)) {
    throw new Error(`Workbook version ${String(settings.get("version") ?? "unknown")} is not supported.`);
  }

  if (workbookSourceId !== input.sourceId) {
    throw new Error("Workbook source does not match the currently loaded model.");
  }

  const rows = worksheetRows(dataSheet);
  const headerRow = rows[0] ?? [];
  const headerIndex = new Map<string, number>();
  const duplicateHeaders = new Set<string>();
  for (const [index, value] of headerRow.entries()) {
    const header = String(value ?? "");
    if (headerIndex.has(header)) {
      duplicateHeaders.add(header);
      continue;
    }

    headerIndex.set(header, index);
  }

  for (const requiredColumn of TECHNICAL_COLUMNS) {
    if (!headerIndex.has(requiredColumn)) {
      throw new Error(`Workbook is missing the required ${requiredColumn} column.`);
    }
  }

  const baseRowMap = new Map(input.baseData.rows.map((row) => [row.key, row]));
  const currentRowMap = new Map(input.currentData.rows.map((row) => [row.key, row]));
  const baseColumnMap = new Map(input.baseData.columns.map((column) => [column.key, column]));
  const currentColumnMap = new Map(input.currentData.columns.map((column) => [column.key, column]));
  const edits: ViewerDataTableEdit[] = [];
  const issues: ViewerDataTableIssue[] = [];
  const importedColumnMap = new Map<string, ViewerDataTableColumn>();
  const knownHeaders = new Set(metaColumns.map((metaColumn) => metaColumn.header));
  const workbookColumns: Array<{ header: string; column: ViewerDataTableColumn }> = [];

  for (const duplicateHeader of duplicateHeaders) {
    if (TECHNICAL_COLUMNS.includes(duplicateHeader as (typeof TECHNICAL_COLUMNS)[number])) {
      continue;
    }

    issues.push({
      rowKey: null,
      columnKey: null,
      message: `Skipped duplicate workbook column "${duplicateHeader}".`,
    });
  }

  for (const metaColumn of metaColumns) {
    const existingColumn =
      currentColumnMap.get(metaColumn.columnKey) ?? baseColumnMap.get(metaColumn.columnKey);
    const resolvedImportedColumn =
      metaColumn.origin === "import" ? buildImportedColumnFromMeta(metaColumn) : null;
    const column = existingColumn ?? resolvedImportedColumn;
    if (!column) {
      issues.push({
        rowKey: null,
        columnKey: metaColumn.columnKey,
        message: "Skipped a column that no longer exists.",
      });
      continue;
    }

    if (duplicateHeaders.has(metaColumn.header)) {
      continue;
    }

    if (!headerIndex.has(metaColumn.header)) {
      continue;
    }

    workbookColumns.push({ header: metaColumn.header, column });

    if (column.origin === "import") {
      importedColumnMap.set(column.key, column);
    }
  }

  for (const [header, columnIndex] of headerIndex.entries()) {
    if (
      !header ||
      TECHNICAL_COLUMNS.includes(header as (typeof TECHNICAL_COLUMNS)[number]) ||
      knownHeaders.has(header)
    ) {
      continue;
    }

    if (duplicateHeaders.has(header)) {
      continue;
    }

    const values = rows
      .slice(1)
      .map((row) => row[columnIndex])
      .filter((value) => normalizeDisplayValue(value).length > 0);
    const candidateColumn = buildImportedColumnFromHeader(header, values);
    if (!candidateColumn) {
      continue;
    }

    const existingColumn =
      currentColumnMap.get(candidateColumn.key) ?? baseColumnMap.get(candidateColumn.key);
    const column = existingColumn ?? candidateColumn;

    if (workbookColumns.some((entry) => entry.column.key === column.key)) {
      issues.push({
        rowKey: null,
        columnKey: column.key,
        message: `Skipped workbook column "${header}" because another column already maps to the same IFC property.`,
      });
      continue;
    }

    workbookColumns.push({ header, column });

    if (column.origin === "import") {
      importedColumnMap.set(column.key, column);
    }
  }

  for (const row of rows.slice(1)) {
    const rowKey = String(row[headerIndex.get("__rowKey") ?? -1] ?? "").trim();
    if (!rowKey) {
      continue;
    }

    const baseRow = baseRowMap.get(rowKey);
    const currentRow = currentRowMap.get(rowKey);
    if (!baseRow || !currentRow) {
      issues.push({
        rowKey,
        columnKey: null,
        message: "Skipped a row that does not exist in the current model.",
      });
      continue;
    }

    for (const workbookColumn of workbookColumns) {
      const column = workbookColumn.column;
      const columnIndex = headerIndex.get(workbookColumn.header);
      if (typeof columnIndex === "undefined") {
        continue;
      }

      const workbookValue = row[columnIndex];
      if (isEmptyWorkbookImportValue(workbookValue)) {
        continue;
      }

      if (!column.editable) {
        if (
          normalizeDisplayValue(workbookValue) !==
          normalizeDisplayValue(toWorkbookCellValue(currentRow, column))
        ) {
          issues.push({
            rowKey,
            columnKey: column.key,
            message: column.editableReason ?? "This column is read-only.",
          });
        }
        continue;
      }

      const coerced = coerceViewerDataTableInputValue(workbookValue, column.valueKind);
      if (!coerced.ok) {
        issues.push({ rowKey, columnKey: column.key, message: coerced.message });
        continue;
      }

      const baseCell = baseRow.cells[column.key];
      const draftValue = coerced.value;
      if (
        baseCell &&
        baseCell.state === draftValue.state &&
        baseCell.text === draftValue.text &&
        baseCell.raw === draftValue.raw
      ) {
        continue;
      }

      if (!baseCell && draftValue.state === "missing") {
        continue;
      }

      edits.push({
        rowKey,
        columnKey: column.key,
        value: draftValue,
      });
    }
  }

  const importedColumns = [...new Set(edits.map((edit) => edit.columnKey))]
    .map((columnKey) => importedColumnMap.get(columnKey))
    .filter((column): column is ViewerDataTableColumn => Boolean(column));
  const draft: ViewerDataTableDraft | null =
    edits.length > 0 || importedColumns.length > 0
      ? createViewerDataTableDraft(input.sourceId, edits, importedColumns)
      : null;

  return {
    draft,
    report: {
      fileName: input.fileName,
      appliedEditCount: edits.length,
      skippedCellCount: issues.length,
      issues,
    } satisfies ViewerDataTableImportReport,
  };
}
