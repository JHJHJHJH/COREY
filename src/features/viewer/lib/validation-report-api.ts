import {
  parseStoredViewerValidationDiagnosisReport,
  serializeViewerValidationDiagnosisReport,
} from "@/features/viewer/lib/validation-report";
import type {
  ViewerValidationDiagnosisReport,
  ViewerValidationReportRecord,
  ViewerValidationReportSummary,
} from "@/features/viewer/types";

function reportsEndpoint(modelId: string) {
  return `/api/models/${encodeURIComponent(modelId)}/validation-reports`;
}

function reportEndpoint(modelId: string, reportId: string) {
  return `${reportsEndpoint(modelId)}/${encodeURIComponent(reportId)}`;
}

function parseReportRecord(modelId: string, input: unknown): ViewerValidationReportRecord {
  const record = input as ViewerValidationReportRecord;
  return {
    ...record,
    report: parseStoredViewerValidationDiagnosisReport(modelId, record.report),
  };
}

export async function listServerViewerValidationReports(
  modelId: string,
  signal?: AbortSignal,
): Promise<ViewerValidationReportSummary[]> {
  const response = await fetch(reportsEndpoint(modelId), { cache: "no-store", signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Validation reports could not be listed (${response.status}).`);
  }

  const body = (await response.json()) as { reports: ViewerValidationReportSummary[] };
  return body.reports;
}

export async function saveServerViewerValidationReport(
  modelId: string,
  report: ViewerValidationDiagnosisReport,
  signal?: AbortSignal,
): Promise<ViewerValidationReportRecord> {
  const response = await fetch(reportsEndpoint(modelId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report: serializeViewerValidationDiagnosisReport(report) }),
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Validation report could not be saved (${response.status}).`);
  }

  return parseReportRecord(modelId, await response.json());
}

export async function readServerViewerValidationReport(
  modelId: string,
  reportId: string,
  signal?: AbortSignal,
): Promise<ViewerValidationReportRecord> {
  const response = await fetch(reportEndpoint(modelId, reportId), { cache: "no-store", signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Validation report could not be read (${response.status}).`);
  }

  return parseReportRecord(modelId, await response.json());
}
