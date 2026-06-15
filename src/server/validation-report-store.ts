import {
  parseStoredViewerValidationDiagnosisReport,
  serializeViewerValidationDiagnosisReport,
} from "@/features/viewer/lib/validation-report";
import type {
  ViewerValidationDiagnosisReport,
  ViewerValidationReportRecord,
  ViewerValidationReportSummary,
} from "@/features/viewer/types";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

type ValidationReportStoreListResult = {
  modelFound: boolean;
  reports: ViewerValidationReportSummary[];
};

type ValidationReportStoreRecordResult = {
  modelFound: boolean;
  report: ViewerValidationReportRecord | null;
};

type ValidationReportRow = {
  id: string;
  modelId: string;
  sourceId: string;
  modelName: string | null;
  flaggedElementCount: number;
  warnElementCount: number;
  errorElementCount: number;
  failedClauseCount: number;
  createdAt: Date;
};

async function modelRecordExists(modelId: string) {
  const count = await prisma.modelRecord.count({ where: { id: modelId } });
  return count > 0;
}

function toSummary(row: ValidationReportRow): ViewerValidationReportSummary {
  return {
    reportId: row.id,
    modelId: row.modelId,
    sourceId: row.sourceId,
    modelName: row.modelName,
    flaggedElementCount: row.flaggedElementCount,
    warnElementCount: row.warnElementCount,
    errorElementCount: row.errorElementCount,
    failedClauseCount: row.failedClauseCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRecord(
  row: ValidationReportRow,
  report: ViewerValidationDiagnosisReport,
): ViewerValidationReportRecord {
  return {
    ...toSummary(row),
    report,
  };
}

export async function listViewerValidationReports(
  modelId: string,
): Promise<ValidationReportStoreListResult> {
  if (!(await modelRecordExists(modelId))) {
    return { modelFound: false, reports: [] };
  }

  const rows = await prisma.validationReportRecord.findMany({
    where: { modelId },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return {
    modelFound: true,
    reports: rows.map(toSummary),
  };
}

export async function getViewerValidationReport(
  modelId: string,
  reportId: string,
): Promise<ValidationReportStoreRecordResult> {
  if (!(await modelRecordExists(modelId))) {
    return { modelFound: false, report: null };
  }

  const row = await prisma.validationReportRecord.findFirst({
    where: { id: reportId, modelId },
  });
  if (!row) {
    return { modelFound: true, report: null };
  }

  try {
    return {
      modelFound: true,
      report: toRecord(row, parseStoredViewerValidationDiagnosisReport(modelId, row.report)),
    };
  } catch {
    return { modelFound: true, report: null };
  }
}

export async function saveViewerValidationReport(
  modelId: string,
  input: unknown,
): Promise<ValidationReportStoreRecordResult> {
  if (!(await modelRecordExists(modelId))) {
    return { modelFound: false, report: null };
  }

  const report = parseStoredViewerValidationDiagnosisReport(modelId, input);
  const persistedReport = serializeViewerValidationDiagnosisReport(report) as unknown as Prisma.InputJsonValue;

  const row = await prisma.validationReportRecord.create({
    data: {
      modelId,
      sourceId: report.sourceId,
      modelName: report.modelName,
      flaggedElementCount: report.flaggedElementCount,
      warnElementCount: report.warnElementCount,
      errorElementCount: report.errorElementCount,
      failedClauseCount: report.failedClauseCount,
      report: persistedReport,
    },
  });

  return {
    modelFound: true,
    report: toRecord(row, report),
  };
}

export async function deleteViewerValidationReport(modelId: string, reportId: string) {
  if (!(await modelRecordExists(modelId))) {
    return { modelFound: false as const };
  }

  await prisma.validationReportRecord.deleteMany({
    where: { id: reportId, modelId },
  });

  return { modelFound: true as const };
}
