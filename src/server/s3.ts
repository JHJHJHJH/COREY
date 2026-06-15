import { S3Client } from "@aws-sdk/client-s3";

let cachedClient: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "us-east-1",
      // MinIO serves buckets path-style (http://endpoint/bucket/key).
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
      },
    });
  }

  return cachedClient;
}

export const S3_BUCKET = process.env.S3_BUCKET ?? "corey-models";

export function modelObjectKey(modelId: string): string {
  return `${modelId}.ifc`;
}
