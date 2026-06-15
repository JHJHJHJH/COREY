import { buildEditedIfcBytes } from "@/features/viewer/lib/ifc-writeback-core";
import type { ViewerDataTableData, ViewerDataTableIssue } from "@/features/viewer/types";
import { getModelStore } from "@/server/model-store";

type ModelWritebackRouteContext = {
  params: Promise<{ id: string }>;
};

function attachmentFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-") || "model.edited.ifc";
}

function encodeIssues(issues: ViewerDataTableIssue[]) {
  return encodeURIComponent(JSON.stringify(issues.slice(0, 20)));
}

export async function POST(request: Request, { params }: ModelWritebackRouteContext) {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      data?: ViewerDataTableData;
      fileName?: string;
    };

    if (!body.data) {
      return Response.json({ error: "IFC writeback requires data." }, { status: 400 });
    }

    const store = getModelStore();
    const [metadata, modelBytes] = await Promise.all([
      store.getMetadata(id),
      store.getBytes(id),
    ]);

    if (!metadata || !modelBytes) {
      return Response.json({ error: "Model not found." }, { status: 404 });
    }

    const result = await buildEditedIfcBytes({
      data: body.data,
      bytes: modelBytes,
    });

    if (result.phase !== "success" || !result.bytes) {
      return Response.json(
        {
          error: result.message,
          issues: result.issues,
        },
        { status: 400 },
      );
    }

    const fileName = attachmentFileName(body.fileName ?? `${metadata.name}.edited.ifc`);

    return new Response(result.bytes as BodyInit, {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(result.bytes.byteLength),
        "Content-Type": "application/octet-stream",
        "X-Corey-Applied-Count": String(result.appliedCount),
        "X-Corey-Issues": encodeIssues(result.issues),
        "X-Corey-Message": encodeURIComponent(result.message),
        "X-Corey-Skipped-Count": String(result.issues.length),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "IFC writeback failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
