import {
  parseStoredViewerDataTableDraft,
  serializeViewerDataTableDraft,
} from "@/features/viewer/lib/data-table-draft";
import type { ViewerDataTableDraft } from "@/features/viewer/types";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

type DraftStoreResult = {
  modelFound: boolean;
  draft: ViewerDataTableDraft | null;
};

// Drafts are private through their model: a draft is only reachable by the user
// that owns the underlying model record.
async function modelOwnedBy(modelId: string, ownerId: string) {
  const count = await prisma.modelRecord.count({ where: { id: modelId, ownerId } });
  return count > 0;
}

export async function getViewerDataTableDraft(
  modelId: string,
  ownerId: string,
): Promise<DraftStoreResult> {
  if (!(await modelOwnedBy(modelId, ownerId))) {
    return { modelFound: false, draft: null };
  }

  const row = await prisma.draftRecord.findUnique({ where: { modelId } });
  if (!row) {
    return { modelFound: true, draft: null };
  }

  try {
    return {
      modelFound: true,
      draft: parseStoredViewerDataTableDraft(modelId, row.draft),
    };
  } catch {
    // Corrupt/legacy stored draft — keep the model usable and let a later save
    // replace the bad row.
    return { modelFound: true, draft: null };
  }
}

export async function saveViewerDataTableDraft(
  modelId: string,
  ownerId: string,
  input: unknown,
): Promise<DraftStoreResult> {
  if (!(await modelOwnedBy(modelId, ownerId))) {
    return { modelFound: false, draft: null };
  }

  const draft = parseStoredViewerDataTableDraft(modelId, input);
  if (draft.edits.length === 0 && draft.importedColumns.length === 0) {
    await prisma.draftRecord.deleteMany({ where: { modelId } });
    return { modelFound: true, draft: null };
  }

  const persistedDraft = serializeViewerDataTableDraft(draft) as unknown as Prisma.InputJsonValue;

  await prisma.draftRecord.upsert({
    where: { modelId },
    create: { modelId, draft: persistedDraft },
    update: { draft: persistedDraft },
  });

  return { modelFound: true, draft };
}

export async function clearViewerDataTableDraft(modelId: string, ownerId: string) {
  if (!(await modelOwnedBy(modelId, ownerId))) {
    return { modelFound: false as const };
  }

  await prisma.draftRecord.deleteMany({ where: { modelId } });
  return { modelFound: true as const };
}
