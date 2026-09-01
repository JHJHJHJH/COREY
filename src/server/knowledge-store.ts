import { createHash } from "node:crypto";
import OpenAI from "openai";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getKnowledgeEnv, getOptionalKnowledgeEnv } from "@/server/env";
import { reciprocalRankFuse, viewerKnowledgeContextTerms } from "@/server/knowledge-ranking";
import type {
  KnowledgeCitation,
  KnowledgeChatTurn,
  KnowledgeStatus,
  ViewerKnowledgeContext,
} from "@/features/viewer/types";

type SearchRow = {
  id: string;
  documentId: string;
  title: string;
  edition: string | null;
  documentMetadata: unknown;
  sourceKind: string;
  sourceRole: string;
  locator: string;
  pageNumber: number | null;
  sheetName: string | null;
  rowStart: number | null;
  rowEnd: number | null;
  content: string;
  tokenCount: number;
  metadata: unknown;
  score: number;
};

type EvidenceRow = {
  chunkId: string;
  evidenceId: string;
  sectionPath: string[];
  locator: unknown;
  normalizedText: string;
  metadata: unknown;
};

type GraphAssertionRow = {
  fromLabel: string;
  relationType: string;
  toLabel: string;
  assertionKind: string;
  evidenceChunkId: string | null;
};

type CorpusRow = {
  id: string;
  embeddingModel: string;
  embeddingDimensions: number;
  activatedAt: Date | null;
  chunkCount: bigint;
};

let openAiClient: OpenAI | null = null;

function getOpenAI() {
  const env = getKnowledgeEnv();
  openAiClient ??= new OpenAI({ apiKey: env.openAiApiKey });
  return openAiClient;
}

function excerpt(content: string) {
  return content.length <= 700 ? content : `${content.slice(0, 697).trimEnd()}…`;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function evidenceLocator(value: unknown, fallback: SearchRow): KnowledgeCitation["locator"] {
  const locator = objectValue(value);
  const bbox = Array.isArray(locator.bbox) && locator.bbox.length === 4
    && locator.bbox.every((item) => typeof item === "number")
    ? (locator.bbox as [number, number, number, number])
    : undefined;
  return {
    ...(typeof locator.page === "number" ? { page: locator.page } : fallback.pageNumber ? { page: fallback.pageNumber } : {}),
    ...(bbox ? { bbox } : {}),
    ...(typeof locator.sheet === "string" ? { sheet: locator.sheet } : fallback.sheetName ? { sheet: fallback.sheetName } : {}),
    ...(typeof locator.rowStart === "number" ? { rowStart: locator.rowStart } : fallback.rowStart ? { rowStart: fallback.rowStart } : {}),
    ...(typeof locator.rowEnd === "number" ? { rowEnd: locator.rowEnd } : fallback.rowEnd ? { rowEnd: fallback.rowEnd } : {}),
    ...(typeof locator.cells === "string" ? { cells: locator.cells } : {}),
  };
}

function structuredFields(value: unknown): KnowledgeCitation["structuredFields"] {
  const fields = objectValue(value).structuredFields;
  if (!Array.isArray(fields)) return undefined;
  const parsed = fields.flatMap((field) => {
    const candidate = objectValue(field);
    return typeof candidate.label === "string" && typeof candidate.value === "string"
      ? [{ label: candidate.label, value: candidate.value }]
      : [];
  });
  return parsed.length > 0 ? parsed : undefined;
}

function officialUrl(row: SearchRow) {
  const value = objectValue(row.documentMetadata).officialUrl;
  return typeof value === "string" ? value : null;
}

function locatorLabel(locator: KnowledgeCitation["locator"], fallback: string) {
  if (locator.page) return `COP p. ${locator.page}`;
  if (locator.sheet) {
    const rows = locator.rowStart
      ? locator.rowEnd && locator.rowEnd !== locator.rowStart
        ? ` rows ${locator.rowStart}–${locator.rowEnd}`
        : ` row ${locator.rowStart}`
      : "";
    return `${locator.sheet}${rows}`;
  }
  return fallback;
}

function queryText(question: string, context: ViewerKnowledgeContext | undefined) {
  const parts = [question];
  if (context?.ifcType) parts.push(`IFC entity ${context.ifcType}`);
  if (context?.subtype) parts.push(`IFC subtype ${context.subtype}`);
  for (const property of context?.properties.slice(0, 30) ?? []) {
    parts.push(`${property.group ? `${property.group}.` : ""}${property.name}: ${property.value}`);
  }
  // Keep query embeddings comfortably below the endpoint's token ceiling even
  // when an IFC element exposes many long property values.
  return parts.join("\n").slice(0, 24_000);
}

async function activeCorpus() {
  const rows = await prisma.$queryRaw<CorpusRow[]>(Prisma.sql`
    SELECT r."id", r."embeddingModel", r."embeddingDimensions", r."activatedAt",
      count(c."id")::bigint AS "chunkCount"
    FROM "knowledge_corpus_revisions" r
    LEFT JOIN "knowledge_chunks" c ON c."revisionId" = r."id"
    WHERE r."status" = 'active'
    GROUP BY r."id"
    ORDER BY r."activatedAt" DESC NULLS LAST
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function getKnowledgeStatus(): Promise<KnowledgeStatus> {
  const configured = getOptionalKnowledgeEnv() !== null;
  try {
    const corpus = await activeCorpus();
    if (!corpus) {
      return {
        available: false,
        configured,
        revisionId: null,
        activatedAt: null,
        embeddingModel: null,
        documentCount: 0,
        chunkCount: 0,
        sources: [],
        message: configured ? "No active knowledge corpus has been ingested." : "OpenAI is not configured.",
      };
    }
    const documents = await prisma.knowledgeDocument.findMany({
      where: { revisionId: corpus.id },
      orderBy: { sourceKind: "asc" },
      select: { title: true, fileName: true, sha256: true, edition: true },
    });
    return {
      available: configured && Number(corpus.chunkCount) > 0,
      configured,
      revisionId: corpus.id,
      activatedAt: corpus.activatedAt?.toISOString() ?? null,
      embeddingModel: corpus.embeddingModel,
      documentCount: documents.length,
      chunkCount: Number(corpus.chunkCount),
      sources: documents,
      message: configured ? "COREY is ready." : "The corpus is ready, but OpenAI is not configured.",
    };
  } catch (error) {
    return {
      available: false,
      configured,
      revisionId: null,
      activatedAt: null,
      embeddingModel: null,
      documentCount: 0,
      chunkCount: 0,
      sources: [],
      message: error instanceof Error ? error.message : "Knowledge status could not be read.",
    };
  }
}

export async function retrieveKnowledge(question: string, context?: ViewerKnowledgeContext) {
  const corpus = await activeCorpus();
  if (!corpus) throw new Error("No active knowledge corpus has been ingested.");
  const env = getKnowledgeEnv();
  if (corpus.embeddingDimensions !== env.embeddingDimensions || corpus.embeddingModel !== env.embeddingModel) {
    throw new Error("The active corpus embedding configuration does not match the server configuration.");
  }
  const embedded = await getOpenAI().embeddings.create({
    model: env.embeddingModel,
    dimensions: env.embeddingDimensions,
    input: queryText(question, context),
    encoding_format: "float",
  });
  const vector = embedded.data[0]?.embedding;
  if (!vector || vector.length !== env.embeddingDimensions) throw new Error("OpenAI returned an invalid query embedding.");
  const vectorLiteral = `[${vector.join(",")}]`;

  const [vectorRows, keywordRows] = await Promise.all([
    prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT c."id", c."documentId", d."title", d."edition", d."metadata" AS "documentMetadata",
        c."sourceKind", c."sourceRole", c."locator", c."pageNumber", c."sheetName", c."rowStart", c."rowEnd",
        c."content", c."tokenCount", c."metadata",
        (1 - (c."embedding" <=> CAST(${vectorLiteral} AS vector)))::double precision AS "score"
      FROM "knowledge_chunks" c
      JOIN "knowledge_documents" d ON d."id" = c."documentId"
      WHERE c."revisionId" = ${corpus.id} AND c."embedding" IS NOT NULL
      ORDER BY c."embedding" <=> CAST(${vectorLiteral} AS vector)
      LIMIT 40
    `),
    prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT c."id", c."documentId", d."title", d."edition", d."metadata" AS "documentMetadata",
        c."sourceKind", c."sourceRole", c."locator", c."pageNumber", c."sheetName", c."rowStart", c."rowEnd",
        c."content", c."tokenCount", c."metadata",
        ts_rank_cd(c."search_vector", websearch_to_tsquery('english', ${question}))::double precision AS "score"
      FROM "knowledge_chunks" c
      JOIN "knowledge_documents" d ON d."id" = c."documentId"
      WHERE c."revisionId" = ${corpus.id}
        AND c."search_vector" @@ websearch_to_tsquery('english', ${question})
      ORDER BY "score" DESC
      LIMIT 40
    `),
  ]);

  const fused = reciprocalRankFuse(vectorRows, keywordRows, viewerKnowledgeContextTerms(context));
  const selected: typeof fused = [];
  let tokenBudget = 0;
  for (const row of fused) {
    if (selected.length >= 12) break;
    if (selected.length > 0 && tokenBudget + row.tokenCount > 12_000) continue;
    selected.push(row);
    tokenBudget += row.tokenCount;
  }
  if (selected.length === 0) throw new Error("The knowledge corpus did not return relevant evidence.");

  const ids = selected.map((row) => row.id);
  const assertions = await prisma.$queryRaw<GraphAssertionRow[]>(Prisma.sql`
    SELECT source."label" AS "fromLabel", e."relationType", target."label" AS "toLabel",
      e."assertionKind", e."evidenceChunkId"
    FROM "knowledge_edges" e
    JOIN "knowledge_nodes" source ON source."id" = e."fromNodeId"
    JOIN "knowledge_nodes" target ON target."id" = e."toNodeId"
    WHERE e."revisionId" = ${corpus.id}
      AND e."evidenceChunkId" IN (${Prisma.join(ids)})
    ORDER BY e."relationType", source."label", target."label"
    LIMIT 20
  `);

  const evidenceRows = await prisma.$queryRaw<EvidenceRow[]>(Prisma.sql`
    SELECT ce."chunkId", evidence."id" AS "evidenceId", evidence."sectionPath",
      evidence."locator", evidence."normalizedText", evidence."metadata"
    FROM "knowledge_chunk_evidence" ce
    JOIN "knowledge_evidence" evidence ON evidence."id" = ce."evidenceId"
    WHERE ce."chunkId" IN (${Prisma.join(ids)})
    ORDER BY ce."chunkId",
      ts_rank_cd(to_tsvector('english', evidence."normalizedText"), websearch_to_tsquery('english', ${question})) DESC,
      length(evidence."normalizedText") DESC,
      evidence."ordinal"
  `);
  const evidenceByChunk = new Map<string, EvidenceRow>();
  for (const row of evidenceRows) {
    if (!evidenceByChunk.has(row.chunkId)) evidenceByChunk.set(row.chunkId, row);
  }

  const citations: KnowledgeCitation[] = selected.map((row, index) => {
    const sourceEvidence = evidenceByChunk.get(row.id);
    const locator = evidenceLocator(sourceEvidence?.locator, row);
    return {
      id: `S${index + 1}`,
      evidenceId: sourceEvidence?.evidenceId ?? row.id,
      documentId: row.documentId,
      title: row.title,
      edition: row.edition,
      sourceKind: row.sourceKind,
      sourceRole: row.sourceRole as KnowledgeCitation["sourceRole"],
      locator,
      sectionPath: sourceEvidence?.sectionPath ?? [],
      excerpt: excerpt(sourceEvidence?.normalizedText ?? row.content),
      officialUrl: officialUrl(row),
      structuredFields: structuredFields(sourceEvidence?.metadata),
      score: Number(row.fused.toFixed(6)),
    };
  });
  const evidence = selected
    .map((row, index) => `[S${index + 1}] ${row.title} — ${locatorLabel(citations[index].locator, row.locator)} (${row.sourceRole})\n${row.content}`)
    .join("\n\n");
  const graph = assertions
    .map((assertion) => `${assertion.fromLabel} --${assertion.relationType}--> ${assertion.toLabel} (${assertion.assertionKind})`)
    .join("\n");
  return { citations, evidence, graph, corpus };
}

export function buildKnowledgePrompt(input: {
  question: string;
  history: KnowledgeChatTurn[];
  context?: ViewerKnowledgeContext;
  evidence: string;
  graph: string;
}) {
  const history = input.history.map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`).join("\n");
  return [
    history ? `RECENT CONVERSATION\n${history}` : "",
    input.context ? `IFC REVIEW CONTEXT\n${JSON.stringify(input.context)}` : "",
    `EVIDENCE\n${input.evidence}`,
    input.graph ? `EVIDENCE-BACKED GRAPH ASSERTIONS\n${input.graph}` : "",
    `QUESTION\n${input.question}`,
  ].filter(Boolean).join("\n\n");
}

export const KNOWLEDGE_INSTRUCTIONS = `You are the CORENET X knowledge assistant for IFC reviewers.
Answer only from the supplied evidence. Cite every factual claim using the source ids exactly as [S1], [S2], and so on.
Distinguish regulatory or COP requirements from industry mapping guidance, controlled values, examples, and sample values.
Never turn an example or sample value into a mandatory constraint. If sources differ, state both with their citations instead of silently reconciling them.
If the evidence is insufficient, say so plainly. This is review guidance, not certification or a substitute for current regulations and agency circulars.`;

export function knowledgeSafetyIdentifier(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}

export function getKnowledgeOpenAI() {
  return getOpenAI();
}
