import { getBackendEnv, isS3StorageConfigured } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = getBackendEnv();

    return Response.json({
      status: "ok",
      service: "corey",
      backend: {
        maxModelBytes: env.maxModelBytes,
        modelStorageAvailable: isS3StorageConfigured(env.s3),
        s3Bucket: env.s3?.s3Bucket ?? null,
        s3Region: env.s3?.s3Region ?? null,
      },
    });
  } catch (error) {
    return Response.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : "Health check failed.",
      },
      { status: 503 },
    );
  }
}
