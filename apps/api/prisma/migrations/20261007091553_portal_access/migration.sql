-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "portalAccentColor" TEXT,
ADD COLUMN     "portalLogoUrl" TEXT;

-- CreateTable
CREATE TABLE "PortalLoginCode" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalLoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalLoginCode_contactId_idx" ON "PortalLoginCode"("contactId");

-- CreateIndex
CREATE INDEX "PortalLoginCode_expiresAt_idx" ON "PortalLoginCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSession_sessionToken_key" ON "PortalSession"("sessionToken");

-- CreateIndex
CREATE INDEX "PortalSession_contactId_idx" ON "PortalSession"("contactId");

-- CreateIndex
CREATE INDEX "PortalSession_expiresAt_idx" ON "PortalSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "PortalLoginCode" ADD CONSTRAINT "PortalLoginCode_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
