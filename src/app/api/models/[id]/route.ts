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
