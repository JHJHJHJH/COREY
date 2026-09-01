import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { Pool, type PoolClient } from "pg";

try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

type JsonObject = Record<string, unknown>;

type Manifest = {
  schemaVersion: number;
  revisionId: string;
  sourceFingerprint: string;
  embeddingModel: string;
  embeddingDimensions: number;
  counts: Record<string, number>;
  [key: string]: unknown;
};

type DocumentRecord = {
  id: string;
  revisionId: string;
  sourceKey: string;
  sourceKind: string;
  title: string;
  fileName: string;
  sha256: string;
  edition: string | null;
  metadata: JsonObject;
};

type ChunkRecord = {
  id: string;
  revisionId: string;
  documentId: string;
  stableKey: string;
  contentHash: string;
  content: string;
  sourceKind: string;
  sourceRole: string;
  locator: string;
  pageNumber: number | null;
  sheetName: string | null;
  rowStart: number | null;
  rowEnd: number | null;
  tokenCount: number;
  metadata: JsonObject;
  embeddingModel: string;
  evidenceIds: string[];
};

type EvidenceRecord = {
  id: string;
  revisionId: string;
  documentId: string;
  ordinal: number;
  sectionPath: string[];
  locator: JsonObject;
  rawText: string;
  normalizedText: string;
  contentHash: string;
  metadata: JsonObject;
};

type NodeRecord = {
  id: string;
  revisionId: string;
  canonicalKey: string;
  nodeType: string;
  label: string;
  properties: JsonObject;
};

type EdgeRecord = {
  id: string;
  revisionId: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: string;
  evidenceChunkId: string | null;
  assertionKind: string;
  properties: JsonObject;
};

const DEFAULT_ARTIFACT_DIR = path.resolve(".cache/knowledge/corenet-x-3.1");
const MAX_BATCH_INPUTS = 96;
const MAX_BATCH_TOKENS = 100_000;
const MAX_ATTEMPTS = 5;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseArtifactDir() {
  const index = process.argv.indexOf("--dir");
  return index >= 0 && process.argv[index + 1]
    ? path.resolve(process.argv[index + 1])
    : DEFAULT_ARTIFACT_DIR;
}

function isStageOnly() {
  return process.argv.includes("--stage-only");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const text = await readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function inTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function embeddingBatches(chunks: ChunkRecord[]) {
  const batches: ChunkRecord[][] = [];
  let batch: ChunkRecord[] = [];
  let tokens = 0;
  for (const chunk of chunks) {
    if (chunk.tokenCount > 8_000) {
      throw new Error(`Chunk ${chunk.stableKey} is too large for the embedding endpoint.`);
    }
    if (
      batch.length > 0 &&
      (batch.length >= MAX_BATCH_INPUTS || tokens + chunk.tokenCount > MAX_BATCH_TOKENS)
    ) {
      batches.push(batch);
      batch = [];
      tokens = 0;
    }
    batch.push(chunk);
    tokens += chunk.tokenCount;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function withRetry<T>(run: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = Math.min(8_000, 400 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function stageRecords(
  pool: Pool,
  manifest: Manifest,
  documents: DocumentRecord[],
  evidence: EvidenceRecord[],
  chunks: ChunkRecord[],
  nodes: NodeRecord[],
  edges: EdgeRecord[],
) {
  await inTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO "knowledge_corpus_revisions"
        ("id", "sourceFingerprint", "status", "embeddingModel", "embeddingDimensions", "manifest")
       VALUES ($1, $2, 'staging', $3, $4, $5::jsonb)
       ON CONFLICT ("id") DO UPDATE SET
         "embeddingModel" = EXCLUDED."embeddingModel",
         "embeddingDimensions" = EXCLUDED."embeddingDimensions",
         "manifest" = EXCLUDED."manifest",
         "status" = CASE
           WHEN "knowledge_corpus_revisions"."status" = 'active' THEN 'active'
           ELSE 'staging'
         END`,
      [
        manifest.revisionId,
        manifest.sourceFingerprint,
        manifest.embeddingModel,
        manifest.embeddingDimensions,
        JSON.stringify(manifest),
      ],
    );

    for (const record of documents) {
      await client.query(
        `INSERT INTO "knowledge_documents"
          ("id", "revisionId", "sourceKey", "sourceKind", "title", "fileName", "sha256", "edition", "metadata")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT ("id") DO UPDATE SET
           "title"=EXCLUDED."title", "fileName"=EXCLUDED."fileName",
           "sha256"=EXCLUDED."sha256", "edition"=EXCLUDED."edition", "metadata"=EXCLUDED."metadata"`,
        [record.id, record.revisionId, record.sourceKey, record.sourceKind, record.title, record.fileName, record.sha256, record.edition, JSON.stringify(record.metadata)],
      );
    }

    for (const record of evidence) {
      await client.query(
        `INSERT INTO "knowledge_evidence"
          ("id", "revisionId", "documentId", "ordinal", "sectionPath", "locator", "rawText", "normalizedText", "contentHash", "metadata")
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb)
         ON CONFLICT ("id") DO UPDATE SET
           "sectionPath"=EXCLUDED."sectionPath", "locator"=EXCLUDED."locator",
           "rawText"=EXCLUDED."rawText", "normalizedText"=EXCLUDED."normalizedText",
           "contentHash"=EXCLUDED."contentHash", "metadata"=EXCLUDED."metadata"`,
        [record.id, record.revisionId, record.documentId, record.ordinal, record.sectionPath, JSON.stringify(record.locator), record.rawText, record.normalizedText, record.contentHash, JSON.stringify(record.metadata)],
      );
    }

    for (const record of chunks) {
      await client.query(
        `INSERT INTO "knowledge_chunks"
          ("id", "revisionId", "documentId", "stableKey", "contentHash", "content", "sourceKind", "sourceRole", "locator", "pageNumber", "sheetName", "rowStart", "rowEnd", "tokenCount", "metadata", "embeddingModel")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
         ON CONFLICT ("id") DO UPDATE SET
           "content"=EXCLUDED."content", "metadata"=EXCLUDED."metadata", "tokenCount"=EXCLUDED."tokenCount"`,
        [record.id, record.revisionId, record.documentId, record.stableKey, record.contentHash, record.content, record.sourceKind, record.sourceRole, record.locator, record.pageNumber, record.sheetName, record.rowStart, record.rowEnd, record.tokenCount, JSON.stringify(record.metadata), record.embeddingModel],
      );
    }

    for (const record of chunks) {
      for (const evidenceId of record.evidenceIds) {
        await client.query(
          `INSERT INTO "knowledge_chunk_evidence" ("chunkId", "evidenceId")
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [record.id, evidenceId],
        );
      }
    }

    for (const record of nodes) {
      await client.query(
        `INSERT INTO "knowledge_nodes" ("id", "revisionId", "canonicalKey", "nodeType", "label", "properties")
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT ("id") DO UPDATE SET "label"=EXCLUDED."label", "properties"=EXCLUDED."properties"`,
        [record.id, record.revisionId, record.canonicalKey, record.nodeType, record.label, JSON.stringify(record.properties)],
      );
    }

    for (const record of edges) {
      await client.query(
        `INSERT INTO "knowledge_edges"
          ("id", "revisionId", "fromNodeId", "toNodeId", "relationType", "evidenceChunkId", "assertionKind", "properties")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT ("id") DO UPDATE SET "evidenceChunkId"=EXCLUDED."evidenceChunkId", "properties"=EXCLUDED."properties"`,
        [record.id, record.revisionId, record.fromNodeId, record.toNodeId, record.relationType, record.evidenceChunkId, record.assertionKind, JSON.stringify(record.properties)],
      );
    }
  });
}

async function main() {
  const artifactDir = parseArtifactDir();
  const stageOnly = isStageOnly();
  const [manifest, documents, evidence, chunks, nodes, edges] = await Promise.all([
    readJson<Manifest>(path.join(artifactDir, "manifest.json")),
    readJsonl<DocumentRecord>(path.join(artifactDir, "documents.jsonl")),
    readJsonl<EvidenceRecord>(path.join(artifactDir, "evidence.jsonl")),
    readJsonl<ChunkRecord>(path.join(artifactDir, "chunks.jsonl")),
    readJsonl<NodeRecord>(path.join(artifactDir, "nodes.jsonl")),
    readJsonl<EdgeRecord>(path.join(artifactDir, "edges.jsonl")),
  ]);
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported manifest version ${manifest.schemaVersion}.`);
  if (manifest.embeddingDimensions !== 1536) throw new Error("The current pgvector schema requires 1536-dimensional embeddings.");

  const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") });
  let runId: string | null = null;
  try {
    await stageRecords(pool, manifest, documents, evidence, chunks, nodes, edges);
    if (stageOnly) {
      process.stdout.write(`Staged corpus ${manifest.revisionId} (${chunks.length} chunks) without embedding or activation.\n`);
      return;
    }
    const openai = new OpenAI({ apiKey: requiredEnv("OPENAI_API_KEY") });
    runId = randomUUID();
    await pool.query(
      `INSERT INTO "knowledge_ingest_runs" ("id", "revisionId", "status") VALUES ($1, $2, 'running')`,
      [runId, manifest.revisionId],
    );

    const missing = await pool.query<{ id: string }>(
      `SELECT "id" FROM "knowledge_chunks" WHERE "revisionId"=$1 AND "embedding" IS NULL`,
      [manifest.revisionId],
    );
    const missingIds = new Set(missing.rows.map((row) => row.id));
    const pending = chunks.filter((chunk) => missingIds.has(chunk.id));
    let embeddedCount = 0;

    for (const batch of embeddingBatches(pending)) {
      const response = await withRetry(() =>
        openai.embeddings.create({
          model: manifest.embeddingModel,
          dimensions: manifest.embeddingDimensions,
          input: batch.map((chunk) => chunk.content),
          encoding_format: "float",
        }),
      );
      if (response.data.length !== batch.length) throw new Error("OpenAI returned an unexpected embedding count.");
      await inTransaction(pool, async (client) => {
        for (const item of response.data) {
          const chunk = batch[item.index];
          if (!chunk || item.embedding.length !== manifest.embeddingDimensions) {
            throw new Error("OpenAI returned an embedding with an unexpected index or dimension.");
          }
          await client.query(
            `UPDATE "knowledge_chunks" SET "embedding"=$2::vector, "embeddingModel"=$3 WHERE "id"=$1`,
            [chunk.id, `[${item.embedding.join(",")}]`, manifest.embeddingModel],
          );
        }
        embeddedCount += batch.length;
        await client.query(`UPDATE "knowledge_ingest_runs" SET "embeddedCount"=$2 WHERE "id"=$1`, [runId, embeddedCount]);
      });
      process.stdout.write(`Embedded ${embeddedCount}/${pending.length}\r`);
    }

    await inTransaction(pool, async (client) => {
      const incomplete = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "knowledge_chunks" WHERE "revisionId"=$1 AND "embedding" IS NULL`,
        [manifest.revisionId],
      );
      if (incomplete.rows[0].count !== "0") throw new Error(`${incomplete.rows[0].count} chunks remain unembedded.`);
      await client.query(`UPDATE "knowledge_corpus_revisions" SET "status"='superseded' WHERE "status"='active' AND "id"<>$1`, [manifest.revisionId]);
      await client.query(`UPDATE "knowledge_corpus_revisions" SET "status"='active', "activatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [manifest.revisionId]);
      await client.query(`UPDATE "knowledge_ingest_runs" SET "status"='completed', "completedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [runId]);
    });
    process.stdout.write(`\nActivated corpus ${manifest.revisionId} (${chunks.length} chunks; ${embeddedCount} newly embedded).\n`);
  } catch (error) {
    if (runId) {
      await pool.query(
        `UPDATE "knowledge_ingest_runs" SET "status"='failed', "failedCount"=1, "error"=$2, "completedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
        [runId, error instanceof Error ? error.message.slice(0, 4000) : "Knowledge ingestion failed."],
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
