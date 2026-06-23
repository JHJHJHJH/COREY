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
  const bytes = await store.getBytes(id, userId);

  if (!bytes) {
    return Response.json({ error: "Model not found." }, { status: 404 });
  }

  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
