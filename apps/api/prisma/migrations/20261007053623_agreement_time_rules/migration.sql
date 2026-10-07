-- AlterTable
ALTER TABLE "ServiceAgreement" ADD COLUMN     "agreementType" TEXT NOT NULL DEFAULT 'service',
ADD COLUMN     "blockHoursIncluded" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "blockHoursUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "hourlyRate" DOUBLE PRECISION,
ADD COLUMN     "overtimeAfter" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "overtimeEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "overtimeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
ADD COLUMN     "rateTier" TEXT;

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "agreementId" TEXT,
ADD COLUMN     "billedMinutes" INTEGER,
ADD COLUMN     "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "splitFrom" TEXT;
