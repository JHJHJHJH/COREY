-- CreateTable
CREATE TABLE "model_records" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_configs" (
    "id" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_configs_pkey" PRIMARY KEY ("id")
);
