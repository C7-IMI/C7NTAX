# Kumo Security Review — Response

**Answers:** `KUMO-SECURITY-REVIEW.md` (reviewer's, branch `claude/kumo-security-review`, commit `4670f95a`).
**Checked against:** `main` at `07c025f5`.
**Method:** every finding was checked by running the code or reading the exact lines it names. Where a finding could be confirmed by execution rather than inspection, it was. No code was changed.
**Status:** all thirteen findings hold. Two are corrected in detail, none is withdrawn. Nothing is fixed yet.

---

## The verdict

This review is right, and it is right about the thing that matters most. The encryption is sound; the key
handling around it is not, and the code contradicts the deployment documentation in a way that silently
degrades the strongest control in the system. Finding 1 is not a hypothetical: I ran it.

It is also the first review of Kumo that has been done at all. `SOC2.Compliance.md` and
`PLAN-015-Kumo-Vault-Security-and-Encryption.md` both describe Kumo as the surface that holds every client's
credentials, and both already recorded the key fallback as an accepted gap. What neither recorded is that the
fallback fires **when a key is supplied**. That distinction is the whole of finding 1 and it is new.

---

## Finding 1 (Critical) — confirmed, and worse than described

Confirmed by execution. `services/kumoCrypto.ts`, `deriveKey()`:

```
envKey && envKey.length >= 64  →  Buffer.from(envKey, "hex").slice(0, 32)
otherwise                      →  SHA-256("kumo-vault:" + (JWT_SECRET || "C7NTAX-dev-secret-change-in-prod"))
```

Against the contract, which I checked in all four places that state it:

| Where | What it says |
|---|---|
| `.env.production.example:46` | `KUMO_MASTER_KEY=<base64-32-bytes>` |
| `infra/azure/main.bicepparam` | `<32 random bytes, base64>` |
| `infra/azure/*.bicepparam` (second) | `<32 random bytes, base64>` |
| `scripts/azure/deploy-env.ps1:225` | requires `KUMO_MASTER_KEY_VALUE` |

A base64 32-byte key is 44 characters. The gate demands 64, so **every documented deployment supplies a key
that is silently discarded**, and the vault key is derived from `JWT_SECRET` instead. The three consequences
the review names are correct: Key Vault protects nothing, `JWT_SECRET` holders can decrypt the vault, and
rotating `JWT_SECRET` after an incident makes every stored password unreadable.

**Three additions the review does not make.**

1. **The failure is invisible from the running system.** The startup line is
   `[KumoCrypto] Key initialized (length: 32)`. It prints the length of the *derived* key, which is 32 on
   both branches. An operator who correctly suspected the fallback and went looking for evidence would read
   that line and conclude the master key was in use. The system not only ignores the key, it reports success.
   Any fix must make the source explicit — which branch ran, and a fingerprint of the key — or the same
   mistake recurs the first time someone rotates the secret.
2. **The decoded length is never validated.** The hex branch is `Buffer.from(envKey, "hex").slice(0, 32)`.
   A 128-character hex string is accepted and truncated to the first 16 bytes without complaint; a
   non-hex string silently produces a short or empty buffer. So the gate is not "is this a valid 32-byte
   key" but "is this string at least 64 characters long", which is a different and much weaker test.
   The fix should decode, then require exactly 32 bytes, then refuse to start otherwise.
3. **The fallback is a documented decision; the format mismatch is not.** `SOC2.Compliance.md:46` and
   `PLAN-015…:19` both record `KUMO_MASTER_KEY → JWT_SECRET → hardcoded` as a known limitation. So falling
   back is not the defect — falling back *while a valid key was supplied* is. Those are separate problems
   and they need separate fixes: the format bug is a defect, the fallback is a decision that should be
   revisited only for production (dev is fine with a warning).

**On the re-encryption step, I measured the situation rather than reasoning about it.** The review says the
fix needs "a re-encryption migration". That is settled by how much real ciphertext exists under the current
derivation, so I queried the development database and tested the rows against each candidate key:

| Question | Answer |
|---|---|
| `KumoPassword` rows in the dev database | **5** |
| Rows holding real ciphertext (not an `ENC:` seed marker) | **5** |
| Rows that decrypt with the key derived from the `.env` `JWT_SECRET` | **5 of 5** |
| Rows that decrypt with the hardcoded public default | **0 of 5** |
| Rows with a TOTP secret (finding 5) | 0 |
| Rows deactivated (finding 7) | 0 |
| Kumo in production | never deployed |

So the answer is **yes, dev holds five real rows encrypted under the current derivation, and no production
data exists at all.** The migration is therefore real but small: five rows, no production data, and the
migration order is — ship the parsing fix able to read both derivations, re-encrypt the rows stamping a real
`encryptionKeyId`, verify by decrypting under the new key, then remove the old path. A five-row migration with
no production data is materially cheaper than the review implies, and it will never be cheaper than now,
because the first production credential is when this stops being a script and becomes a change window.

**Two incidental measures, since `encrypt()` was open in front of me.** The IV is `randomBytes(16)`, which
confirms finding 13's length point (16 bytes, where GCM's standard and most-analysed length is 12). The
fallback's `hash.slice(0, 32)` is a no-op — SHA-256 already returns exactly 32 bytes — so the fallback key is
the full digest of `"kumo-vault:" + JWT_SECRET`, and the only thing standing between the vault and a
JWT-secret holder is that string prefix.

**One hypothesis I tested and am reporting as a non-finding, because it would have been easy to assert and
wrong to leave unqualified.** `KEY` is computed at module load (`kumoCrypto.ts:19`), and the API loads `.env`
by no explicit means — there is no `dotenv` import, no `dotenv/config` side-effect import and no
`--env-file` anywhere in `apps/api`. The hypothesis was that the key is frozen before the environment is
read, which would make it the hardcoded public default even with a correct `.env`. **I tested it and it is
not the case today:** `@prisma/client` loads `.env` as a side effect when it is first required, `index.ts:7`
requires it before the route modules are imported, and the rows decrypt with the `.env` secret (5/5) and not
with the default (0/5). It works — but it works by accident, resting on Prisma's side effect and on import
order, and it is one reordered import away from silently deriving the vault key from a constant published in
this repository. Any fix here should make the environment load explicit rather than depend on a dependency's
side effect.

---

## The rest — confirmed, with the precision the fixes need

**2 (High) — no client isolation. Confirmed, and half the machinery already exists.**
`KumoViewAll = "kumo:view_all"` is declared in `packages/shared/src/enums.ts:256` and listed in a permission
category, and **read by no route** — I grepped for `KumoViewAll` and `kumo:view_all` across the API, the web
app and shared: the only two hits are the declaration and the category listing. So the permission that exists
to express per-client visibility does nothing. This is the same defect class as `mfa:enforce`, which was
declared, granted and read by nothing until the MFA work gave it a purpose. The difference is that here the
machinery is already in place, so #2 is cheaper than it looks: wire the existing permission, don't invent one.
Note also that `KumoPassword` carries `companyId` with an index on `[companyId, category]`, so the data model
already supports the filter the routes never apply.

**3 (High) — one permission unlocks everything. Confirmed, and the contrast is the argument.**
- `POST /passwords/:id/reveal` requires `KumoPasswordsReveal` and no second factor. Confirmed.
- The rate limit is real and it is the global one: `apps/api/src/index.ts:189` is
  `app.use(rateLimiter(9999, 60 * 1000)` — 9,999 requests per minute per IP, about 166 per second. The
  contrast is what makes this a finding rather than a configuration: `routes/auth.ts:73` gives credentials
  `rateLimiter(300, 15 * 60 * 1000)` and `routes/webauthn.ts:27` gives passkeys `rateLimiter(30, 60_000)`.
  The team writes real limiters for sensitive endpoints; the vault simply never got one and falls through to
  the global. A dedicated limiter belongs on the reveal route specifically.
- **API keys can hold reveal, and this interlocks with the MFA work.** `routes/auth.ts:359` is
  `const effective = apiKeyScopes ? fresh.filter(p => apiKeyScopes.includes(p)) : fresh` — a key's
  permissions are a subset of the owner's, with no deny-list and nothing preventing `KumoPasswordsReveal`
  from being in the set. Keys are also **exempt from the MFA gate** built in the MFA change, correctly,
  because a non-interactive credential cannot answer a challenge. The result is a credential that carries the
  reveal permission, cannot be stepped up, and has no rate limit: the three findings compose into one path.
  That is a further argument that MFA step-up on reveal is the compensating control, not a nicety.

**4 (High) — sensitive fields are a flag some code honours and the write path ignores. Confirmed, currently
latent.** `isSensitive` and `encrypted` are booleans on the template field definition
(`routes/kumo.ts:66`, `:106`), and the value write paths store straight through with no encryption and no
sensitivity check (`routes/kumo.ts:182-184` and `:242-244`, assigning `valueNum` / `valueBool` /
`valueDate` / `valueJson`). Two worth noting:
- `services/seed-sample-coverage.ts:549` and `:817` **do** filter on `isSensitive`, so the flag is honoured
  by the seed generator and ignored by storage. That inconsistency is the clearest evidence this is an
  oversight rather than a deliberate design.
- **Every entry in `snapshots/kumo-template-fields.json` is `isSensitive: false`.** So the vulnerability is
  real in the code path but no current data exercises it. That makes the fix low-risk to make now, and it
  means the finding should be described as latent rather than live — worth saying precisely, because it
  changes the priority and it changes what a tester should expect to reproduce.

**5 (High) — confirmed, unlogged as well as under-permissioned.** `GET /passwords/:id/totp`
(`routes/kumo.ts:472`) requires only `KumoPasswordsView` and returns the live `code`. It writes **no access
log and no `recordKumoAudit` call** — compare the reveal route immediately above it at `:397-400`, which does
both. So the review's "this isn't logged" is exact, and the fix is to make this route look like its sibling:
reveal permission, an access log, an audit entry. One further defect in the same route: the handler ends
`catch { res.json({ enabled: false }) }`, which makes a *decryption failure* indistinguishable from *no TOTP
configured*. A tampered or unreadable secret reports as "two-factor is off", which is the wrong direction to
fail.

**6 (Medium) — confirmed.** One derived key for everything, `encryptionKeyId` written as `"v1"` at
`routes/kumo.ts:328` and never read back, so no rotation can run two keys. `services/emailConnectorCrypto.ts`
reuses the same key, which means a leak of the vault key is also a leak of every stored connector password.
The model field existing and being unused is the useful detail: the schema already anticipates key versions,
so #6 is model support plus a rotation script, not a redesign.

**7 (Medium) — confirmed, and the fix is one clause the sibling route already has.** `DELETE /passwords/:id`
(`routes/kumo.ts:371`) sets `isActive: false` and audits "Deactivated"; reveal (`:379`), the TOTP routes and
the detail route use `findUnique({ where: { id } })` with no `isActive` filter. Meanwhile the **list** route
(`:298`) already filters `where: { isActive: true }`. So the codebase agrees that deactivated rows should be
invisible, and one path forgot. That is a strong signal this is a bug and not a policy, and the fix is to
match the list route rather than to design an admin restore flow first.

**8 (Medium) — confirmed.** `GET /passwords?strength=` (`routes/kumo.ts:298-305`) selects
`encryptedPassword`, `iv`, `authTag` for up to 200 rows and decrypts every one when the filter is present,
under *view* permission, writing no access log. The route's own comment claims "the ciphertext is dropped in
both paths; strength is only scored when a strength filter is asked for, which is the one case that needs
plaintext" — the comment is accurate about *its* route and does not notice that the one case it names is
reachable by anyone with view. I did not separately verify `GET /organizations/:id` at `:922-927`, but it
shares the mechanism. The proposed fix — score strength once on write into the existing `strength` column,
then stop decrypting in list routes — is right and makes the vault match the "decrypt only on reveal" model
it already claims.

**9 (Medium) — confirmed.** `recordKumoAudit` swallows failures by design and the reveal route calls it with
`void`, so a reveal can succeed while its audit entry is lost. The access-log write *is* awaited before the
response, which is the right shape, and the review is right that reveal should fail closed: no audit entry,
no plaintext. `GET /audit/:itemType/:itemId` gated on `KumoView` is the same under-permissioning as #5.

**10 (Medium) — confirmed in shape.** Documents carry a `visibility` field that `GET /documents` and
`GET /documents/:id` never filter on, and content and revisions are stored in plain text. I did not
independently verify the route lines. The observation that technicians paste credentials into runbooks — so
documents become a second, unencrypted vault — is the reason this belongs with the vault findings rather than
as a separate document feature.

**11 (Low) — confirmed both halves, including the line.** `lib/menuActions.ts:21` writes to the clipboard and
never clears it; the 30-second timer only hides the on-screen value. And `KumoPasswords.tsx:226` is
`if (r.data?.password) await copyText(String(r.data.password), "Password")` while the API returns
`passwordPlaintext` (`routes/kumo.ts:401`), so the condition is false, the copy never happens, and it fails
silently — no error, no toast. The displayed value is read correctly at `:531`, which is what makes this
specifically a copy bug rather than a display bug.

**12 (Low) — confirmed, and it is the purest example of the pattern.** `secureClear(buf) { buf.fill(0); }`,
and every caller passes `Buffer.from(string)` — a fresh copy. JavaScript strings are immutable, so the
original plaintext is untouched and lives until garbage collection. The call zeroes a temporary that was
about to be collected anyway. The review's framing is the correct one: harmless, but it advertises a
protection that does not exist, and it must not be counted as a control in SOC 2 evidence. I would add that
it is worse than a no-op in one specific way: it sits in the reveal path, where a reader auditing Kumo looks
for exactly this, and finding it invites the conclusion that plaintext lifetime is handled.

**13 (Low) — four minor items, all plausible on the lines named.** I verified the shape of the `companyId`
point rather than each: creates go through `resolveCompanyId` while `PATCH /assets/:id` writes the body's
value, which is the inconsistency described.

---

## What I would add to the order of work

The review's order is right. Two amendments and one omission.

**Amendment — fix #1 first, but make the source visible in the same change.** The parsing fix without an
honest startup line leaves the same trap armed for the next rotation. The two belong in one commit: decode,
require exactly 32 bytes, refuse to start in production when a key was supplied but is unusable, warn loudly
rather than silently in dev, and log *which* derivation produced the key with a fingerprint. The
re-encryption is then five rows, measured, with no production data — so it is part of the same change rather
than a follow-up.

**Amendment — #7 and #8 are smaller than their severity suggests and are therefore cheap wins.** #7 is one
clause matching a sibling route. #8 is a write-time computation into a column that already exists. Neither
needs a design decision, and both remove a class of finding (under-permissioned paths that leak) rather than
an instance.

**Omission — there is no test in the list for the thing that actually broke.** The review's verification
section lists tests for the fixes. It should also add the negative test for the *original* mistake: a
production boot with `KUMO_MASTER_KEY` set to a base64 32-byte value must either use it or refuse to start —
never silently derive from `JWT_SECRET`. That test is what detects the recurrence, and it is the one test that
would have caught this.

**A note on scope.** Findings 2, 3, 4, 5, 7 and 8 share one shape: a permission, a flag or a limit that
exists in the model and is not enforced on a path. This is the same defect class as `mfa:enforce` (declared,
granted, read by nothing) and as the `SMTP_SECURE` setting that the screens reported while the mail sender
ignored it. It is worth naming as a pattern rather than fixing six times in isolation: **the enforcement
point is consistently the sibling route that got it right, not a new abstraction.**

---

## States of the findings as of this response

| # | Severity | Verdict | Note |
|---|---|---|---|
| 1 | 🔴 Critical | Confirmed by execution | Plus: the log hides the branch; the length is unvalidated; the fallback is documented, the mismatch is not. Live data confirms it — five rows, all under the `JWT_SECRET` derivation |
| 2 | 🟠 High | Confirmed | `kumo:view_all` declared and read by no route — the machinery exists |
| 3 | 🟠 High | Confirmed | 9,999/min global vs 300/15min on credentials; keys hold reveal and cannot be stepped up |
| 4 | 🟠 High | Confirmed, latent | Honoured by the seed script, ignored by storage; every seeded field is `isSensitive: false` |
| 5 | 🟠 High | Confirmed | Unlogged as well as under-permissioned; also swallows decrypt failures |
| 6 | 🟡 Medium | Confirmed | `encryptionKeyId` written `"v1"`, never read; connectors share the key |
| 7 | 🟡 Medium | Confirmed | The list route already filters `isActive`; reveal forgot |
| 8 | 🟡 Medium | Confirmed | Bulk decrypt under view; the route's own comment misses that the case is reachable |
| 9 | 🟡 Medium | Confirmed | Reveal should fail closed |
| 10 | 🟡 Medium | Confirmed in shape | Route lines not independently verified |
| 11 | 🔵 Low | Confirmed | Includes the exact line — `KumoPasswords.tsx:226` |
| 12 | 🔵 Low | Confirmed | `buf.fill(0)` on a fresh copy of an immutable string |
| 13 | 🔵 Low | Plausible, spot-checked | Four items on the lines named |

---

## The data question, answered

The review's plan waits on "a re-encryption migration". I measured it instead of asking:

**Yes — the dev database holds five real rows encrypted under the `JWT_SECRET`-derived key, and production
holds nothing because Kumo has never been deployed.** All five decrypt with the `.env` secret; none decrypts
with the public default, so the ordering hazard above is latent rather than active.

That makes finding 1 **fixable now, with a five-row migration and no change window**, and it will never be
cheaper than now — the moment a production credential exists, the same change becomes a migration with a
rollback plan. The order I would use:

1. Decode `KUMO_MASTER_KEY` as base64 **or** hex, require exactly 32 bytes, and refuse to start when a key was
   supplied but is unusable — never fall back silently.
2. Make the environment load explicit rather than relying on Prisma's side effect.
3. Log which derivation produced the key, with a fingerprint, so the branch is visible from the running system.
4. Re-encrypt the five rows, stamping a real `encryptionKeyId`, and verify by decrypting under the new key.
5. Add the negative test: a production boot with a base64 32-byte key must use it or refuse to start.

Everything else in the review's "now" list — #2, #4, #5 — carries no data consequence and can be built
independently of any of this.

## What this changes in the product's own prose

None of this is user-visible yet, and Kumo is not deployed, so no Help walkthrough or `docs/API.md` change is
triggered by the review itself. Fixes will change behaviour that Help describes, and those changes carry their
documentation in the same commit as the rule requires — in particular the reveal path (a step-up and a rate
limit are things a user will meet) and the clipboard timer.

---

## Addendum — finding 1 is fixed

Written after the response above, and left as an addendum rather than edited into it, so the reply still reads
as the reply it was.

The measurement that answered the data question turned the fix into a small one, and it was cheaper to do it
now than to schedule it: five dev rows, no production data. What landed, in BuildNotes `2026.10.10.017`:

- **`kumoCrypto.ts` accepts the documented format.** 32 bytes base64 or 64 hex characters; the decoded length
  must be exactly 32 bytes; a key that is present but unusable is **refused by name and byte count** rather
  than ignored; and production refuses to start without a usable key instead of deriving one from
  `JWT_SECRET`.
- **The startup line names the key.** `Vault key from KUMO_MASTER_KEY, fingerprint 9f47712e5adf` replaces
  `Key initialized (length:32)` — true of both derivations, so it could not tell them apart.
- **The key is resolved on first use**, so it no longer depends on `@prisma/client` happening to load `.env`
  before the route modules are imported.
- **`pnpm kumo:reencrypt`** moves the vault from the `JWT_SECRET`-derived key to the master key, dry run by
  default and idempotent; **`pnpm probe:kumo-key`** proves the resolution in eleven cases, each in its own
  process.
- **`secureClear` now carries the truth** in a comment: it zeroes a copy of an immutable string and is not a
  control. The function is unchanged, and finding 12 stands.

**Evidence.** The probe is 11 passed / 0 failed. Against the dev database the dry run found 5 values on the
legacy key and 0 unreadable; the apply moved them; a second run found 5 on the current key and 0 legacy. The
move was proved both ways — **5/5 now open with the master key, 0/5 with the old derivation** — and all five
passwords reveal as plaintext through the running API under the new key.

**Still open, and deliberately so.** Findings 2, 4 and 5 change *who may see what* — cross-client scoping,
sensitive asset fields, and the two-factor code — so they are the operator's decision rather than a patch to
apply quietly. Findings 6 and 8 through 13 are unchanged in this change; `secureClear` is the one of them this
commit touched, and only to stop it being read as a control.
