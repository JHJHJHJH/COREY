import { getUserIdOrResponse } from "@/server/identity";
import { getModelStorageUnavailableResponse } from "@/server/model-storage-status";
import { getModelStore } from "@/server/model-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const storageUnavailable = getModelStorageUnavailableResponse();
  if (storageUnavailable) return storageUnavailable;

  const { id } = await params;
  const store = getModelStore();
  const summary = await store.getMetadata(id, userId);

  if (!summary) {
    return Response.json({ error: "Model not found." }, { status: 404 });
  }

  return Response.json(summary);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const storageUnavailable = getModelStorageUnavailableResponse();
  if (storageUnavailable) return storageUnavailable;

  const { id } = await params;
  const store = getModelStore();
  const deleted = await store.delete(id, userId);

  if (!deleted) {
    return Response.json({ error: "Model not found." }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
