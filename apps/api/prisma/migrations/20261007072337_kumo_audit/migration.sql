-- CreateTable
CREATE TABLE "KumoAuditLog" (
    "id" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "summary" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KumoAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KumoAuditLog_itemType_itemId_at_idx" ON "KumoAuditLog"("itemType", "itemId", "at");

-- CreateIndex
CREATE INDEX "KumoAuditLog_userId_idx" ON "KumoAuditLog"("userId");
