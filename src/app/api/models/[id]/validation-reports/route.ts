import {
  listViewerValidationReports,
  saveViewerValidationReport,
} from "@/server/validation-report-store";

type ModelValidationReportsRouteContext = {
  params: Promise<{ id: string }>;
};

function getReportInput(body: unknown) {
  if (typeof body === "object" && body !== null && !Array.isArray(body) && "report" in body) {
    return (body as { report: unknown }).report;
  }

  return body;
}

export async function GET(_request: Request, { params }: ModelValidationReportsRouteContext) {
  try {
    const { id } = await params;
    const result = await listViewerValidationReports(id);

    if (!result.modelFound) {
      return Response.json({ error: "Model not found." }, { status: 404 });
    }

    return Response.json({ reports: result.reports });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation reports could not be listed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: ModelValidationReportsRouteContext) {
  try {
    const { id } = await params;
    const body = (await request.json()) as unknown;
    const result = await saveViewerValidationReport(id, getReportInput(body));

    if (!result.modelFound) {
      return Response.json({ error: "Model not found." }, { status: 404 });
    }

    return Response.json(result.report, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation report could not be saved.";
    return Response.json({ error: message }, { status: 400 });
  }
}
