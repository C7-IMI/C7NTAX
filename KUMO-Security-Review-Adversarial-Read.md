# Kumo vault key fix — adversarial read

> **Provenance:** written by the reviewer on branch `claude/kumo-vault-key-adversarial-read` (commit `9125481c`) and reproduced here verbatim so `main` carries the same record. No code was changed by the reviewer.
>
> **Answered by:** `KUMO-Security-Review-Adversarial-Read-Response.md`.
>
> **Status:** all four recommendations were checked against the code and implemented — the long-hex hint and the two extra generations, the conditional write, skipping a row with an unreadable part, rejecting degenerate keys, and the startup sample trial-decrypt. Two of the reviewer's limits are addressed by wording rather than behaviour, and the reply says which and why. The review's own framing of the other twelve findings is unchanged.

---

Reviewer: Claude. Scope: commit `86a67c97` (finding 1 of `KUMO-SECURITY-REVIEW.md`) on `origin/main` at `c3d492e4` — `services/kumoCrypto.ts`, `reencrypt-kumo-vault.ts`, the startup wiring in `index.ts`, and the Bicep/Dockerfile it depends on. Not in scope: the other twelve findings, which I did not re-verify here. I read the code and tested key-format edge cases by hand; I did not run the probe, the job or a database.

## Verdict

The fix is right and the change is sound. Refusing to start is the correct behaviour. The classification has one missed generation and one small race, and the fail-closed check covers a bad configuration but not a good-looking key that cannot open the existing rows. None of them blocks commit; two are worth doing before this runs against any real data.

## Your two questions

### 1. Refuse to start in production, or warn?

Refuse. A warning is what the original defect already was: the system quietly used a weaker key and the log line said success. A vault key is the one setting where a mistaken fallback is silent data exposure, and the cost of refusing is a failed boot, which the deployment is already built to survive: the new revision sits at 0% traffic, never becomes healthy, and the previous revision keeps serving (the PLAN-030 health gate). So fail-closed here is cheap in this deployment, which is the condition under which it is right.

Three limits on that, none of which argue for a warning:

- **It is only as strong as `NODE_ENV`.** The Dockerfile (L36) and `main.bicep` (L657) both set `NODE_ENV=production`, so the Azure path is covered, including dev. Any other way of running the API (a process manager, a staging box with `NODE_ENV=staging`) falls back to the JWT-derived key without refusing. If a non-Azure production exists, say so in the error message or key the refusal off something other than a name that varies by host.
- **It checks the key's shape, not that it opens the existing data.** `assertKumoKeyUsable` confirms the key parses and logs source and fingerprint. A correctly formatted key that is simply the wrong key, such as a rotated Key Vault value or a restore from an old backup, boots cleanly and fails at the first reveal, which is the "technician mid-incident" case the comment says the startup check exists to prevent. Suggested: at boot, trial-decrypt a small sample of rows (or a stored canary value) and log a loud error with the count that fail. I would not refuse to start on that: a data-versus-key mismatch should not take ticketing down, whereas a missing or malformed key should. Surface the count somewhere an admin sees it.
- **Blank counts as unset.** `KUMO_MASTER_KEY=""` or whitespace is treated as missing, so in production it refuses. Good, and it covers an empty Key Vault secret.

### 2. A case the migration's classification misses

Yes, one real one, one smaller one, one race.

**Missed generation: long hex keys.** The old code accepted a hex key of 64 characters or more and kept the first 32 bytes (`Buffer.from(envKey,"hex").slice(0,32)`). Anyone who supplied an 80- or 128-character hex value had rows encrypted under that truncated key. The job knows two keys, the current one and the JWT-derived one. Rows from a long hex key are neither, so they would be reported as "cannot be read with either key" and left untouched, which is safe. But the new decoder also refuses such a value at boot: an 80-character hex string fails the 64-hex test, passes the base64 character test, and is rejected as "decodes to 60 bytes", a message that gives no hint what happened. The fix path is simple (the first 64 characters are the key that was in use) but nothing says so. Add that hint to the error, and teach `classify` a third candidate key if any such deployment can exist. The repository's documented format was base64, so this is probably empty, but it is the one place the old behaviour honoured something the new code rejects.

**Smaller: the development default.** Rows written when `JWT_SECRET` was unset were encrypted under the hard-coded dev secret. `legacyVaultKey()` uses whatever `JWT_SECRET` the job process has. A dev database moved to a machine where `JWT_SECRET` is set would show those rows as unreadable. Trying both the JWT-derived and the dev-default key costs one more `decryptWithKey` attempt.

**Race: lost update.** The job reads all rows, then `update`s each by `id` with ciphertext computed from the earlier read. If someone edits that password between the read and the write, the stale re-encrypted value overwrites their edit. The window is short and the job is a one-off, but a conditional write (`updateMany` where `encryptedPassword` still equals the value read) removes it, and for a vault that is cheap insurance.

**Partial rows.** If a row's password is legacy but its TOTP secret is "unreadable", the password is re-encrypted with a new iv/tag and the bare-form TOTP that shared the old iv/tag is left pointing at values that no longer exist. It was unreadable anyway, but the output says "left untouched" and the row is no longer in the state it was. Cleanest rule: if any part of a row is unreadable, skip the whole row and report it.

What the job gets right: GCM authentication makes trial decryption a trustworthy classifier; it is idempotent; dry run is the default; it never overwrites what it cannot read; and TOTP is written back self-contained, matching what `kumo.ts` L446 and L498 write today. I checked that the only other consumer of the vault key besides `KumoPassword` is `emailConnectorCrypto.ts`, which the job covers (three fields). A guard that fails if a new file imports `kumoCrypto` without being added to the job would keep that true.

## Smaller observations

- Base64 handling: 43 characters without padding is accepted (32 bytes), 44 without `=` is rejected (33 bytes). Base64url (`-`, `_`) is rejected rather than misread. Both are right.
- No strength check: 32 zero bytes (`AAAA…`) passes. Worth rejecting an all-zero or single-repeated-byte key; it catches the template placeholder.
- Production note for Azure: a first deploy has an empty vault, so the re-encryption job has nothing to move. It matters only for an environment that already holds rows. The image ships `tsx` and `src` (Dockerfile), so `pnpm kumo:reencrypt` can run in the container.
- Fingerprint (first 12 hex of SHA-256 of the key) is safe to log.

## What I would do, in order

1. Add the "first 64 characters" hint to the decode error and let `classify` try the long-hex and dev-default keys.
2. Make the job's write conditional and skip a row entirely if any part of it is unreadable.
3. Add a startup canary or sample trial-decrypt that logs loudly on mismatch; do not make it a boot refusal.
4. Reject degenerate keys.

None of this is a reason to hold the commit.
