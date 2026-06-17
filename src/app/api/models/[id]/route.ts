import { getModelStore } from "@/server/model-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getModelStore();
  const summary = await store.getMetadata(id);

  if (!summary) {
    return Response.json({ error: "Model not found." }, { status: 404 });
  }

  return Response.json(summary);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getModelStore();
  const deleted = await store.delete(id);

  if (!deleted) {
    return Response.json({ error: "Model not found." }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
