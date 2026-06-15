-- CreateTable
CREATE TABLE "draft_records" (
    "modelId" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "draft_records_pkey" PRIMARY KEY ("modelId")
);

-- AddForeignKey
ALTER TABLE "draft_records" ADD CONSTRAINT "draft_records_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
