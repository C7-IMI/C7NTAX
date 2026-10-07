-- AlterTable
ALTER TABLE "WebauthnCredential" ADD COLUMN     "deviceName" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3);
