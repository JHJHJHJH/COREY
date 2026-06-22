import {
  BucketAlreadyExists,
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  type BucketLocationConstraint,
  type CreateBucketCommandInput,
} from "@aws-sdk/client-s3";
import { getS3Env, isS3StorageConfigured, type S3Env } from "@/server/env";

let cachedClient: S3Client | null = null;
let bucketEnsurePromise: Promise<S3BucketEnsureResult> | null = null;

export type S3BucketEnsureResult =
  | {
      status: "ready";
      bucket: string;
      created: boolean;
    }
  | {
      status: "skipped";
    };

type AwsErrorShape = {
  name?: unknown;
  $metadata?: {
    httpStatusCode?: unknown;
  };
};

function readAwsErrorName(error: unknown) {
  const name = typeof error === "object" && error !== null ? (error as AwsErrorShape).name : null;
  return typeof name === "string" ? name : undefined;
}

function readAwsErrorStatus(error: unknown) {
  const status =
    typeof error === "object" && error !== null
      ? (error as AwsErrorShape).$metadata?.httpStatusCode
      : null;
  return typeof status === "number" ? status : undefined;
}

function isMissingBucketError(error: unknown) {
  const name = readAwsErrorName(error);
  const status = readAwsErrorStatus(error);
  return name === "NotFound" || name === "NoSuchBucket" || status === 404;
}

function isExistingBucketError(error: unknown) {
  return (
    error instanceof BucketAlreadyOwnedByYou ||
    error instanceof BucketAlreadyExists ||
    readAwsErrorName(error) === "BucketAlreadyOwnedByYou" ||
    readAwsErrorName(error) === "BucketAlreadyExists"
  );
}

function createBucketInput(env: S3Env): CreateBucketCommandInput {
  const input: CreateBucketCommandInput = { Bucket: env.s3Bucket };

  if (env.s3Region !== "us-east-1" && env.s3Region !== "auto") {
    input.CreateBucketConfiguration = {
      LocationConstraint: env.s3Region as BucketLocationConstraint,
    };
  }

  return input;
}

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

export async function ensureS3BucketExists(): Promise<S3BucketEnsureResult> {
  if (bucketEnsurePromise) {
    return bucketEnsurePromise;
  }

  bucketEnsurePromise = (async (): Promise<S3BucketEnsureResult> => {
    const env = getS3Env();
    if (!isS3StorageConfigured(env)) {
      return { status: "skipped" };
    }

    const client = getS3Client();
    try {
      await client.send(new HeadBucketCommand({ Bucket: env.s3Bucket }));
      return { status: "ready", bucket: env.s3Bucket, created: false };
    } catch (error) {
      if (!isMissingBucketError(error)) {
        throw error;
      }
    }

    try {
      await client.send(new CreateBucketCommand(createBucketInput(env)));
    } catch (error) {
      if (!isExistingBucketError(error)) {
        throw error;
      }
      await client.send(new HeadBucketCommand({ Bucket: env.s3Bucket }));
      return { status: "ready", bucket: env.s3Bucket, created: false };
    }

    return { status: "ready", bucket: env.s3Bucket, created: true };
  })().catch((error) => {
    bucketEnsurePromise = null;
    throw error;
  });

  return bucketEnsurePromise;
}
