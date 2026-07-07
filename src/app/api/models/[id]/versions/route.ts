import { getMaxModelBytes } from "@/server/env";
import { getUserIdOrResponse } from "@/server/identity";
import { getModelStorageUnavailableResponse } from "@/server/model-storage-status";
import { getModelStore } from "@/server/model-store";
import { addVersionWithChangeSummary } from "@/server/model-version-upload";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const storageUnavailable = getModelStorageUnavailableResponse();
  if (storageUnavailable) return storageUnavailable;

  const { id } = await params;
  const store = getModelStore();
  const versions = await store.listVersions(id, userId);

  if (!versions) {
    return Response.json({ error: "Model not found." }, { status: 404 });
  }

  return Response.json({ versions });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const storageUnavailable = getModelStorageUnavailableResponse();
  if (storageUnavailable) return storageUnavailable;

  const { id } = await params;

  let versionNumbers: unknown;
  try {
    versionNumbers = ((await request.json()) as { versionNumbers?: unknown }).versionNumbers;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (
    !Array.isArray(versionNumbers) ||
    versionNumbers.length === 0 ||
    !versionNumbers.every((value) => Number.isInteger(value) && (value as number) >= 1)
  ) {
    return Response.json(
      { error: "versionNumbers must be a non-empty array of version numbers." },
      { status: 400 },
    );
  }

  const store = getModelStore();
  const result = await store.deleteVersions(id, userId, versionNumbers as number[]);

  if (result === null) {
    return Response.json({ error: "Model not found." }, { status: 404 });
  }

  if (result === "would-empty") {
    return Response.json(
      { error: "A model must keep at least one version — delete the model instead." },
      { status: 400 },
    );
  }

  return Response.json({ versions: result });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getUserIdOrResponse(request);
    if (userId instanceof Response) return userId;

    const storageUnavailable = getModelStorageUnavailableResponse();
    if (storageUnavailable) return storageUnavailable;

    const { id } = await params;
    const headerLabel = request.headers.get("x-version-label");
    const label = headerLabel ? decodeURIComponent(headerLabel).trim() || null : null;
    const maxModelBytes = getMaxModelBytes();
    const contentLength = Number(request.headers.get("content-length") ?? Number.NaN);

    if (Number.isFinite(contentLength) && contentLength > maxModelBytes) {
      return Response.json(
        {
          error: `Model upload is too large. Maximum size is ${formatBytes(maxModelBytes)}.`,
        },
        { status: 413 },
      );
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      return Response.json({ error: "Empty model upload." }, { status: 400 });
    }

    if (bytes.byteLength > maxModelBytes) {
      return Response.json(
        {
          error: `Model upload is too large. Maximum size is ${formatBytes(maxModelBytes)}.`,
        },
        { status: 413 },
      );
    }

    const version = await addVersionWithChangeSummary({
      modelId: id,
      ownerId: userId,
      bytes,
      label,
    });

    if (!version) {
      return Response.json({ error: "Model not found." }, { status: 404 });
    }

    return Response.json(version, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Version upload failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
