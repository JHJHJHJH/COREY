export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const maxAttempts = 10;
  let delayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        console.error("S3 bucket startup seed failed after all retries.", error);
        return;
      }
      console.warn(
        `S3 bucket startup seed failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs / 1000}s...`,
        error,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}
