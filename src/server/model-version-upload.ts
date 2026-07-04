import type {
  ModelCompareElementRef,
  ModelVersionChangeSummary,
  ServerModelVersionSummary,
} from "@/features/viewer/types";
import {
  buildIfcElementSnapshots,
  diffIfcElementSnapshots,
} from "@/features/viewer/lib/ifc-compare-core";
import { getModelStore } from "@/server/model-store";

// The stored log only needs headline counts plus a few example names for
// tooltips; full lists stay available through the on-demand compare route.
const SUMMARY_EXAMPLE_COUNT = 3;

function exampleNames(entries: ModelCompareElementRef[]): string[] {
  return entries
    .slice(0, SUMMARY_EXAMPLE_COUNT)
    .map((entry) => entry.name ?? entry.globalId);
}

/**
 * Stores a new version of a model, first diffing it against the current
 * latest version so the version row carries its change-log entry. A summary
 * failure (e.g. an unparsable previous file) never fails the upload — a
 * `failed` marker is stored instead. Returns null when the model is unknown
 * or not owned by the user.
 */
export async function addVersionWithChangeSummary(input: {
  modelId: string;
  ownerId: string;
  bytes: Uint8Array;
  label?: string | null;
}): Promise<ServerModelVersionSummary | null> {
  const store = getModelStore();

  const versions = await store.listVersions(input.modelId, input.ownerId);
  if (!versions) {
    return null;
  }

  const previous = versions[0] ?? null;
  let changeSummary: ModelVersionChangeSummary | null = null;

  if (previous) {
    try {
      const previousBytes = await store.getVersionBytes(
        input.modelId,
        input.ownerId,
        previous.versionNumber,
      );
      if (!previousBytes) {
        throw new Error(`bytes of version ${previous.versionNumber} are missing`);
      }

      // Sequential parses: one open model at a time, two snapshot maps peak.
      const baseSnapshot = await buildIfcElementSnapshots(previousBytes);
      const targetSnapshot = await buildIfcElementSnapshots(input.bytes);
      const diff = diffIfcElementSnapshots(baseSnapshot, targetSnapshot, {
        maxEntriesPerList: SUMMARY_EXAMPLE_COUNT,
        maxFieldChangesPerElement: 1,
      });

      changeSummary = {
        comparedToVersion: previous.versionNumber,
        baseElementCount: diff.baseElementCount,
        targetElementCount: diff.targetElementCount,
        addedCount: diff.addedCount,
        removedCount: diff.removedCount,
        changedCount: diff.changedCount,
        examples: {
          added: exampleNames(diff.added),
          removed: exampleNames(diff.removed),
          changed: exampleNames(diff.changed),
        },
        computedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        `Change summary for model ${input.modelId} (vs v${previous.versionNumber}) failed:`,
        error,
      );
      changeSummary = {
        comparedToVersion: previous.versionNumber,
        baseElementCount: 0,
        targetElementCount: 0,
        addedCount: 0,
        removedCount: 0,
        changedCount: 0,
        examples: { added: [], removed: [], changed: [] },
        computedAt: new Date().toISOString(),
        failed: true,
      };
    }
  }

  return store.addVersion({ ...input, changeSummary });
}
