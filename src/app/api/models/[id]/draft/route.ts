import {
  clearViewerDataTableDraft,
  getViewerDataTableDraft,
  saveViewerDataTableDraft,
} from "@/server/data-table-draft-store";

type ModelDraftRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: ModelDraftRouteContext) {
  try {
    const { id } = await params;
    const result = await getViewerDataTableDraft(id);

    if (!result.modelFound) {
      return Response.json({ error: "Model not found." }, { status: 404 });
    }

    return Response.json({ draft: result.draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Data-table draft could not be read.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: ModelDraftRouteContext) {
  try {
    const { id } = await params;
    const body = (await request.json()) as unknown;
    const result = await saveViewerDataTableDraft(id, body);

    if (!result.modelFound) {
      return Response.json({ error: "Model not found." }, { status: 404 });
    }

    return Response.json({ draft: result.draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Data-table draft could not be saved.";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: ModelDraftRouteContext) {
  try {
    const { id } = await params;
    const result = await clearViewerDataTableDraft(id);

    if (!result.modelFound) {
      return Response.json({ error: "Model not found." }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Data-table draft could not be cleared.";
    return Response.json({ error: message }, { status: 500 });
  }
}
