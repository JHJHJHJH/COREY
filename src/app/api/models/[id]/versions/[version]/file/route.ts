import { getUserIdOrResponse } from "@/server/identity";
import { getModelStorageUnavailableResponse } from "@/server/model-storage-status";
import { getModelStore } from "@/server/model-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const storageUnavailable = getModelStorageUnavailableResponse();
  if (storageUnavailable) return storageUnavailable;

  const { id, version } = await params;
  const versionNumber = Number.parseInt(version, 10);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    return Response.json({ error: "Invalid version number." }, { status: 400 });
  }

  const store = getModelStore();
  const bytes = await store.getVersionBytes(id, userId, versionNumber);

  if (!bytes) {
    return Response.json({ error: "Model version not found." }, { status: 404 });
  }

  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
