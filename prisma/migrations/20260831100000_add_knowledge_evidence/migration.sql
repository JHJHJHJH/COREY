CREATE TABLE "knowledge_evidence" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "sectionPath" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "locator" JSONB NOT NULL,
    "rawText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    CONSTRAINT "knowledge_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_evidence_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "knowledge_corpus_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_evidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "knowledge_evidence_documentId_ordinal_key" ON "knowledge_evidence"("documentId", "ordinal");
CREATE INDEX "knowledge_evidence_revisionId_documentId_ordinal_idx" ON "knowledge_evidence"("revisionId", "documentId", "ordinal");
CREATE INDEX "knowledge_evidence_contentHash_idx" ON "knowledge_evidence"("contentHash");

CREATE TABLE "knowledge_chunk_evidence" (
    "chunkId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "knowledge_chunk_evidence_pkey" PRIMARY KEY ("chunkId", "evidenceId"),
    CONSTRAINT "knowledge_chunk_evidence_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_chunk_evidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "knowledge_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "knowledge_chunk_evidence_evidenceId_idx" ON "knowledge_chunk_evidence"("evidenceId");
