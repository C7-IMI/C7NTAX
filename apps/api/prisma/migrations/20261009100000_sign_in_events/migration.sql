-- One row per sign-in attempt, so the application can answer "who signed in, from where, with what,
-- and who did not get in".
--
-- Users are kept when a user is deleted (ON DELETE SET NULL), and the address that was typed is stored
-- on the row: an audit trail that loses the person it is about is not an audit trail, and an attempt
-- that named no account is exactly the row somebody wants to see.
CREATE TABLE "SignInEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "device" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignInEvent_pkey" PRIMARY KEY ("id")
);

-- The three questions the screen asks, in the order it asks them: newest first, one person's history,
-- and everything that failed.
CREATE INDEX "SignInEvent_createdAt_idx" ON "SignInEvent"("createdAt");
CREATE INDEX "SignInEvent_userId_createdAt_idx" ON "SignInEvent"("userId", "createdAt");
CREATE INDEX "SignInEvent_result_createdAt_idx" ON "SignInEvent"("result", "createdAt");

ALTER TABLE "SignInEvent" ADD CONSTRAINT "SignInEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
