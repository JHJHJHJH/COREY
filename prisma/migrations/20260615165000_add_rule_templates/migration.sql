-- CreateTable
CREATE TABLE "rule_template_records" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'starter',
    "sourceFileName" TEXT,
    "sourceText" TEXT,
    "config" JSONB NOT NULL,
    "ruleCount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_template_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rule_template_records_sortOrder_name_idx" ON "rule_template_records"("sortOrder", "name");
