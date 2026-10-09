-- The Email Studio's three tables.
--
-- `EmailTemplate` holds the words of one message, keyed by a stable `EmailMessageKey`. The row is
-- **optional on purpose**: no row means the built-in default in `apps/api/src/services/emailMessages.ts`
-- renders, so an instance that has never opened the Studio sends exactly what its hard-coded senders
-- sent before this table existed, and "reset to default" is a delete rather than a restored copy.
--
-- `EmailBrandKit` is a single row (id `instance`), created on first save rather than here, so the
-- defaults stay in one place — the code — instead of being duplicated into a migration that cannot
-- be changed afterwards.
--
-- `EmailMessageLog` has no foreign key to `User`: the person who pressed Send outlives their
-- membership, and a delivery log that loses its rows when an account is removed is worse than one
-- that keeps a name it can no longer resolve. It is the `AiActionAudit` convention.

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "text" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "text" TEXT,
    "note" TEXT,
    "savedById" TEXT,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailBrandKit" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL DEFAULT 'C7NTAX',
    "companyName" TEXT NOT NULL DEFAULT 'Cyber 7 Group, LLC',
    "logoUrl" TEXT,
    "logoDarkUrl" TEXT,
    "wordmark" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#c00000',
    "accentColor" TEXT NOT NULL DEFAULT '#00c0f4',
    "footerText" TEXT,
    "legalText" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailBrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessageLog" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" INTEGER,
    "providerMessageId" TEXT,
    "result" TEXT NOT NULL,
    "error" TEXT,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "sentById" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "EmailTemplate"("key");

-- CreateIndex
CREATE INDEX "EmailTemplateVersion_templateId_savedAt_idx" ON "EmailTemplateVersion"("templateId", "savedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplateVersion_templateId_version_key" ON "EmailTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "EmailMessageLog_at_idx" ON "EmailMessageLog"("at");

-- CreateIndex
CREATE INDEX "EmailMessageLog_key_at_idx" ON "EmailMessageLog"("key", "at");

-- CreateIndex
CREATE INDEX "EmailMessageLog_result_at_idx" ON "EmailMessageLog"("result", "at");

-- AddForeignKey
ALTER TABLE "EmailTemplateVersion" ADD CONSTRAINT "EmailTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
