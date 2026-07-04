import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type {
  ModelVersionChangeSummary,
  ServerModelSummary,
  ServerModelVersionSummary,
} from "@/features/viewer/types";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getS3Bucket, getS3Client, modelObjectKey, modelVersionObjectKey } from "@/server/s3";

/**
 * Server-side persistence boundary for uploaded IFC models.
 *
 * Bytes live in object storage (MinIO / S3); metadata lives in Postgres. Each
 * model owns an append-only list of immutable versions; "the model's bytes"
 * always means the latest version. The interface is the contract — swap either
 * backend without touching callers.
 */
export interface ModelStore {
  save(input: { name: string; bytes: Uint8Array; ownerId: string }): Promise<ServerModelSummary>;
  list(ownerId: string): Promise<ServerModelSummary[]>;
  getMetadata(modelId: string, ownerId: string): Promise<ServerModelSummary | null>;
  getBytes(modelId: string, ownerId: string): Promise<Uint8Array | null>;
  delete(modelId: string, ownerId: string): Promise<boolean>;
  listVersions(modelId: string, ownerId: string): Promise<ServerModelVersionSummary[] | null>;
  addVersion(input: {
    modelId: string;
    ownerId: string;
    bytes: Uint8Array;
    label?: string | null;
    changeSummary?: ModelVersionChangeSummary | null;
  }): Promise<ServerModelVersionSummary | null>;
  getVersionBytes(
    modelId: string,
    ownerId: string,
    versionNumber: number,
  ): Promise<Uint8Array | null>;
  /**
   * Deletes the given versions of a model. Refuses to empty the version list
   * ("would-empty") — delete the whole model instead. Returns the fresh
   * remaining version list (descending) on success, null when the model is
   * unknown or not owned.
   */
  deleteVersions(
    modelId: string,
    ownerId: string,
    versionNumbers: number[],
  ): Promise<ServerModelVersionSummary[] | null | "would-empty">;
}

type ModelRecordRow = {
  id: string;
  name: string;
  size: number;
  uploadedAt: Date;
};

type ModelVersionRow = {
  id: string;
  modelId: string;
  versionNumber: number;
  size: number;
  objectKey: string;
  label: string | null;
  changeSummary: unknown;
  uploadedAt: Date;
};

function toSummary(
  record: ModelRecordRow,
  versions?: {
    versionCount: number;
    latestVersion: number;
    latestChangeSummary: ModelVersionChangeSummary | null;
  },
): ServerModelSummary {
  return {
    modelId: record.id,
    name: record.name,
    size: record.size,
    uploadedAt: record.uploadedAt.toISOString(),
    ...(versions ?? {}),
  };
}

function toVersionSummary(row: ModelVersionRow): ServerModelVersionSummary {
  return {
    versionId: row.id,
    modelId: row.modelId,
    versionNumber: row.versionNumber,
    size: row.size,
    label: row.label,
    // Written exclusively as ModelVersionChangeSummary by addVersion.
    changeSummary: (row.changeSummary as ModelVersionChangeSummary | null) ?? null,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

async function getObjectBytes(objectKey: string): Promise<Uint8Array | null> {
  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: getS3Bucket(), Key: objectKey }),
    );
    if (!response.Body) {
      return null;
    }
    return await response.Body.transformToByteArray();
  } catch {
    return null;
  }
}

async function putObjectBytes(objectKey: string, bytes: Uint8Array): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: objectKey,
      Body: bytes,
      ContentType: "application/octet-stream",
    }),
  );
}

async function deleteObjectQuietly(objectKey: string): Promise<void> {
  await getS3Client()
    .send(new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: objectKey }))
    .catch(() => undefined);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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
    const objectKey = modelVersionObjectKey(modelId, 1);

    // Write bytes first; only record metadata once the object is durable.
    await putObjectBytes(objectKey, bytes);

    try {
      const record = await prisma.modelRecord.create({
        data: {
          id: modelId,
          ownerId,
          name,
          size: bytes.byteLength,
          versions: {
            create: { versionNumber: 1, size: bytes.byteLength, objectKey },
          },
        },
      });
      return toSummary(record, { versionCount: 1, latestVersion: 1, latestChangeSummary: null });
    } catch (error) {
      // Roll back the orphaned object so storage stays consistent with the DB.
      await deleteObjectQuietly(objectKey);
      throw error;
    }
  }

  async list(ownerId: string): Promise<ServerModelSummary[]> {
    const records = await prisma.modelRecord.findMany({
      where: { ownerId },
      orderBy: { uploadedAt: "desc" },
      include: {
        _count: { select: { versions: true } },
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
    });
    return records.map((record) =>
      toSummary(record, {
        versionCount: record._count.versions,
        latestVersion: record.versions[0]?.versionNumber ?? 1,
        latestChangeSummary:
          (record.versions[0]?.changeSummary as ModelVersionChangeSummary | null) ?? null,
      }),
    );
  }

  async getMetadata(modelId: string, ownerId: string): Promise<ServerModelSummary | null> {
    const record = await prisma.modelRecord.findFirst({
      where: { id: modelId, ownerId },
      include: {
        _count: { select: { versions: true } },
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
    });
    if (!record) {
      return null;
    }
    return toSummary(record, {
      versionCount: record._count.versions,
      latestVersion: record.versions[0]?.versionNumber ?? 1,
      latestChangeSummary:
        (record.versions[0]?.changeSummary as ModelVersionChangeSummary | null) ?? null,
    });
  }

  async getBytes(modelId: string, ownerId: string): Promise<Uint8Array | null> {
    // Enforce ownership at the metadata layer before touching object storage.
    const record = await prisma.modelRecord.findFirst({
      where: { id: modelId, ownerId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!record) {
      return null;
    }

    // Models predating versioning have their v1 row backfilled by migration,
    // but fall back to the legacy key if a version row is somehow missing.
    const objectKey = record.versions[0]?.objectKey ?? modelObjectKey(modelId);
    return getObjectBytes(objectKey);
  }

  async delete(modelId: string, ownerId: string): Promise<boolean> {
    // Capture object keys before the cascade removes the version rows.
    const record = await prisma.modelRecord.findFirst({
      where: { id: modelId, ownerId },
      include: { versions: { select: { objectKey: true } } },
    });
    if (!record) {
      return false;
    }

    // Remove metadata first — it's the source of truth for the catalog, and the
    // cascade clears the model's draft and versions. A failed object
    // delete then only leaks bytes (invisible to callers), never the reverse.
    // Scope by ownerId so a non-owner can't delete another user's model.
    const { count } = await prisma.modelRecord.deleteMany({ where: { id: modelId, ownerId } });
    if (count === 0) {
      return false;
    }

    const objectKeys = new Set(record.versions.map((version) => version.objectKey));
    objectKeys.add(modelObjectKey(modelId));
    await Promise.all([...objectKeys].map((objectKey) => deleteObjectQuietly(objectKey)));

    return true;
  }

  async listVersions(
    modelId: string,
    ownerId: string,
  ): Promise<ServerModelVersionSummary[] | null> {
    const record = await prisma.modelRecord.findFirst({
      where: { id: modelId, ownerId },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
    });
    if (!record) {
      return null;
    }
    return record.versions.map(toVersionSummary);
  }

  async addVersion({
    modelId,
    ownerId,
    bytes,
    label,
    changeSummary,
  }: {
    modelId: string;
    ownerId: string;
    bytes: Uint8Array;
    label?: string | null;
    changeSummary?: ModelVersionChangeSummary | null;
  }): Promise<ServerModelVersionSummary | null> {
    const owns = await prisma.modelRecord.count({ where: { id: modelId, ownerId } });
    if (owns === 0) {
      return null;
    }

    // Two attempts: a concurrent upload can win the next version number between
    // our max() read and the insert; the unique constraint detects that, and a
    // single retry re-reads the fresh max.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const latest = await prisma.modelVersionRecord.findFirst({
        where: { modelId },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      const objectKey = modelVersionObjectKey(modelId, versionNumber);

      // Write bytes first; only record metadata once the object is durable.
      await putObjectBytes(objectKey, bytes);

      try {
        const [version] = await prisma.$transaction([
          prisma.modelVersionRecord.create({
            data: {
              modelId,
              versionNumber,
              size: bytes.byteLength,
              objectKey,
              label: label ?? null,
              ...(changeSummary
                ? { changeSummary: changeSummary as unknown as Prisma.InputJsonValue }
                : {}),
            },
          }),
          prisma.modelRecord.update({
            where: { id: modelId },
            data: { size: bytes.byteLength },
          }),
        ]);
        return toVersionSummary(version);
      } catch (error) {
        await deleteObjectQuietly(objectKey);
        if (isUniqueConstraintError(error) && attempt === 0) {
          continue;
        }
        throw error;
      }
    }

    return null;
  }

  async deleteVersions(
    modelId: string,
    ownerId: string,
    versionNumbers: number[],
  ): Promise<ServerModelVersionSummary[] | null | "would-empty"> {
    // Capture object keys before the rows are deleted (same pattern as delete()).
    const record = await prisma.modelRecord.findFirst({
      where: { id: modelId, ownerId },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
    });
    if (!record) {
      return null;
    }

    const requested = new Set(versionNumbers);
    const toDelete = record.versions.filter((version) => requested.has(version.versionNumber));
    const remaining = record.versions.filter((version) => !requested.has(version.versionNumber));
    if (remaining.length === 0) {
      return "would-empty";
    }
    if (toDelete.length === 0) {
      return remaining.map(toVersionSummary);
    }

    // Metadata first; the model's "current" bytes re-point to the highest
    // remaining version automatically (getBytes resolves the latest row), so
    // only `size` needs re-syncing when the latest version is deleted.
    await prisma.$transaction([
      prisma.modelVersionRecord.deleteMany({
        where: { modelId, versionNumber: { in: toDelete.map((v) => v.versionNumber) } },
      }),
      prisma.modelRecord.update({
        where: { id: modelId },
        data: { size: remaining[0].size },
      }),
    ]);

    // A failed object delete only leaks bytes (invisible to callers).
    await Promise.all(toDelete.map((version) => deleteObjectQuietly(version.objectKey)));

    return remaining.map(toVersionSummary);
  }

  async getVersionBytes(
    modelId: string,
    ownerId: string,
    versionNumber: number,
  ): Promise<Uint8Array | null> {
    // Enforce ownership at the metadata layer before touching object storage.
    const owns = await prisma.modelRecord.count({ where: { id: modelId, ownerId } });
    if (owns === 0) {
      return null;
    }

    const version = await prisma.modelVersionRecord.findFirst({
      where: { modelId, versionNumber },
    });
    if (!version) {
      return null;
    }

    return getObjectBytes(version.objectKey);
  }
}

let cachedStore: ModelStore | null = null;

export function getModelStore(): ModelStore {
  if (!cachedStore) {
    cachedStore = new MinioPostgresModelStore();
  }

  return cachedStore;
}
