import type { ServerModelSummary } from "@/features/viewer/types";

/**
 * Client helpers for the server model catalog (`/api/models`).
 *
 * Reading model bytes is the job of `RemoteModelSource`; these cover the
 * catalog-level operations (list + upload) used by the viewer shell.
 */

/**
 * Reports whether server-side model storage (MinIO + Postgres) is configured.
 *
 * `/api/health` builds the backend env, which throws (→ 503) when the S3 or
 * database settings are missing. A clean `ok` means uploads will persist.
 */
export async function isServerStorageAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json().catch(() => null)) as { status?: string } | null;
    return body?.status === "ok";
  } catch {
    return false;
  }
}

export async function listServerModels(): Promise<ServerModelSummary[]> {
  const response = await fetch("/api/models", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Server models could not be listed (${response.status}).`);
  }

  const body = (await response.json()) as { models: ServerModelSummary[] };
  return body.models;
}

export async function deleteServerModel(modelId: string): Promise<void> {
  const response = await fetch(`/api/models/${modelId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Model could not be deleted (${response.status}).`);
  }
}

export async function uploadModelToServer(
  name: string,
  body: BodyInit,
): Promise<ServerModelSummary> {
  const response = await fetch("/api/models", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-model-name": encodeURIComponent(name),
    },
    body,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Model upload failed (${response.status}).`);
  }

  return (await response.json()) as ServerModelSummary;
}
