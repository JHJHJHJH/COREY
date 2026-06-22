export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  try {
    const { ensureS3BucketExists } = await import("@/server/s3");
    const result = await ensureS3BucketExists();
    if (result.status === "ready") {
      console.info(
        result.created
          ? `Created S3 bucket "${result.bucket}".`
          : `S3 bucket "${result.bucket}" is ready.`,
      );
    }
  } catch (error) {
    console.error("S3 bucket startup seed failed.", error);
  }
}
