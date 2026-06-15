import {
  DATA_TABLE_EXCEL_MIME_TYPE,
  buildViewerDataTableExcelBytes,
} from "@/features/viewer/lib/data-table-excel-core";
import type { ViewerDataTableData } from "@/features/viewer/types";

function attachmentFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-") || "corey-data-table.xlsx";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      data?: ViewerDataTableData;
      sourceId?: string;
      fileName?: string;
    };

    if (!body.sourceId || !body.data) {
      return Response.json({ error: "Excel export requires sourceId and data." }, { status: 400 });
    }

    const bytes = await buildViewerDataTableExcelBytes({
      data: body.data,
      sourceId: body.sourceId,
    });
    const fileName = attachmentFileName(body.fileName ?? "corey-data-table.xlsx");

    return new Response(bytes, {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": DATA_TABLE_EXCEL_MIME_TYPE,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Excel export failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
