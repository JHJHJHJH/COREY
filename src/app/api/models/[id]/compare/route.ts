import {
  parseViewerValidationConfig,
  VIEWER_VALIDATION_CONFIG_VERSION,
} from "@/features/rules/lib/validation";
import type { ViewerValidationClause } from "@/features/viewer/types";
import { getUserIdOrResponse } from "@/server/identity";
import { compareModelVersions } from "@/server/model-compare";
import { getModelStorageUnavailableResponse } from "@/server/model-storage-status";

function parseVersionNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function parseClauses(value: unknown): ViewerValidationClause[] {
  if (value === undefined || value === null) {
    return [];
  }

  const config = parseViewerValidationConfig({
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    clauses: value,
  });
  return config.clauses;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const storageUnavailable = getModelStorageUnavailableResponse();
  if (storageUnavailable) return storageUnavailable;

  const { id } = await params;

  let baseVersion: number | null = null;
  let targetVersion: number | null = null;
  let clauses: ViewerValidationClause[] = [];

  try {
    const body = (await request.json()) as {
      baseVersion?: unknown;
      targetVersion?: unknown;
      clauses?: unknown;
    };
    baseVersion = parseVersionNumber(body.baseVersion);
    targetVersion = parseVersionNumber(body.targetVersion);
    clauses = parseClauses(body.clauses);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid compare request.";
    return Response.json({ error: message }, { status: 400 });
  }

  if (baseVersion === null || targetVersion === null) {
    return Response.json(
      { error: "Compare requires integer baseVersion and targetVersion." },
      { status: 400 },
    );
  }

  if (baseVersion === targetVersion) {
    return Response.json(
      { error: "Compare requires two different versions." },
      { status: 400 },
    );
  }

  try {
    const result = await compareModelVersions({
      modelId: id,
      ownerId: userId,
      baseVersion,
      targetVersion,
      clauses,
    });

    if (!result) {
      return Response.json({ error: "Model version not found." }, { status: 404 });
    }

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model compare failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
