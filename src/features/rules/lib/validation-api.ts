import { parseViewerValidationRunResult } from "@/features/rules/lib/validation";
import type {
  ViewerValidationRunPayload,
  ViewerValidationRunResult,
} from "@/features/viewer/types";

const VALIDATION_EVALUATE_ENDPOINT = "/api/rules/evaluate";

export async function evaluateViewerValidationViaApi(
  payload: ViewerValidationRunPayload,
  signal?: AbortSignal,
): Promise<ViewerValidationRunResult> {
  const response = await fetch(VALIDATION_EVALUATE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Validation API request failed (${response.status}).`;
    throw new Error(message);
  }

  return parseViewerValidationRunResult(body, payload.sourceId);
}
