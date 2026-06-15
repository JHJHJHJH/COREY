"use client";

import { parseStoredViewerDataTableDraft } from "@/features/viewer/lib/data-table-draft";
import type {
  ViewerDataTableData,
  ViewerDataTableExportStatus,
  ViewerDataTableImportReport,
  ViewerDataTableIssue,
  ViewerDataTableDraft,
  ViewerValidationDiagnosisReport,
} from "@/features/viewer/types";

type DataTableExcelImportResult = {
  draft: ViewerDataTableDraft | null;
  report: ViewerDataTableImportReport;
};

async function downloadResponse(response: Response, fallbackFileName: string) {
  const blob = await response.blob();
  const fileName = readAttachmentFileName(response.headers) ?? fallbackFileName;
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
  return fileName;
}

function readAttachmentFileName(headers: Headers) {
  const disposition = headers.get("content-disposition");
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    issues?: ViewerDataTableIssue[];
  } | null;

  return {
    message: body?.error ?? fallback,
    issues: body?.issues ?? [],
  };
}

function parseIssuesHeader(value: string | null): ViewerDataTableIssue[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    return Array.isArray(parsed) ? (parsed as ViewerDataTableIssue[]) : [];
  } catch {
    return [];
  }
}

export async function exportViewerDataTableToExcelViaApi(input: {
  data: ViewerDataTableData;
  sourceId: string;
  fileName: string;
}) {
  const response = await fetch("/api/data-table/excel/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await readError(response, `Excel export failed (${response.status}).`);
    throw new Error(error.message);
  }

  return {
    fileName: await downloadResponse(response, input.fileName),
  };
}

export async function importViewerDataTableFromExcelViaApi(input: {
  file: File;
  sourceId: string;
  baseData: ViewerDataTableData;
  currentData: ViewerDataTableData;
}): Promise<DataTableExcelImportResult> {
  const formData = new FormData();
  formData.set("file", input.file, input.file.name);
  formData.set("sourceId", input.sourceId);
  formData.set("baseData", JSON.stringify(input.baseData));
  formData.set("currentData", JSON.stringify(input.currentData));

  const response = await fetch("/api/data-table/excel/import", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await readError(response, `Excel import failed (${response.status}).`);
    throw new Error(error.message);
  }

  const body = (await response.json()) as { draft: unknown; report: ViewerDataTableImportReport };

  return {
    draft: body.draft ? parseStoredViewerDataTableDraft(input.sourceId, body.draft) : null,
    report: body.report,
  };
}

export async function exportViewerValidationDiagnosisToExcelViaApi(input: {
  report: ViewerValidationDiagnosisReport;
  fileName: string;
}) {
  const response = await fetch("/api/validation-diagnosis/excel/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await readError(response, `Diagnosis Excel export failed (${response.status}).`);
    throw new Error(error.message);
  }

  return {
    fileName: await downloadResponse(response, input.fileName),
  };
}

export async function exportEditedIfcViaApi(input: {
  modelId: string;
  data: ViewerDataTableData;
  fileName: string;
}): Promise<ViewerDataTableExportStatus> {
  const response = await fetch(`/api/models/${encodeURIComponent(input.modelId)}/writeback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: input.data,
      fileName: input.fileName,
    }),
  });

  if (!response.ok) {
    const error = await readError(response, `IFC writeback failed (${response.status}).`);
    return {
      phase: "error",
      message: error.message,
      issues: error.issues,
    };
  }

  await downloadResponse(response, input.fileName);

  const issueCount = Number(response.headers.get("x-corey-skipped-count") ?? 0);
  const message = decodeURIComponent(
    response.headers.get("x-corey-message") ?? "Exported edited IFC.",
  );

  return {
    phase: "success",
    message,
    issues:
      issueCount > 0
        ? parseIssuesHeader(response.headers.get("x-corey-issues"))
        : [],
  };
}
