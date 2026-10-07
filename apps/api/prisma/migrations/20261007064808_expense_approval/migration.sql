-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSystem" TEXT,
ADD COLUMN     "miles" DOUBLE PRECISION,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'submitted',
ADD COLUMN     "syncedAt" TIMESTAMP(3),
ADD COLUMN     "vendor" TEXT;

-- CreateIndex
CREATE INDEX "Expense_status_idx" ON "Expense"("status");

-- CreateIndex
CREATE INDEX "Expense_ticketId_idx" ON "Expense"("ticketId");
