-- Per-user scoping: uploaded models become private to a user, and the single
-- global rule config row is reassigned to the default local user. Existing rows
-- are backfilled to 'local' (the COREY_DEFAULT_USER default); if a deployment
-- customized COREY_DEFAULT_USER, reassign these rows to that id manually.

-- 1. Add owner_id to models, backfilling existing rows to the default user.
ALTER TABLE "model_records" ADD COLUMN "ownerId" TEXT;
UPDATE "model_records" SET "ownerId" = 'local' WHERE "ownerId" IS NULL;
ALTER TABLE "model_records" ALTER COLUMN "ownerId" SET NOT NULL;

-- 2. Index for per-user model listing (newest first).
CREATE INDEX "model_records_ownerId_uploadedAt_idx" ON "model_records"("ownerId", "uploadedAt");

-- 3. Reassign the legacy single rule config (id 'default') to the local user.
UPDATE "rule_configs" SET "id" = 'local' WHERE "id" = 'default';
