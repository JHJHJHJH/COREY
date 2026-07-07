-- Structural change summary (counts vs the previous latest version), computed
-- at upload time. Existing rows stay NULL (initial/legacy versions).
ALTER TABLE "model_version_records" ADD COLUMN "changeSummary" JSONB;
