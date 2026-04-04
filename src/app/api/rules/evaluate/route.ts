import { evaluateViewerValidationPayload, parseViewerValidationRunPayload } from "@/features/rules/lib/validation";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const payload = parseViewerValidationRunPayload(body);
    const result = await evaluateViewerValidationPayload(payload);

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Validation request could not be processed.";

    return Response.json(
      {
        error: message,
      },
      {
        status: 400,
      },
    );
  }
}
