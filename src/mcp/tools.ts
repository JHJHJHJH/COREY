import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getMcpElements,
  listMcpFields,
  prepareMcpDraftEdits,
  queryMcpElements,
  queryValidationIssues,
  validationSummary,
} from "@/features/viewer/mcp/query";
import {
  getMcpSpatialPath,
  listMcpSpatialChildren,
} from "@/features/viewer/mcp/spatial";
import { geometryResult } from "@/features/viewer/mcp/geometry";
import type {
  CoreyMcpBridgeCommand,
  CoreyMcpTarget,
} from "@/features/viewer/mcp/contracts";
import { CoreyApiClient } from "@/mcp/corey-api";
import { BrowserBridgeRegistry } from "@/mcp/bridge";
import {
  StoredModelService,
  type StoredModelContext,
} from "@/mcp/model-service";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const field = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("attribute"), name: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal("property"),
    group: z.string().min(1).max(300),
    label: z.string().min(1).max(300),
  }),
]);
const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session"), sessionId: z.string().min(1) }),
  z.object({ kind: z.literal("stored"), modelId: z.string().min(1) }),
]);
const predicate = z.union([
  z.object({
    field,
    operator: z.enum(["exists", "missing"]),
  }),
  z.object({
    field,
    operator: z.enum(["eq", "neq", "contains", "gt", "gte", "lt", "lte"]),
    value: scalar,
  }),
  z.object({
    field,
    operator: z.literal("in"),
    value: z.array(scalar).min(1).max(100),
  }),
]);
const elementQueryShape = {
  text: z.string().max(500).optional(),
  ifcTypes: z.array(z.string().min(1).max(200)).max(20).optional(),
  validation: z.array(z.enum(["ok", "warn", "error"])).max(3).optional(),
  where: z.array(predicate).max(10).optional(),
  withinGlobalIds: z.array(z.string().min(1).max(100)).max(20).optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
const MAX_LISTED_TARGETS = 100;
const MAX_SUMMARY_FIELDS = 250;

type ToolDeps = {
  api: CoreyApiClient;
  bridge: BrowserBridgeRegistry;
  models: StoredModelService;
};

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent:
      value && typeof value === "object" ? (value as Record<string, unknown>) : { value },
  };
}

function countsByIfcType(data: StoredModelContext["data"]) {
  const counts = new Map<string, number>();
  for (const row of data.rows) {
    const ifcType = row.ifcType ?? "UNKNOWN";
    counts.set(ifcType, (counts.get(ifcType) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function storedSummary(context: StoredModelContext) {
  const fields = listMcpFields(context.data);
  return {
    target: { kind: "stored", modelId: context.metadata.modelId },
    model: context.metadata,
    indexing: "ready",
    rowCount: context.data.rows.length,
    columnCount: context.data.columns.length,
    ifcTypeCounts: countsByIfcType(context.data),
    fieldCount: fields.length,
    fields: fields.slice(0, MAX_SUMMARY_FIELDS),
    fieldsTruncated: fields.length > MAX_SUMMARY_FIELDS,
    spatialRootCount: context.spatial.roots.length,
    geometry: {
      coordinateFrame: "corey-coordinated",
      unit: "m",
      modelBounds: context.modelBounds,
      boundedElementCount: context.boundsByGlobalId.size,
    },
    warnings: context.warnings,
    draftEditCount: context.draft?.edits.length ?? 0,
    validation: validationSummary(context.validation, context.data.rows.length),
    revision: context.revision,
  };
}

type BrowserMethod = Extract<
  CoreyMcpBridgeCommand,
  {
    method:
      | "get_model_summary"
      | "query_elements"
      | "get_elements"
      | "list_spatial_children"
      | "get_geometry"
      | "get_validation_summary"
      | "query_validation_issues"
      | "apply_draft_edits";
  }
>["method"];

async function forTarget<T>(
  userId: string,
  deps: ToolDeps,
  selected: CoreyMcpTarget,
  browserMethod: BrowserMethod,
  params: Record<string, unknown>,
  stored: (context: StoredModelContext) => Promise<T> | T,
) {
  if (selected.kind === "session") {
    return deps.bridge.command(userId, selected.sessionId, {
      method: browserMethod,
      params,
    } as CoreyMcpBridgeCommand) as Promise<T>;
  }
  return stored(await deps.models.getContext(userId, selected.modelId));
}

export function createCoreyMcpServer(userId: string, deps: ToolDeps) {
  const server = new McpServer(
    { name: "corey-ifc", version: "0.1.0" },
    {
      instructions:
        "Call corey_list_targets first. Every model operation requires an explicit connected-tab or stored-model target. Stored targets use the latest version. Use GlobalId for elements. Geometry is returned as coordinated metre AABBs, never raw meshes. Draft edits are atomic, reversible, and require the expected current value. No tool uploads, exports, versions, writes IFC bytes, or deletes data.",
    },
  );

  server.registerTool(
    "corey_list_targets",
    {
      description:
        "List explicitly connected COREY viewer tabs and the latest server-stored models.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      let storedModels: unknown[] = [];
      let storedModelsTruncated = false;
      let storedModelsError: string | null = null;
      try {
        const availableModels = await deps.api.listModels(userId);
        storedModels = availableModels.slice(0, MAX_LISTED_TARGETS);
        storedModelsTruncated = availableModels.length > MAX_LISTED_TARGETS;
      } catch (error) {
        storedModelsError =
          error instanceof Error ? error.message : "Stored models are unavailable.";
      }
      return toolResult({
        sessions: deps.bridge.list(userId).slice(0, MAX_LISTED_TARGETS),
        storedModels,
        storedModelsTruncated,
        storedModelsError,
      });
    },
  );

  server.registerTool(
    "corey_get_model_summary",
    {
      description:
        "Get model metadata, IFC type counts, fields, spatial roots, bounds, drafts, validation, and live viewer state.",
      inputSchema: { target },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ target: selected }) =>
      toolResult(
        await forTarget(
          userId,
          deps,
          selected,
          "get_model_summary",
          {},
          (context) => storedSummary(context),
        ),
      ),
  );

  server.registerTool(
    "corey_query_elements",
    {
      description:
        "Search/filter IFC elements by text, type, validation, attributes/properties, or spatial ancestor. Results are bounded and paginated.",
      inputSchema: { target, ...elementQueryShape },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ target: selected, ...query }) =>
      toolResult(
        await forTarget(
          userId,
          deps,
          selected,
          "query_elements",
          { query },
          (context) =>
            queryMcpElements({
              data: context.data,
              validation: context.validation,
              spatial: context.spatial,
              query,
              revision: context.revision,
            }),
        ),
      ),
  );

  server.registerTool(
    "corey_get_elements",
    {
      description:
        "Get normalized attributes, property sets, draft provenance, validation failures, and spatial paths for up to 25 GlobalIds.",
      inputSchema: {
        target,
        globalIds: z.array(z.string().min(1).max(100)).min(1).max(25),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ target: selected, globalIds }) =>
      toolResult(
        await forTarget(
          userId,
          deps,
          selected,
          "get_elements",
          { globalIds },
          (context) => {
            const result = getMcpElements({
              data: context.data,
              validation: context.validation,
              globalIds,
            });
            return {
              items: result.items.map((item) =>
                item.found
                  ? {
                      ...item,
                      spatialPath: item.globalId
                        ? getMcpSpatialPath(context.spatial, item.globalId)
                        : [],
                    }
                  : item,
              ),
            };
          },
        ),
      ),
  );

  server.registerTool(
    "corey_list_spatial_children",
    {
      description:
        "List direct IFC aggregation/containment children. Omit parentGlobalId to list hierarchy roots.",
      inputSchema: {
        target,
        parentGlobalId: z.string().min(1).max(100).optional(),
        cursor: z.string().max(2000).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ target: selected, ...params }) =>
      toolResult(
        await forTarget(
          userId,
          deps,
          selected,
          "list_spatial_children",
          params,
          (context) =>
            listMcpSpatialChildren({
              spatial: context.spatial,
              revision: context.revision,
              ...params,
            }),
        ),
      ),
  );

  server.registerTool(
    "corey_get_geometry",
    {
      description:
        "Get coordinated metre axis-aligned bounds for up to 25 elements plus their aggregate bounds.",
      inputSchema: {
        target,
        globalIds: z.array(z.string().min(1).max(100)).min(1).max(25),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ target: selected, globalIds }) =>
      toolResult(
        await forTarget(
          userId,
          deps,
          selected,
          "get_geometry",
          { globalIds },
          (context) => geometryResult(globalIds, context.boundsByGlobalId),
        ),
      ),
  );

  server.registerTool(
    "corey_get_validation_summary",
    {
      description: "Summarize the current configured validation results for a target.",
      inputSchema: { target },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ target: selected }) =>
      toolResult(
        await forTarget(
          userId,
          deps,
          selected,
          "get_validation_summary",
          {},
          (context) => validationSummary(context.validation, context.data.rows.length),
        ),
      ),
  );

  server.registerTool(
    "corey_query_validation_issues",
    {
      description: "Filter and paginate element-level validation failures.",
      inputSchema: {
        target,
        severities: z.array(z.enum(["warn", "error"])).max(2).optional(),
        clauseIds: z.array(z.string().min(1)).max(50).optional(),
        ifcTypes: z.array(z.string().min(1)).max(20).optional(),
        cursor: z.string().max(2000).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ target: selected, ...query }) =>
      toolResult(
        await forTarget(
          userId,
          deps,
          selected,
          "query_validation_issues",
          query,
          (context) =>
            queryValidationIssues({
              data: context.data,
              result: context.validation,
              revision: context.revision,
              ...query,
            }),
        ),
      ),
  );

  server.registerTool(
    "corey_update_view",
    {
      description:
        "Select, focus, hide, isolate, show all, or fit elements in an explicitly connected COREY tab.",
      inputSchema: {
        sessionId: z.string().min(1),
        action: z.enum(["select", "focus", "hide", "isolate", "show_all", "fit_model"]),
        globalIds: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
        ifcType: z.string().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ sessionId, action, globalIds, ifcType }) =>
      toolResult(
        await deps.bridge.command(userId, sessionId, {
          method: "update_view",
          params: { action, globalIds, ifcType },
        }),
      ),
  );

  server.registerTool(
    "corey_open_stored_model",
    {
      description: "Load the latest version of a stored model into a connected COREY tab.",
      inputSchema: {
        sessionId: z.string().min(1),
        modelId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ sessionId, modelId }) => {
      await deps.api.getModel(userId, modelId);
      return toolResult(
        await deps.bridge.command(
          userId,
          sessionId,
          { method: "open_stored_model", params: { modelId } },
          120_000,
        ),
      );
    },
  );

  server.registerTool(
    "corey_apply_draft_edits",
    {
      description:
        "Atomically apply up to 50 reversible scalar draft edits after checking every expected current value.",
      inputSchema: {
        target,
        edits: z
          .array(
            z.object({
              globalId: z.string().min(1).max(100),
              field,
              expected: z.object({
                state: z.enum(["present", "missing", "empty", "null", "undefined"]),
                value: z.union([scalar, z.null()]).optional(),
              }),
              value: z.union([scalar, z.null()]),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ target: selected, edits }) => {
      if (selected.kind === "session") {
        return toolResult(
          await deps.bridge.command(userId, selected.sessionId, {
            method: "apply_draft_edits",
            params: { edits },
          }),
        );
      }

      const context = await deps.models.getContext(userId, selected.modelId);
      const prepared = prepareMcpDraftEdits({
        sourceId: selected.modelId,
        baseData: context.baseData,
        currentDraft: context.draft,
        edits,
      });
      const persisted = await deps.models.saveDraft(
        userId,
        selected.modelId,
        prepared.draft,
      );
      await deps.bridge.refreshStoredDraft(userId, selected.modelId);
      return toolResult({
        applied: prepared.applied,
        draftEditCount: persisted?.edits.length ?? 0,
      });
    },
  );

  return server;
}
