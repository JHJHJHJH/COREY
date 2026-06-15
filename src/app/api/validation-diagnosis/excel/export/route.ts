import {
  DATA_TABLE_EXCEL_MIME_TYPE,
  buildViewerValidationDiagnosisExcelBytes,
} from "@/features/viewer/lib/data-table-excel-core";
import { parseStoredViewerValidationDiagnosisReport } from "@/features/viewer/lib/validation-report";

function attachmentFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-") || "corey-validation-diagnosis.xlsx";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      report?: unknown;
      fileName?: string;
    };

    if (!body.report || typeof body.report !== "object" || !("sourceId" in body.report)) {
      return Response.json({ error: "Diagnosis export requires a report." }, { status: 400 });
    }

    const sourceId = String((body.report as { sourceId?: unknown }).sourceId ?? "");
    const report = parseStoredViewerValidationDiagnosisReport(sourceId, body.report);
    const bytes = await buildViewerValidationDiagnosisExcelBytes({ report });
    const fileName = attachmentFileName(body.fileName ?? "corey-validation-diagnosis.xlsx");

    return new Response(bytes, {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": DATA_TABLE_EXCEL_MIME_TYPE,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diagnosis Excel export failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
