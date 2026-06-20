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
  save(input: { name: string; bytes: Uint8Array; ownerId: string }): Promise<ServerModelSummary>;
  list(ownerId: string): Promise<ServerModelSummary[]>;
  getMetadata(modelId: string, ownerId: string): Promise<ServerModelSummary | null>;
  getBytes(modelId: string, ownerId: string): Promise<Uint8Array | null>;
  delete(modelId: string, ownerId: string): Promise<boolean>;
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
  async save({
    name,
    bytes,
    ownerId,
  }: {
    name: string;
    bytes: Uint8Array;
    ownerId: string;
  }): Promise<ServerModelSummary> {
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
        data: { id: modelId, ownerId, name, size: bytes.byteLength },
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

  async list(ownerId: string): Promise<ServerModelSummary[]> {
    const records = await prisma.modelRecord.findMany({
      where: { ownerId },
      orderBy: { uploadedAt: "desc" },
    });
    return records.map(toSummary);
  }

  async getMetadata(modelId: string, ownerId: string): Promise<ServerModelSummary | null> {
    const record = await prisma.modelRecord.findFirst({ where: { id: modelId, ownerId } });
    return record ? toSummary(record) : null;
  }

  async getBytes(modelId: string, ownerId: string): Promise<Uint8Array | null> {
    // Enforce ownership at the metadata layer before touching object storage.
    const owns = await prisma.modelRecord.count({ where: { id: modelId, ownerId } });
    if (owns === 0) {
      return null;
    }

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

  async delete(modelId: string, ownerId: string): Promise<boolean> {
    // Remove metadata first — it's the source of truth for the catalog, and the
    // cascade clears the model's draft. A failed object
    // delete then only leaks bytes (invisible to callers), never the reverse.
    // Scope by ownerId so a non-owner can't delete another user's model.
    const { count } = await prisma.modelRecord.deleteMany({ where: { id: modelId, ownerId } });
    if (count === 0) {
      // Record already gone, never existed, or owned by someone else.
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
