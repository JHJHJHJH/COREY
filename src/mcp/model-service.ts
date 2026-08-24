import { buildHeadlessViewerModelIndex } from "@/features/viewer/lib/ifc-model-index";
import { applyViewerDataTableDraft } from "@/features/viewer/lib/data-table-draft";
import {
  buildViewerValidationRows,
  evaluateViewerValidationPayload,
  VIEWER_VALIDATION_CONFIG_VERSION,
} from "@/features/rules/lib/validation";
import type {
  ServerModelSummary,
  ViewerDataTableData,
  ViewerDataTableDraft,
  ViewerValidationRunResult,
} from "@/features/viewer/types";
import { CoreyApiClient } from "@/mcp/corey-api";

type BaseIndex = Awaited<ReturnType<typeof buildHeadlessViewerModelIndex>>;

type StoredModelContext = {
  metadata: ServerModelSummary;
  baseData: ViewerDataTableData;
  data: ViewerDataTableData;
  draft: ViewerDataTableDraft | null;
  validation: ViewerValidationRunResult;
  revision: string;
};

export class StoredModelService {
  private readonly cache = new Map<string, Promise<BaseIndex>>();

  constructor(
    private readonly api: CoreyApiClient,
    private readonly maxCacheEntries = 3,
  ) {}

  private touch(key: string, value: Promise<BaseIndex>) {
    this.cache.delete(key);
    this.cache.set(key, value);
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }

  private async getBaseIndex(userId: string, metadata: ServerModelSummary) {
    const key = `${userId}:${metadata.modelId}:${metadata.latestVersion ?? 1}`;
    const existing = this.cache.get(key);
    if (existing) {
      this.touch(key, existing);
      return existing;
    }

    const pending = this.api
      .getModelBytes(userId, metadata.modelId)
      .then((bytes) => buildHeadlessViewerModelIndex(bytes, metadata.name))
      .catch((error) => {
        this.cache.delete(key);
        throw error;
      });
    this.touch(key, pending);
    return pending;
  }

  async getContext(userId: string, modelId: string): Promise<StoredModelContext> {
    const metadata = await this.api.getModel(userId, modelId);
    const [base, draft, rules] = await Promise.all([
      this.getBaseIndex(userId, metadata),
      this.api.getDraft(userId, modelId),
      this.api.getRules(userId),
    ]);
    const data = applyViewerDataTableDraft(base.data, draft);
    const rows = buildViewerValidationRows(data, rules.clauses);
    const validation = await evaluateViewerValidationPayload({
      version: VIEWER_VALIDATION_CONFIG_VERSION,
      sourceId: modelId,
      severities: rules.severities,
      clauses: rules.clauses,
      rows,
    });
    const revision = [
      metadata.latestVersion ?? 1,
      draft?.updatedAt ?? "no-draft",
      JSON.stringify(rules.clauses),
      JSON.stringify(rules.severities),
    ].join(":");

    return {
      metadata,
      baseData: base.data,
      data,
      draft,
      validation,
      revision,
    };
  }

  async saveDraft(
    userId: string,
    modelId: string,
    draft: ViewerDataTableDraft | null,
  ) {
    return this.api.putDraft(userId, modelId, draft);
  }
}
