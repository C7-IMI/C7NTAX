-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "billThroughDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "BillingBatch" (
    "id" TEXT NOT NULL,
    "billThroughDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingBatch_status_idx" ON "BillingBatch"("status");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BillingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
