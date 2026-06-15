import { parseStoredViewerDataTableDraft } from "@/features/viewer/lib/data-table-draft";
import { parseViewerDataTableExcelBytes } from "@/features/viewer/lib/data-table-excel-core";
import type { ViewerDataTableData } from "@/features/viewer/types";

function parseJsonField<T>(formData: FormData, name: string): T {
  const value = formData.get(name);
  if (typeof value !== "string") {
    throw new Error(`Excel import requires ${name}.`);
  }

  return JSON.parse(value) as T;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const sourceId = formData.get("sourceId");

    if (!(file instanceof File)) {
      return Response.json({ error: "Excel import requires a workbook file." }, { status: 400 });
    }

    if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
      return Response.json({ error: "Excel import requires sourceId." }, { status: 400 });
    }

    const result = await parseViewerDataTableExcelBytes({
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      sourceId,
      baseData: parseJsonField<ViewerDataTableData>(formData, "baseData"),
      currentData: parseJsonField<ViewerDataTableData>(formData, "currentData"),
    });

    return Response.json({
      draft: result.draft ? parseStoredViewerDataTableDraft(sourceId, result.draft) : null,
      report: result.report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Excel import failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
