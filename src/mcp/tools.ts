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
import type {
  CoreyMcpBridgeCommand,
  CoreyMcpTarget,
} from "@/features/viewer/mcp/contracts";
import { CoreyApiClient } from "@/mcp/corey-api";
import { BrowserBridgeRegistry } from "@/mcp/bridge";
import { StoredModelService } from "@/mcp/model-service";

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
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

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

function countsByIfcType(data: Awaited<ReturnType<StoredModelService["getContext"]>>["data"]) {
  const counts = new Map<string, number>();
  for (const row of data.rows) {
    const ifcType = row.ifcType ?? "UNKNOWN";
    counts.set(ifcType, (counts.get(ifcType) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function storedSummary(context: Awaited<ReturnType<StoredModelService["getContext"]>>) {
  return {
    target: { kind: "stored", modelId: context.metadata.modelId },
    model: context.metadata,
    indexing: "ready",
    rowCount: context.data.rows.length,
    columnCount: context.data.columns.length,
    ifcTypeCounts: countsByIfcType(context.data),
    fields: listMcpFields(context.data),
    draftEditCount: context.draft?.edits.length ?? 0,
    validation: validationSummary(context.validation, context.data.rows.length),
    revision: context.revision,
  };
}

async function forTarget<T>(
  userId: string,
  deps: ToolDeps,
  selected: CoreyMcpTarget,
  browserMethod:
    | "get_model_summary"
    | "query_elements"
    | "get_elements"
    | "get_validation_summary"
    | "query_validation_issues"
    | "apply_draft_edits",
  params: Record<string, unknown>,
  stored: (
    context: Awaited<ReturnType<StoredModelService["getContext"]>>,
  ) => Promise<T> | T,
) {
  if (selected.kind === "session") {
    return deps.bridge.command(
      userId,
      selected.sessionId,
      { method: browserMethod, params } as CoreyMcpBridgeCommand,
    ) as Promise<T>;
  }
  return stored(await deps.models.getContext(userId, selected.modelId));
}

export function createCoreyMcpServer(userId: string, deps: ToolDeps) {
  const server = new McpServer(
    { name: "corey-ifc", version: "0.1.0" },
    {
      instructions:
        "Call corey_list_targets first. Every model operation requires an explicit session or stored-model target. Use GlobalId for elements. Draft edits are atomic and require the expected current value. No tool exports, writes IFC bytes, creates versions, or deletes data.",
    },
  );

  server.registerTool(
    "corey_list_targets",
    {
      description:
        "List the caller's connected COREY viewer tabs and latest server-stored models.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      let storedModels: unknown[] = [];
      let storedModelsError: string | null = null;
      try {
        storedModels = await deps.api.listModels(userId);
      } catch (error) {
        storedModelsError = error instanceof Error ? error.message : "Stored models are unavailable.";
      }
      return toolResult({
        sessions: deps.bridge.list(userId),
        storedModels,
        storedModelsError,
      });
    },
  );

  server.registerTool(
    "corey_get_model_summary",
    {
      description:
        "Get model metadata, IFC type counts, field catalog, draft count, validation summary, and active viewer state.",
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
          async (context) => storedSummary(context),
        ),
      ),
  );

  server.registerTool(
    "corey_query_elements",
    {
      description:
        "Search and filter IFC elements. Returns bounded summaries and an opaque revision-bound cursor.",
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
          async (context) =>
            queryMcpElements({
              data: context.data,
              validation: context.validation,
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
        "Get normalized attributes, properties, draft provenance, and validation failures for up to 25 GlobalIds.",
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
          async (context) =>
            getMcpElements({
              data: context.data,
              validation: context.validation,
              globalIds,
            }),
        ),
      ),
  );

  server.registerTool(
    "corey_get_validation_summary",
    {
      description: "Summarize validation results for an explicit COREY target.",
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
          async (context) => validationSummary(context.validation, context.data.rows.length),
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
          async (context) =>
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
        "Select, focus, hide, isolate, show all, or fit elements in a connected COREY tab.",
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
        "Atomically apply up to 50 reversible draft edits after checking each expected current value.",
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
