import {
  deleteViewerValidationReport,
  getViewerValidationReport,
} from "@/server/validation-report-store";

type ModelValidationReportRouteContext = {
  params: Promise<{ id: string; reportId: string }>;
};

export async function GET(_request: Request, { params }: ModelValidationReportRouteContext) {
  try {
    const { id, reportId } = await params;
    const result = await getViewerValidationReport(id, reportId);

    if (!result.modelFound) {
      return Response.json({ error: "Model not found." }, { status: 404 });
    }

    if (!result.report) {
      return Response.json({ error: "Validation report not found." }, { status: 404 });
    }

    return Response.json(result.report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation report could not be read.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: ModelValidationReportRouteContext) {
  try {
    const { id, reportId } = await params;
    const result = await deleteViewerValidationReport(id, reportId);

    if (!result.modelFound) {
      return Response.json({ error: "Model not found." }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation report could not be deleted.";
    return Response.json({ error: message }, { status: 500 });
  }
}
