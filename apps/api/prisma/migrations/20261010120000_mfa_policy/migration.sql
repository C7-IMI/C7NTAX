-- Multi-factor authentication becomes a policy rather than a per-account fact.
--
-- Until now an account either had MFA or did not: `mfaEnabled` was set the moment somebody verified
-- their first authenticator code, and the sign-in asked for a second factor for those accounts and
-- nobody else. There was no way to *require* it, no way to exempt one account from a requirement, and
-- no way to say which of the three supported methods a deployment is willing to accept.
--
-- The columns below separate the two facts that were sharing one flag:
--
--   · `mfaEnabled`, `mfaSecret`, `mfaBackupCodes` (existing) — **what the account has enrolled**.
--     Unchanged, and still what the sign-in reads when it asks for a code.
--   · `mfaState` — **the per-account policy**: `default` follows the instance setting, `disabled`
--     exempts the account from a requirement, `enforced` requires it whatever the instance says.
--     The three words are Entra's, because an administrator who has used Entra will already know them.
--   · `mfaMethod` — which method they enrolled, so the sign-in knows which screen to show and the
--     administrator knows what to tell them to use.
--   · `mfaEnrolledAt` — when. Its presence is what makes an account "done", separately from
--     `mfaEnabled`, which a reset clears.
--   · `mfaGraceUntil` — the deadline an account was given when a requirement was switched on. Null
--     means the requirement applies now; a future date means "remind them, do not block them yet".
--     This is the column that lets an instance be turned on without locking out everyone who has not
--     registered.
--
-- Every column is nullable or defaulted, and `default` reproduces the old behaviour exactly: an
-- instance that never opens the new settings asks for a second factor from the same accounts as before,
-- and forbids nothing.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "mfaState" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "User" ADD COLUMN "mfaMethod" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mfaGraceUntil" TIMESTAMP(3);

-- An account that already had MFA working has, by definition, enrolled. Dated from `updatedAt`
-- because nothing recorded when it happened, and a wrong-but-plausible date is better than a null
-- that reads as "never enrolled" on the administrator's screen.
UPDATE "User" SET "mfaEnrolledAt" = "updatedAt" WHERE "mfaEnabled" = true AND "mfaEnrolledAt" IS NULL;
