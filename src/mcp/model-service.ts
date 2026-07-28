import { createHash } from "node:crypto";
import { buildHeadlessViewerModelData } from "@/features/viewer/lib/ifc-model-index";
import { buildIfcSpatialGeometryIndex } from "@/features/viewer/lib/ifc-spatial-geometry";
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
import type {
  CoreyMcpBounds,
  CoreyMcpSpatialIndex,
} from "@/features/viewer/mcp/contracts";
import { CoreyApiClient } from "@/mcp/corey-api";

type BaseIndex = {
  data: ViewerDataTableData;
  spatial: CoreyMcpSpatialIndex;
  boundsByGlobalId: Map<string, CoreyMcpBounds>;
  modelBounds: CoreyMcpBounds | null;
  warnings: string[];
};

export type StoredModelContext = {
  metadata: ServerModelSummary;
  baseData: ViewerDataTableData;
  data: ViewerDataTableData;
  spatial: CoreyMcpSpatialIndex;
  boundsByGlobalId: Map<string, CoreyMcpBounds>;
  modelBounds: CoreyMcpBounds | null;
  warnings: string[];
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
      .then(async (bytes) => {
        const modelData = await buildHeadlessViewerModelData(bytes, metadata.name);
        const spatialGeometry = await buildIfcSpatialGeometryIndex(bytes);
        return {
          data: modelData.data,
          spatial: spatialGeometry.spatial,
          boundsByGlobalId: spatialGeometry.boundsByGlobalId,
          modelBounds: spatialGeometry.modelBounds,
          warnings: [...modelData.snapshot.warnings, ...spatialGeometry.warnings],
        };
      })
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
      clauses: rules.clauses,
      rows,
    });
    const revision = createHash("sha256")
      .update(
        JSON.stringify({
          version: metadata.latestVersion ?? 1,
          draft: draft?.updatedAt ?? null,
          clauses: rules.clauses,
        }),
      )
      .digest("base64url");

    return {
      metadata,
      baseData: base.data,
      data,
      spatial: base.spatial,
      boundsByGlobalId: base.boundsByGlobalId,
      modelBounds: base.modelBounds,
      warnings: base.warnings,
      draft,
      validation,
      revision,
    };
  }

  async saveDraft(userId: string, modelId: string, draft: ViewerDataTableDraft | null) {
    return this.api.putDraft(userId, modelId, draft);
  }
}
