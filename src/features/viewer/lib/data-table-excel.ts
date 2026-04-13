"use client";

import {
  coerceViewerDataTableInputValue,
  createViewerDataTableDraft,
} from "@/features/viewer/lib/data-table-draft";
import type {
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerDataTableDraft,
  ViewerDataTableEdit,
  ViewerDataTableEditableValueKind,
  ViewerDataTableImportReport,
  ViewerDataTableIssue,
  ViewerValidationDiagnosisReport,
} from "@/features/viewer/types";

const VIEWER_DATA_TABLE_WORKBOOK_VERSION = 2;
const DATA_SHEET_NAME = "Data Table";
const META_SHEET_NAME = "_corey_meta";
const DIAGNOSIS_CLAUSES_SHEET_NAME = "Clause Summary";
const DIAGNOSIS_ELEMENTS_SHEET_NAME = "Element Failures";
const TECHNICAL_COLUMNS = ["__rowKey", "__modelId", "__localId"] as const;
const IMPORTED_COLUMN_FALLBACK_GROUP = "Excel Import";
const WORKBOOK_GROUP_DELIMITER = "|||";

type SheetJsModule = {
  read: (data: ArrayBuffer | Uint8Array, options: Record<string, unknown>) => Workbook;
  write: (workbook: Workbook, options: Record<string, unknown>) => ArrayBuffer;
  utils: {
    aoa_to_sheet: (data: unknown[][]) => Worksheet;
    book_new: () => Workbook;
    book_append_sheet: (workbook: Workbook, worksheet: Worksheet, name: string) => void;
    sheet_to_json: (sheet: Worksheet, options: Record<string, unknown>) => unknown[][];
  };
};

type Workbook = {
  SheetNames: string[];
  Sheets: Record<string, Worksheet>;
  Workbook?: {
    Sheets?: Array<{
      Hidden?: number;
      name?: string;
    }>;
  };
};

type Worksheet = {
  ["!cols"]?: Array<{ hidden?: boolean }>;
};

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

async function loadSheetJs(): Promise<SheetJsModule> {
  return (await import("xlsx")) as unknown as SheetJsModule;
}

async function saveArrayBuffer(bytes: ArrayBuffer, fileName: string, type: string) {
  const payload = new Uint8Array(bytes);
  const blob = new Blob([payload], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 60_000);
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

  if (column.editable && (typeof cell.raw === "string" || typeof cell.raw === "number" || typeof cell.raw === "boolean")) {
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
  return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
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

    return {
      group,
      label,
    };
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
    binding: {
      kind: "property",
      group,
      label,
    },
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

function buildDiagnosisClauseRows(report: ViewerValidationDiagnosisReport) {
  return [
    ["Clause", "Severity", "FailingElements", "FailedChecks"],
    ...report.clauses.map((clause) => [
      clause.clauseTitle,
      clause.result,
      clause.elementCount,
      clause.ruleDescriptions.join(" | "),
    ]),
  ];
}

function buildDiagnosisElementRows(report: ViewerValidationDiagnosisReport) {
  return [
    ["Clause", "Severity", "Element", "IFCType", "GlobalId", "LocalId", "FailedChecks"],
    ...report.clauses.flatMap((clause) =>
      clause.elements.map((element) => [
        clause.clauseTitle,
        element.result,
        element.label,
        element.ifcType ?? "",
        element.globalId ?? "",
        element.localId,
        element.failedRuleDescriptions.join(" | "),
      ]),
    ),
  ];
}

export async function exportViewerDataTableToExcel(input: {
  data: ViewerDataTableData;
  sourceId: string;
  fileName: string;
}) {
  const XLSX = await loadSheetJs();
  const workbook = XLSX.utils.book_new();
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
  const dataSheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

  const metaSheet = XLSX.utils.aoa_to_sheet(buildMetaRows(input.sourceId, visibleColumns));

  XLSX.utils.book_append_sheet(workbook, dataSheet, DATA_SHEET_NAME);
  XLSX.utils.book_append_sheet(workbook, metaSheet, META_SHEET_NAME);
  workbook.Workbook = {
    Sheets: [
      { name: DATA_SHEET_NAME, Hidden: 0 },
      { name: META_SHEET_NAME, Hidden: 1 },
    ],
  };

  const bytes = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  });
  const verificationWorkbook = XLSX.read(bytes, {
    type: "array",
    raw: true,
  });
  const verificationSheetNames = verificationWorkbook.SheetNames.join(", ");

  if (
    !verificationWorkbook.Sheets[DATA_SHEET_NAME] ||
    !verificationWorkbook.Sheets[META_SHEET_NAME]
  ) {
    throw new Error(
      `Exported workbook verification failed. Found sheets: ${verificationSheetNames || "none"}.`,
    );
  }

  const fileName =
    input.fileName.toLowerCase().endsWith(".xlsx") ? input.fileName : `${input.fileName}.xlsx`;

  await saveArrayBuffer(
    bytes,
    fileName,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );

  return {
    fileName,
  };
}

export async function exportViewerValidationDiagnosisToExcel(input: {
  report: ViewerValidationDiagnosisReport;
  fileName: string;
}) {
  const XLSX = await loadSheetJs();
  const workbook = XLSX.utils.book_new();
  const clauseSheet = XLSX.utils.aoa_to_sheet(buildDiagnosisClauseRows(input.report));
  const elementSheet = XLSX.utils.aoa_to_sheet(buildDiagnosisElementRows(input.report));

  XLSX.utils.book_append_sheet(workbook, clauseSheet, DIAGNOSIS_CLAUSES_SHEET_NAME);
  XLSX.utils.book_append_sheet(workbook, elementSheet, DIAGNOSIS_ELEMENTS_SHEET_NAME);

  const bytes = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  });
  const verificationWorkbook = XLSX.read(bytes, {
    type: "array",
    raw: true,
  });

  if (
    !verificationWorkbook.Sheets[DIAGNOSIS_CLAUSES_SHEET_NAME] ||
    !verificationWorkbook.Sheets[DIAGNOSIS_ELEMENTS_SHEET_NAME]
  ) {
    const verificationSheetNames = verificationWorkbook.SheetNames.join(", ");
    throw new Error(
      `Exported diagnosis workbook verification failed. Found sheets: ${verificationSheetNames || "none"}.`,
    );
  }

  const fileName =
    input.fileName.toLowerCase().endsWith(".xlsx") ? input.fileName : `${input.fileName}.xlsx`;

  await saveArrayBuffer(
    bytes,
    fileName,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );

  return {
    fileName,
  };
}

export async function importViewerDataTableFromExcel(input: {
  file: File;
  sourceId: string;
  baseData: ViewerDataTableData;
  currentData: ViewerDataTableData;
}) {
  const XLSX = await loadSheetJs();
  const fileBytes = new Uint8Array(await input.file.arrayBuffer());
  const workbook = XLSX.read(fileBytes, {
    type: "array",
    raw: true,
  });
  const dataSheet = workbook.Sheets[DATA_SHEET_NAME];
  const metaSheet = workbook.Sheets[META_SHEET_NAME];

  if (!dataSheet || !metaSheet) {
    const sheetNames = workbook.SheetNames.length > 0 ? workbook.SheetNames.join(", ") : "none";
    const signature = formatByteSignature(fileBytes);
    throw new Error(
      `Workbook is missing the required Data Table or _corey_meta sheet. Found sheets: ${sheetNames}. Signature: ${signature || "none"}. Size: ${fileBytes.byteLength} bytes.`,
    );
  }

  const metaRows = XLSX.utils.sheet_to_json(metaSheet, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  const { settings, columns: metaColumns } = parseMetaRows(metaRows);
  const version = Number(settings.get("version") ?? Number.NaN);
  const workbookSourceId = settings.get("sourceId") ?? "";

  if (![1, VIEWER_DATA_TABLE_WORKBOOK_VERSION].includes(version)) {
    throw new Error(`Workbook version ${String(settings.get("version") ?? "unknown")} is not supported.`);
  }

  if (workbookSourceId !== input.sourceId) {
    throw new Error("Workbook source does not match the currently loaded model.");
  }

  const rows = XLSX.utils.sheet_to_json(dataSheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
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

    workbookColumns.push({
      header: metaColumn.header,
      column,
    });

    if (column.origin === "import") {
      importedColumnMap.set(column.key, column);
    }
  }

  for (const [header, columnIndex] of headerIndex.entries()) {
    if (!header || TECHNICAL_COLUMNS.includes(header as (typeof TECHNICAL_COLUMNS)[number]) || knownHeaders.has(header)) {
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

    workbookColumns.push({
      header,
      column,
    });

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
        if (normalizeDisplayValue(workbookValue) !== normalizeDisplayValue(toWorkbookCellValue(currentRow, column))) {
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
        issues.push({
          rowKey,
          columnKey: column.key,
          message: coerced.message,
        });
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
      fileName: input.file.name,
      appliedEditCount: edits.length,
      skippedCellCount: issues.length,
      issues,
    } satisfies ViewerDataTableImportReport,
  };
}

export function buildViewerDataTableExcelFileName(name: string) {
  const baseName = name.toLowerCase().endsWith(".ifc")
    ? name.slice(0, Math.max(0, name.length - 4))
    : name;
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  return `${baseName}.${timestamp}.xlsx`;
}

export function buildViewerDataTableIfcFileName(name: string) {
  return name.toLowerCase().endsWith(".ifc")
    ? `${name.slice(0, Math.max(0, name.length - 4))}.edited.ifc`
    : `${name}.edited.ifc`;
}

export function buildViewerValidationDiagnosisExcelFileName(name: string) {
  const baseName = name.toLowerCase().endsWith(".ifc")
    ? name.slice(0, Math.max(0, name.length - 4))
    : name;
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  return `${baseName}.clause-diagnosis.${timestamp}.xlsx`;
}
