-- Machine access, and one place to keep events received from other systems.
--
-- `ApiKey` stores only the SHA-256 of the secret half of the presented key; `prefix` is the
-- searchable half, which is why it is in clear. The key acts as `userId` (a real account, so
-- writes are attributable), narrowed to `permissions`, which is what keeps an integration from
-- doing more than the person who issued its credential.
--
-- `EventRecord` is unique on `(source, externalId)`: that is what turns an alert storm into one
-- ticket with an occurrence count rather than one ticket per poll.

CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByEmail" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");
CREATE INDEX "ApiKey_revokedAt_idx" ON "ApiKey"("revokedAt");

ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventRecord" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'alert',
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'open',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "ticketId" TEXT,
    "companyId" TEXT,
    "apiKeyId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventRecord_source_externalId_key" ON "EventRecord"("source", "externalId");
CREATE INDEX "EventRecord_receivedAt_idx" ON "EventRecord"("receivedAt");
CREATE INDEX "EventRecord_ticketId_idx" ON "EventRecord"("ticketId");
