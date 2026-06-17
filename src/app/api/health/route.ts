import { getBackendEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = getBackendEnv();

    return Response.json({
      status: "ok",
      service: "corey",
      backend: {
        maxModelBytes: env.maxModelBytes,
        s3Bucket: env.s3Bucket,
        s3Region: env.s3Region,
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
