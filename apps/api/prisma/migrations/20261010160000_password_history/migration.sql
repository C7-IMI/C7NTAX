-- Password history: an account may not reuse its last five passwords.
--
-- The column is a list of **bcrypt hashes**, most recent first, and it is hashed for the same reason the
-- current password is: a history is a list of credentials that used to work, and the only question ever
-- asked of it is "is this one of them". bcrypt answers that without the database holding the password.
--
-- It starts empty for every existing account, which is the only honest starting point: nothing has been
-- recording these, so there is no history to invent. The effect is that the rule begins to bite from the
-- first change onward — a person reusing a password they had before is refused once that password is in
-- the list, rather than a rule pretending to know what it was never told.
--
-- The cap is enforced in the application (`PASSWORD_HISTORY_DEPTH`, in `@C7NTAX/shared`) rather than by a
-- check constraint: the list is appended to on a password change and truncated to the newest five there,
-- and a constraint expressing "at most five, most recent first" would be unreadable next to the three
-- lines that actually maintain it.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "previousPasswordHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
