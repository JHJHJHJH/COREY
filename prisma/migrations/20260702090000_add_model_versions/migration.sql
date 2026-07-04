-- Model versions: each uploaded IFC becomes an immutable version row pointing
-- at its own object-storage key. Existing single-file models are backfilled as
-- version 1, keeping their legacy `${modelId}.ifc` object key so no objects
-- need to move.

-- 1. Version catalog table.
CREATE TABLE "model_version_records" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "label" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_version_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "model_version_records_modelId_versionNumber_key"
    ON "model_version_records"("modelId", "versionNumber");

ALTER TABLE "model_version_records"
    ADD CONSTRAINT "model_version_records_modelId_fkey"
    FOREIGN KEY ("modelId") REFERENCES "model_records"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Backfill: every existing model becomes version 1 with its legacy key.
INSERT INTO "model_version_records" ("id", "modelId", "versionNumber", "size", "objectKey", "uploadedAt")
SELECT gen_random_uuid(), "id", 1, "size", "id" || '.ifc', "uploadedAt"
FROM "model_records";
