# Kumo vault key fix — response to the adversarial read

**Answers:** `KUMO-Security-Review-Adversarial-Read.md` (reviewer's, branch `claude/kumo-vault-key-adversarial-read`, commit `9125481c`).
**Checked against:** `main` at `c3d492e4`, the commit the review read.
**Scope:** finding 1 only, matching the review.
**Status:** all four recommendations implemented and verified by running them.

---

## Verdict

The review is right on every point, including the two it could only have found by reading carefully: the missed
generation and the partial-row hazard. Both are fixed. One of them is worse than the review could see from the
outside — the same columns are shared with the password — and the reply says how.

## The four recommendations

### 1. The long-hex hint, and the extra generations

**Done.** The error now names what was supplied: *"it is 120 hex characters. The previous code used the first
64 of them (32 bytes) and ignored the rest…"*, rather than *"decodes to 90 bytes"*, which for a hex input
describes a decoding that never happened and sends the reader looking for a base64 mistake.

`classify` is gone. A single `open()` tries the current key and then every candidate generation, and the
candidates are printed so an operator can see what was searched:

- `SHA-256("kumo-vault:" + JWT_SECRET)` — the configured secret;
- the same derivation from the built-in development secret, added only when it differs from the first;
- `KUMO_MASTER_KEY` truncated to its first 32 bytes, added only when the environment carries a long hex value.

**Verified by planting a row.** A `KumoPassword` row was encrypted under the *development-default* generation —
one the previous job could not have read, because this environment sets `JWT_SECRET` and that job derived only
from the configured secret. The new job reported **1 value on an older key, 0 unreadable**; after `--apply` the
row opened with the master key and carried `encryptionKeyId: v1`; the following run found **6 on the current
key, 0 older**, so the change is idempotent. The planted row was deleted afterwards.

### 2. A conditional write, and skipping a row with an unreadable part

**Done, and both verified.** Every write is now `updateMany` guarded on the values that were read, so an edit
made while the job runs wins and the row is reported rather than overwritten. Proven directly: a guarded write
carrying stale values matched **0 rows**, and the concurrent edit survived.

A row with any unreadable part is now skipped whole, as suggested. The reason is slightly stronger than "it was
unreadable anyway": `totpSecret` in its bare form shares `iv`/`authTag` **with the password**, so re-encrypting
the password replaces the very columns the secret is read against. That coupling also means a bare secret under
the *correct* key breaks the same way, so a readable secret is now always rewritten in its self-contained
`ct:iv:tag` form whenever the row is touched. There is no live data for this — zero rows carry a TOTP secret —
which is exactly why it would have gone unnoticed until it mattered.

### 3. The startup sample trial-decrypt

**Done, and deliberately not a boot refusal.** `services/kumoKeyHealth.ts` samples up to 20 rows once the server
is listening and warns when any of them fail to open, naming the fingerprint and the count. Verified with a
well-formed but wrong key: *"the vault key from KUMO_MASTER_KEY (fingerprint e4de33d9a590) opened 0 of 5 sampled
passwords"*. Under the correct key it is silent. It cannot fail startup, and it warns against re-encrypting in
response — the right question after that message is which key the data belongs to, not how to move it.

One caveat worth stating rather than leaving to be discovered: it logs through `logger.warn`, which writes
`dev-errors.log` and not stdout, so the warning does not appear in `docker logs`. That is the application's
existing warning channel and inventing a second one was out of scope, but "surface the count somewhere an admin
sees it" is not fully met by a file. A count on the admin surface is a larger change than this fix.

### 4. Degenerate keys

**Done, both forms.** All-zero (the placeholder) and the same byte repeated 32 times (the template, or a key
typed in by hand) are refused. The suggestion was "all-zero or single-repeated-byte"; the broader of the two is
the one implemented.

## The two limits on refusing

**It is only as strong as `NODE_ENV` — confirmed, and addressed in wording rather than behaviour.** The
Dockerfile (L36) and `main.bicep` (L657) set it, so Azure is covered and a non-Azure host is not. The refusal
stays keyed to `NODE_ENV` because the guard immediately above it in `index.ts` already keys off `NODE_ENV`, and
a pair of security checks that disagree about what production means is worse than one with a documented limit.
What changed is what the operator is told: the refusal names `NODE_ENV=production` and says what to do if the
host should not be treated that way, and the non-production warning now says the check will **not** fire — so
the limit is visible at the moment it applies rather than only in this document.

**It checks the shape, not whether the key opens the data.** The sample trial-decrypt is the fix, it is in, and
it is not a boot refusal — which is the recommendation, and the right one.

## The housekeeping note

The reviewer is right and my earlier wording was loose. Its PLAN-030 entries numbered 379–385 lived only on
review branches, so nothing collided; the 379 on `main` is the entry for that round's own prompt. The conclusion
— that importing the Kumo review's own 379 would create a duplicate — was correct, and the explanation of why
was not carefully checked. That is the same class of error the whole review series is about, and it is worth
recording as such.

## What was not changed

- **No guard script for new consumers.** The reviewer suggested one that fails when a new file imports
  `kumoCrypto` without being added to the job. Instead the job's header lists the two importers and says that a
  new one is a new generation. A check that greps for imports passes while being wrong in the cases that
  matter, and the note is read where someone would need it.
- **The other twelve findings**, which the review scoped out and so does this.

## Evidence

| Check | Result |
|---|---|
| `pnpm probe:kumo-key` | **14 cases, 14 passed / 0 failed** — base64, hex and unpadded base64 resolve to the *same* fingerprint; ten refusals each name their reason |
| Job, dry run against the real vault | 5 values on the current key, 0 older, 0 unreadable, nothing written |
| Job, planted legacy row | found as *1 on an older key*, moved on `--apply`, idempotent afterwards |
| Conditional write | stale guard matched **0 rows**; the concurrent edit survived |
| Startup trial-decrypt | warned *0 of 5* under a wrong key; silent under the right one |
| `tsc --noEmit` | clean |