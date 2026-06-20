"use client";

import {
  DATA_TABLE_EXCEL_MIME_TYPE,
  buildViewerDataTableExcelBytes,
  parseViewerDataTableExcelBytes,
} from "@/features/viewer/lib/data-table-excel-core";
import type {
  ViewerDataTableData,
  ViewerDataTableImportReport,
  ViewerDataTableDraft,
} from "@/features/viewer/types";

async function saveBytes(bytes: Uint8Array, fileName: string, type: string) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type });
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

export async function exportViewerDataTableToExcel(input: {
  data: ViewerDataTableData;
  sourceId: string;
  fileName: string;
}) {
  const bytes = await buildViewerDataTableExcelBytes({
    data: input.data,
    sourceId: input.sourceId,
  });
  await saveBytes(bytes, input.fileName, DATA_TABLE_EXCEL_MIME_TYPE);
  return { fileName: input.fileName };
}

export async function importViewerDataTableFromExcel(input: {
  file: File;
  sourceId: string;
  baseData: ViewerDataTableData;
  currentData: ViewerDataTableData;
}): Promise<{ draft: ViewerDataTableDraft | null; report: ViewerDataTableImportReport }> {
  return parseViewerDataTableExcelBytes({
    bytes: new Uint8Array(await input.file.arrayBuffer()),
    fileName: input.file.name,
    sourceId: input.sourceId,
    baseData: input.baseData,
    currentData: input.currentData,
  });
}

export function buildViewerDataTableExcelFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "model";
  return `${base}-data-table.xlsx`;
}

export function buildViewerDataTableIfcFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "model";
  return `${base}-edited.ifc`;
}
