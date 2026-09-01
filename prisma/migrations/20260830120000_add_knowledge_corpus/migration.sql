CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "knowledge_corpus_revisions" (
    "id" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingDimensions" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    CONSTRAINT "knowledge_corpus_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_corpus_revisions_sourceFingerprint_key" ON "knowledge_corpus_revisions"("sourceFingerprint");
CREATE INDEX "knowledge_corpus_revisions_status_activatedAt_idx" ON "knowledge_corpus_revisions"("status", "activatedAt");

CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "edition" TEXT,
    "metadata" JSONB NOT NULL,
    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_documents_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "knowledge_corpus_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "knowledge_documents_revisionId_sourceKey_key" ON "knowledge_documents"("revisionId", "sourceKey");
CREATE INDEX "knowledge_documents_revisionId_sourceKind_idx" ON "knowledge_documents"("revisionId", "sourceKind");

CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceRole" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "sheetName" TEXT,
    "rowStart" INTEGER,
    "rowEnd" INTEGER,
    "tokenCount" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embedding" VECTOR(1536),
    "search_vector" TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED,
    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_chunks_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "knowledge_corpus_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "knowledge_chunks_revisionId_stableKey_key" ON "knowledge_chunks"("revisionId", "stableKey");
CREATE INDEX "knowledge_chunks_revisionId_sourceKind_sourceRole_idx" ON "knowledge_chunks"("revisionId", "sourceKind", "sourceRole");
CREATE INDEX "knowledge_chunks_documentId_pageNumber_idx" ON "knowledge_chunks"("documentId", "pageNumber");
CREATE INDEX "knowledge_chunks_documentId_sheetName_rowStart_idx" ON "knowledge_chunks"("documentId", "sheetName", "rowStart");
CREATE INDEX "knowledge_chunks_search_vector_idx" ON "knowledge_chunks" USING GIN ("search_vector");
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE "knowledge_nodes" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    CONSTRAINT "knowledge_nodes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_nodes_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "knowledge_corpus_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "knowledge_nodes_revisionId_canonicalKey_key" ON "knowledge_nodes"("revisionId", "canonicalKey");
CREATE INDEX "knowledge_nodes_revisionId_nodeType_label_idx" ON "knowledge_nodes"("revisionId", "nodeType", "label");

CREATE TABLE "knowledge_edges" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "evidenceChunkId" TEXT,
    "assertionKind" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    CONSTRAINT "knowledge_edges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_edges_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "knowledge_corpus_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_edges_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_edges_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_edges_evidenceChunkId_fkey" FOREIGN KEY ("evidenceChunkId") REFERENCES "knowledge_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "knowledge_edges_revisionId_fromNodeId_toNodeId_relationType_assertionKind_key" ON "knowledge_edges"("revisionId", "fromNodeId", "toNodeId", "relationType", "assertionKind");
CREATE INDEX "knowledge_edges_revisionId_fromNodeId_idx" ON "knowledge_edges"("revisionId", "fromNodeId");
CREATE INDEX "knowledge_edges_revisionId_toNodeId_idx" ON "knowledge_edges"("revisionId", "toNodeId");
CREATE INDEX "knowledge_edges_evidenceChunkId_idx" ON "knowledge_edges"("evidenceChunkId");

CREATE TABLE "knowledge_ingest_runs" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "embeddedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "knowledge_ingest_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_ingest_runs_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "knowledge_corpus_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "knowledge_ingest_runs_revisionId_startedAt_idx" ON "knowledge_ingest_runs"("revisionId", "startedAt");
