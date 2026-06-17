import { S3Client } from "@aws-sdk/client-s3";
import { getS3Env } from "@/server/env";

let cachedClient: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!cachedClient) {
    const env = getS3Env();
    cachedClient = new S3Client({
      endpoint: env.s3Endpoint,
      region: env.s3Region,
      // MinIO serves buckets path-style (http://endpoint/bucket/key).
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.s3AccessKey,
        secretAccessKey: env.s3SecretKey,
      },
    });
  }

  return cachedClient;
}

export function getS3Bucket() {
  return getS3Env().s3Bucket;
}

export function modelObjectKey(modelId: string): string {
  return `${modelId}.ifc`;
}
