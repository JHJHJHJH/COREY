import {
  parseStoredViewerDataTableDraft,
  serializeViewerDataTableDraft,
} from "@/features/viewer/lib/data-table-draft";
import type { ViewerDataTableDraft } from "@/features/viewer/types";

function draftEndpoint(modelId: string) {
  return `/api/models/${encodeURIComponent(modelId)}/draft`;
}

export async function readServerViewerDataTableDraft(
  modelId: string,
  signal?: AbortSignal,
): Promise<ViewerDataTableDraft | null> {
  const response = await fetch(draftEndpoint(modelId), { cache: "no-store", signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Data-table draft could not be read (${response.status}).`);
  }

  const body = (await response.json()) as { draft: unknown };
  return body.draft ? parseStoredViewerDataTableDraft(modelId, body.draft) : null;
}

export async function writeServerViewerDataTableDraft(
  draft: ViewerDataTableDraft,
  signal?: AbortSignal,
): Promise<ViewerDataTableDraft | null> {
  const response = await fetch(draftEndpoint(draft.sourceId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializeViewerDataTableDraft(draft)),
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Data-table draft could not be saved (${response.status}).`);
  }

  const body = (await response.json()) as { draft: unknown };
  return body.draft ? parseStoredViewerDataTableDraft(draft.sourceId, body.draft) : null;
}

export async function clearServerViewerDataTableDraft(
  modelId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(draftEndpoint(modelId), { method: "DELETE", signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Data-table draft could not be cleared (${response.status}).`);
  }
}
