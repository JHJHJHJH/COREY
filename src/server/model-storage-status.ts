import { isS3ModelStorageConfigured } from "@/server/s3";

const MODEL_STORAGE_UNAVAILABLE_MESSAGE =
  "Server model storage is not configured. Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET to enable server-backed model files.";

export function getModelStorageUnavailableResponse(): Response | null {
  try {
    if (isS3ModelStorageConfigured()) {
      return null;
    }

    return Response.json({ error: MODEL_STORAGE_UNAVAILABLE_MESSAGE }, { status: 503 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : MODEL_STORAGE_UNAVAILABLE_MESSAGE,
      },
      { status: 503 },
    );
  }
}
