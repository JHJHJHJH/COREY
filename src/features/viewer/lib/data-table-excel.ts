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
  ViewerDataTableImportReport,
  ViewerDataTableIssue,
} from "@/features/viewer/types";

const VIEWER_DATA_TABLE_WORKBOOK_VERSION = 1;
const DATA_SHEET_NAME = "Data Table";
const META_SHEET_NAME = "_corey_meta";
const TECHNICAL_COLUMNS = ["__rowKey", "__modelId", "__localId"] as const;

type SheetJsModule = {
  read: (data: ArrayBuffer, options: Record<string, unknown>) => Workbook;
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
};

async function loadSheetJs(): Promise<SheetJsModule> {
  return (await import("xlsx")) as unknown as SheetJsModule;
}

function downloadArrayBuffer(bytes: ArrayBuffer, fileName: string, type: string) {
  const blob = new Blob([bytes], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
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

  return `${column.group} - ${column.label}`;
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
  });

  downloadArrayBuffer(
    bytes,
    input.fileName.toLowerCase().endsWith(".xlsx") ? input.fileName : `${input.fileName}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

export async function importViewerDataTableFromExcel(input: {
  file: File;
  sourceId: string;
  baseData: ViewerDataTableData;
  currentData: ViewerDataTableData;
}) {
  const XLSX = await loadSheetJs();
  const workbook = XLSX.read(await input.file.arrayBuffer(), {
    type: "array",
    raw: true,
  });
  const dataSheet = workbook.Sheets[DATA_SHEET_NAME];
  const metaSheet = workbook.Sheets[META_SHEET_NAME];

  if (!dataSheet || !metaSheet) {
    throw new Error("Workbook is missing the required Data Table or _corey_meta sheet.");
  }

  const metaRows = XLSX.utils.sheet_to_json(metaSheet, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  const { settings, columns: metaColumns } = parseMetaRows(metaRows);
  const version = Number(settings.get("version") ?? Number.NaN);
  const workbookSourceId = settings.get("sourceId") ?? "";

  if (version !== VIEWER_DATA_TABLE_WORKBOOK_VERSION) {
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
  for (const [index, value] of headerRow.entries()) {
    headerIndex.set(String(value), index);
  }

  for (const requiredColumn of TECHNICAL_COLUMNS) {
    if (!headerIndex.has(requiredColumn)) {
      throw new Error(`Workbook is missing the required ${requiredColumn} column.`);
    }
  }

  const baseRowMap = new Map(input.baseData.rows.map((row) => [row.key, row]));
  const currentRowMap = new Map(input.currentData.rows.map((row) => [row.key, row]));
  const columnMap = new Map(input.baseData.columns.map((column) => [column.key, column]));
  const edits: ViewerDataTableEdit[] = [];
  const issues: ViewerDataTableIssue[] = [];

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

    for (const metaColumn of metaColumns) {
      const column = columnMap.get(metaColumn.columnKey);
      if (!column) {
        issues.push({
          rowKey,
          columnKey: metaColumn.columnKey,
          message: "Skipped a column that no longer exists.",
        });
        continue;
      }

      const columnIndex = headerIndex.get(metaColumn.header);
      if (typeof columnIndex === "undefined") {
        continue;
      }

      const workbookValue = row[columnIndex];
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

  const draft: ViewerDataTableDraft | null =
    edits.length > 0 ? createViewerDataTableDraft(input.sourceId, edits) : null;

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
  return name.toLowerCase().endsWith(".ifc")
    ? `${name.slice(0, Math.max(0, name.length - 4))}.xlsx`
    : `${name}.xlsx`;
}

export function buildViewerDataTableIfcFileName(name: string) {
  return name.toLowerCase().endsWith(".ifc")
    ? `${name.slice(0, Math.max(0, name.length - 4))}.edited.ifc`
    : `${name}.edited.ifc`;
}
