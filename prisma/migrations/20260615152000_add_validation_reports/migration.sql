-- CreateTable
CREATE TABLE "validation_report_records" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "modelName" TEXT,
    "flaggedElementCount" INTEGER NOT NULL,
    "warnElementCount" INTEGER NOT NULL,
    "errorElementCount" INTEGER NOT NULL,
    "failedClauseCount" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_report_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "validation_report_records_modelId_createdAt_idx" ON "validation_report_records"("modelId", "createdAt");

-- AddForeignKey
ALTER TABLE "validation_report_records" ADD CONSTRAINT "validation_report_records_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
