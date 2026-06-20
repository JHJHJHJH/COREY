import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { ServerModelSummary } from "@/features/viewer/types";
import { prisma } from "@/server/db";
import { getS3Bucket, getS3Client, modelObjectKey } from "@/server/s3";

/**
 * Server-side persistence boundary for uploaded IFC models.
 *
 * Bytes live in object storage (MinIO / S3); metadata lives in Postgres. The
 * interface is the contract — swap either backend without touching callers.
 */
export interface ModelStore {
  save(input: { name: string; bytes: Uint8Array }): Promise<ServerModelSummary>;
  list(): Promise<ServerModelSummary[]>;
  getMetadata(modelId: string): Promise<ServerModelSummary | null>;
  getBytes(modelId: string): Promise<Uint8Array | null>;
  delete(modelId: string): Promise<boolean>;
}

type ModelRecordRow = {
  id: string;
  name: string;
  size: number;
  uploadedAt: Date;
};

function toSummary(record: ModelRecordRow): ServerModelSummary {
  return {
    modelId: record.id,
    name: record.name,
    size: record.size,
    uploadedAt: record.uploadedAt.toISOString(),
  };
}

class MinioPostgresModelStore implements ModelStore {
  async save({ name, bytes }: { name: string; bytes: Uint8Array }): Promise<ServerModelSummary> {
    const modelId = randomUUID();

    // Write bytes first; only record metadata once the object is durable.
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: getS3Bucket(),
        Key: modelObjectKey(modelId),
        Body: bytes,
        ContentType: "application/octet-stream",
      }),
    );

    try {
      const record = await prisma.modelRecord.create({
        data: { id: modelId, name, size: bytes.byteLength },
      });
      return toSummary(record);
    } catch (error) {
      // Roll back the orphaned object so storage stays consistent with the DB.
      await getS3Client()
        .send(new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: modelObjectKey(modelId) }))
        .catch(() => undefined);
      throw error;
    }
  }

  async list(): Promise<ServerModelSummary[]> {
    const records = await prisma.modelRecord.findMany({
      orderBy: { uploadedAt: "desc" },
    });
    return records.map(toSummary);
  }

  async getMetadata(modelId: string): Promise<ServerModelSummary | null> {
    const record = await prisma.modelRecord.findUnique({ where: { id: modelId } });
    return record ? toSummary(record) : null;
  }

  async getBytes(modelId: string): Promise<Uint8Array | null> {
    try {
      const response = await getS3Client().send(
        new GetObjectCommand({ Bucket: getS3Bucket(), Key: modelObjectKey(modelId) }),
      );
      if (!response.Body) {
        return null;
      }
      return await response.Body.transformToByteArray();
    } catch {
      return null;
    }
  }

  async delete(modelId: string): Promise<boolean> {
    // Remove metadata first — it's the source of truth for the catalog, and the
    // cascade clears the model's draft. A failed object
    // delete then only leaks bytes (invisible to callers), never the reverse.
    try {
      await prisma.modelRecord.delete({ where: { id: modelId } });
    } catch {
      // Record already gone (or never existed) — nothing to delete.
      return false;
    }

    await getS3Client()
      .send(new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: modelObjectKey(modelId) }))
      .catch(() => undefined);

    return true;
  }
}

let cachedStore: ModelStore | null = null;

export function getModelStore(): ModelStore {
  if (!cachedStore) {
    cachedStore = new MinioPostgresModelStore();
  }

  return cachedStore;
}
