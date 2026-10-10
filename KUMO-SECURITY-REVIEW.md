# Kumo Security Review

**Date:** 2026-10-10
**Scope:** Kumo, the IT documentation and password vault (the IT Glue equivalent). Covers the API
(`apps/api/src/routes/kumo.ts`), encryption (`apps/api/src/services/kumoCrypto.ts`), the audit trail
(`kumoAudit.ts`, `middleware/auditLog.ts`), authentication and permissions (`middleware/auth.ts`,
`packages/shared/src/enums.ts`), the vault page (`apps/web/src/pages/KumoPasswords.tsx`), and the Azure
deployment of the vault key (`infra/`).
**Method:** I read the code by hand and checked some findings directly: I ran the key-derivation logic
against the documented key format, and I tried to decrypt the committed vault snapshot with the public
default key. I did not run a penetration test against a live deployment.

---

## Summary

Kumo uses sound building blocks: AES-256-GCM, a reveal step, an access log, an audit trail, and secrets
redacted from the request audit log. But it is **not yet safe to hold every client's credentials in
production.** Four problems matter most:

1. **The production vault key is probably not being used.** The deployment docs say `KUMO_MASTER_KEY`
   should be a base64 value (44 characters). The code only accepts a hex value of at least 64 characters.
   Anything else is **silently ignored**, and the vault key is then derived from `JWT_SECRET`. No warning
   is logged.
2. **There is no separation between clients.** Anyone with the vault permission can list and reveal
   every client's passwords. The `kumo:view_all` permission exists but nothing checks it.
3. **One permission unlocks everything.** Revealing a password needs no MFA step-up, no reason, no
   per-password access list and no rate limit. A stolen admin session or API key can read the whole
   vault in seconds.
4. **Fields marked "encrypted" or "sensitive" on asset templates are stored and returned in plain
   text.**

| # | Severity | Finding |
|---|---|---|
| 1 | 🔴 Critical | `KUMO_MASTER_KEY` format mismatch: the vault silently falls back to a key derived from `JWT_SECRET` |
| 2 | 🟠 High | No client isolation on any Kumo endpoint |
| 3 | 🟠 High | Reveal has no step-up, no per-password access control, and no rate limit |
| 4 | 🟠 High | Asset fields marked `encrypted` / `isSensitive` are stored and served in plain text |
| 5 | 🟠 High | A live TOTP (2FA) code can be read with *view* permission, without the reveal permission and without being logged |
| 6 | 🟡 Medium | One key covers every password, client, TOTP secret and email-connector password; there is no rotation |
| 7 | 🟡 Medium | Deleted (deactivated) passwords can still be revealed |
| 8 | 🟡 Medium | Users with view-only access trigger bulk server-side decryption, and the results leak password strength |
| 9 | 🟡 Medium | Audit writes for reveal and TOTP are best-effort or missing |
| 10 | 🟡 Medium | Kumo documents ignore `visibility` and store their content in plain text |
| 11 | 🔵 Low | The clipboard is never cleared, and "Reveal and copy" copies nothing |
| 12 | 🔵 Low | `secureClear` does nothing |
| 13 | 🔵 Low | Minor issues: GCM IV length, unchecked `companyId`, access logs readable with view permission |

---

## Findings

### 1. 🔴 `KUMO_MASTER_KEY` format mismatch: the vault silently uses a key derived from `JWT_SECRET`

`apps/api/src/services/kumoCrypto.ts:7-16`

```ts
const envKey = process.env.KUMO_MASTER_KEY;
if (envKey && envKey.length >= 64) {
  return Buffer.from(envKey, "hex").slice(0, 32);
}
const base = process.env.JWT_SECRET || "C7NTAX-dev-secret-change-in-prod";
return createHash("sha256").update("kumo-vault:" + base).digest();
```

The deployment path tells operators to supply a **base64** key:

- `infra/params/prod.bicepparam:9` and `dev.bicepparam:16`: `KUMO_MASTER_KEY_VALUE = '<32 random bytes, base64>'`
- `infra/env/.env.production.example:43`: `KUMO_MASTER_KEY=<base64-32-bytes>`
- `infra/main.bicep:149` only requires `@minLength(32)`

32 random bytes in base64 is **44 characters**, which fails the `>= 64` check. I confirmed this by running
the check. The code then falls through to `sha256("kumo-vault:" + JWT_SECRET)`. The startup warning
(`apps/api/src/index.ts:100`) only fires when the variable is *unset*. A base64 key is set, so nothing is
logged.

**Impact**

- The master key stored in Azure Key Vault gives no protection. The real vault key is whatever
  `JWT_SECRET` is. That value sits on every API replica and is the secret most likely to leak or be
  shared.
- Anyone who gets `JWT_SECRET` can both forge sessions and decrypt every stored client password.
- Rotating `JWT_SECRET` after an incident (a normal response) would **make every stored password
  undecryptable**.
- If someone supplies a non-hex value of 64+ characters, `Buffer.from(…, "hex")` stops silently at the
  first invalid character, which produces a short key.

**Fix**

- Parse the key explicitly as base64 or hex, require exactly 32 bytes, and **refuse to start** in
  production when it is missing or invalid. Remove the `JWT_SECRET` fallback outside development.
- **Do not change the parsing on its own.** Any vault already deployed is encrypted under the
  JWT-derived key. Add a one-time re-encryption migration that decrypts with the old derived key and
  re-encrypts with the real master key, and record which key each row uses (see #6). Then remove the
  fallback.
- Add a boot self-test that logs which key source was used: the source, never the key.

### 2. 🟠 No client isolation on any Kumo endpoint

None of the routes in `apps/api/src/routes/kumo.ts` use `companyWhere` or `canAccessCompany`
(`middleware/companyScope.ts`), which other routers already use.

- `GET /kumo/passwords` (`kumo.ts:283`) returns active passwords for **all** clients.
- `POST /kumo/passwords/:id/reveal` (`kumo.ts:377`) decrypts **any** id.
- The same applies to assets, documents, configs, files, links, domains and `/organizations/:id`.
- `Permission.KumoViewAll` (`enums.ts:239`) is defined and granted, but nothing in the API checks it.

The default roles only give Kumo to Super Admin, Developer Admin and Admin. Today's practical effect is
that every admin can read every client's vault, and **any custom role** given `kumo:passwords:reveal`
gets every client at once. If a client-scoped account (one with a `companyId`, such as Client Admin) is
ever given Kumo access, it can read other clients' credentials.

**Fix:** Apply `companyWhere(req.user)` to every list and count, and `canAccessCompany` (answering 404)
to every detail, reveal, edit and TOTP route. Then make `kumo:view_all` the switch between "my assigned
clients" and "all clients" for internal staff.

### 3. 🟠 Reveal has no step-up, no per-password access control and no rate limit

- One role permission (`kumo:passwords:reveal`) unlocks every password. There is no per-password or
  per-folder access list and no "sensitive" flag. PLAN-015 phases 6 and 8 are not implemented.
- There is no recent-MFA or re-authentication check before a reveal, and no reason is captured. I found
  no MFA requirement tied to vault access.
- The global limiter is `rateLimiter(9999, 60_000)` (`index.ts:189`), which is effectively no limit.
  The reveal route has no throttle of its own.
- API keys can be given any permission, including reveal (`services/apiKeys.ts:318`), so a long-lived
  machine credential can export the vault.
- Bearer tokens last 12 hours unless `AUTH_HARDENING_ENABLED=true`.

A stolen session, a stolen API key, or a malicious insider can script `GET /passwords` followed by a
`POST /reveal` for each id and empty the vault in seconds. The access log records it, but nothing raises
an alert.

**Fix:** Require recent MFA, within the last 5–15 minutes, for reveal and TOTP. Add a per-user reveal
rate limit (for example, 20 per 10 minutes) with an admin alert when it trips. Block or separately gate
`kumo:passwords:reveal` on API keys. Add per-password access lists and sensitive-password notifications
(PLAN-015 phases 6 and 8).

### 4. 🟠 Asset fields marked `encrypted` / `isSensitive` are stored and served in plain text

Template fields carry `isSensitive` and `encrypted` flags (`kumo.ts:66`, `kumo.ts:106`;
`schema.prisma:1664-1665`), but the asset create and update paths write every text value with
`fv.valueText = String(val)` (`kumo.ts:186`, `kumo.ts:246`). They never call `encrypt`. The **list**
endpoint (`kumo.ts:153-157`) then returns every field value to anyone with `kumo:asset:view`, which is a
lower permission than password reveal.

Someone who builds a template with an "Admin password" or "Wi-Fi key" field marked encrypted will believe
it is protected. It sits in plain text in the database, in backups, in snapshots, and in bulk API
responses.

**Fix:** Encrypt values of `encrypted` fields with the vault crypto. Leave `isSensitive` / `encrypted`
values out of list responses, and serve them only through a reveal-style endpoint that is logged and
needs the reveal permission. Until then, remove the `encrypted` option or label it "not encrypted" so it
cannot mislead.

### 5. 🟠 A live TOTP (2FA) code can be read with *view* permission

`GET /kumo/passwords/:id/totp` (`kumo.ts:472`) needs only `KumoPasswordsView`. It decrypts the TOTP
secret and returns the **current code**, and it writes no access-log or audit entry. A user who is not
trusted to reveal a password can still get its second factor, without leaving a trace.

Related problems:

- `totp/setup` (`kumo.ts:439`) and `totp/manual` (`kumo.ts:493`) return the secret or code and are not
  audited.
- `DELETE /totp` (`kumo.ts:486`) removes 2FA without an audit entry.

**Fix:** Gate the TOTP code on `KumoPasswordsReveal`, apply the same client scoping and MFA step-up, and
log `totp_view`, `totp_setup` and `totp_remove` to both the access log and the Kumo audit trail.

### 6. 🟡 One key for everything, and no rotation

The same AES key encrypts every password, every client, every TOTP secret, and the email-connector
passwords (`services/emailConnectorCrypto.ts:6` reuses `kumoCrypto`). `encryptionKeyId` is always written
as `"v1"` (`kumo.ts:328`) and never read back, so the system has no way to run two keys during a rotation.
If the one key leaks, every client is exposed at once. That is exactly the case IT Glue's per-password
keys wrapped by RSA are designed to contain.

**Fix:** Implement PLAN-015 phases 1–2: a separate data key per password, wrapped by a key-encryption key
held in Key Vault or a managed HSM key (ideally one per client), a key version actually stored on each
row, and a rotation script. Use a separate key, or a separately derived subkey, for email connectors.

### 7. 🟡 Deleted passwords can still be revealed

`DELETE /passwords/:id` only sets `isActive = false` (`kumo.ts:371`). The reveal route (`kumo.ts:379`)
and the TOTP routes do not check `isActive`. A credential an admin believes is removed stays readable by
id for as long as the row exists, and nothing ever purges it.

**Fix:** Refuse reveal and TOTP on inactive rows, except through an explicit admin "restore" flow. Add a
retention job that hard-deletes or crypto-shreds deactivated secrets after a set period.

### 8. 🟡 View-only users trigger bulk decryption and learn password strength

`GET /passwords?strength=…` (`kumo.ts:298-305`) and `GET /organizations/:id` (`kumo.ts:922-927`)
decrypt **every** password on the server to score its strength. They need only *view* permission and
write no access log. Two consequences:

- Users who may not reveal passwords can still find out which credentials are weak, which is useful for
  targeting.
- Every page load decrypts the whole vault in memory, which goes against the stated "decrypt only on
  reveal" model.

**Fix:** Score strength once, when a password is created or updated, while the plaintext is already in
hand, and store the bucket in the existing `strength` column. Then stop decrypting in list and dashboard
routes.

### 9. 🟡 Audit writes are best-effort or missing

- `recordKumoAudit` swallows failures by design (`kumoAudit.ts:30-43`), and the reveal route calls it
  with `void` (`kumo.ts:400`). The access-log write before the response *is* awaited, which is good, but
  for a vault the reveal should **fail closed**: if the reveal cannot be recorded, don't return the
  plaintext.
- TOTP view, setup and removal are not audited (see #5).
- `GET /audit/:itemType/:itemId` (`kumo.ts:424`) only checks `KumoView`, not the item's own permission
  or client.

### 10. 🟡 Kumo documents: no visibility enforcement, and content stored in plain text

Documents store a `visibility` field (`kumo.ts:607`), but `GET /documents` and `GET /documents/:id`
(`kumo.ts:579-599`) never filter by it, and they have no client scoping. Document content and every
revision are stored in plain text. In practice technicians paste credentials into runbooks, so documents
become a second, unencrypted vault.

**Fix:** Enforce visibility and client scoping. Consider a secret scanner on document save that suggests
moving detected credentials into the vault.

### 11. 🔵 The clipboard is never cleared, and "Reveal and copy" copies nothing

- `copyText` (`apps/web/src/lib/menuActions.ts:21`) writes to the clipboard and never clears it. The
  30-second timer only hides the on-screen value. A password copied from the vault stays in the OS
  clipboard and clipboard-history tools indefinitely.
- The right-click "Reveal and copy password" action copies `r.data?.password`
  (`KumoPasswords.tsx:226`), but the API returns `passwordPlaintext`, so nothing is copied. This is a
  functional bug, not a leak, but users will fall back to selecting the text by hand.

**Fix:** Copy `passwordPlaintext`. After about 30 seconds, overwrite the clipboard if it still holds
the copied value.

### 12. 🔵 `secureClear` does nothing

`setImmediate(() => secureClear(Buffer.from(plaintext)))` (`kumo.ts:403`) zeroes a **new copy** of the
string. JavaScript strings are immutable, so the original plaintext stays in memory until garbage
collection. It's harmless, but it suggests a protection that does not exist. Remove it or document it
honestly, and don't count it as a control in SOC 2 evidence.

### 13. 🔵 Minor issues

- **GCM IV length.** The IV is 16 random bytes (`kumoCrypto.ts:22`). GCM's standard and most-analysed
  length is 12 bytes. 16 works, but use 12 for new ciphertext.
- **Unchecked `companyId`.** `PATCH /assets/:id` writes the `companyId` from the request body without
  checking it (`kumo.ts:232`). Creates go through `resolveCompanyId`; updates should too.
- **Access logs readable with view permission.** `GET /passwords/:id/access-logs` (`kumo.ts:408`)
  shows other staff members' IP addresses and user agents to anyone with view permission.
- **Unchecked file metadata.** `/files/upload` (`kumo.ts:666`) accepts `storagePath` and `companyId`
  from the client without checking them. It is metadata only today, so harmless for now, but it will
  matter once real storage is attached.

---

## What is already done well

- **AES-256-GCM** (authenticated encryption) with a random IV for each value. Tampered ciphertext fails
  to decrypt.
- Ciphertext, IV and auth tag are **removed from every list and detail response**. Plaintext is only
  returned by `reveal`.
- **Each reveal writes an access log** (user, IP, user agent) and a Kumo audit entry, and edits record
  *which* fields changed without their values (`kumoAudit.ts:68-84`).
- The request audit middleware **redacts** keys containing `password`, `secret`, `authtag`, `iv` and
  similar (`auditLog.ts:37-63`).
- Production **refuses to start** with the public default `JWT_SECRET` (`index.ts:92`), and the
  test-login bypass is refused in production.
- Infra keeps the master key in **Azure Key Vault**, read through a managed identity, with the vault's
  public endpoint closed in production.
- The committed vault snapshot (`apps/api/src/snapshots/kumo-passwords.json`) is sample data. I
  confirmed it **cannot** be decrypted with the public default key.
- PLAN-015 already describes the right target design. The gap is implementation, not intent.

---

## Recommended order of work

1. **Now, before trusting production with real client credentials:** fix the key parsing, with a
   re-encryption migration and a fail-closed boot (#1). Add client scoping across `kumo.ts` (#2). Gate
   TOTP codes on reveal permission (#5). Stop serving "encrypted" asset fields in plain text (#4).
2. **Next:** MFA step-up and a rate limit on reveal, plus an alert when it trips, and keep reveal off API
   keys (#3). Block reveal of inactive rows (#7). Make reveal auditing fail closed (#9). Store strength
   instead of decrypting to compute it (#8).
3. **Then:** PLAN-015 phases 1–2 (per-password keys, key versions, rotation; #6), per-password access
   lists and sensitive-password alerts, document visibility and scoping (#10), and clipboard hygiene
   (#11).
4. **Verification:** add tests for each fix. Cross-client reveal must return 404. A base64 master key
   must be used, not silently replaced. A tampered auth tag must fail. Reveal of an inactive row must be
   refused. A TOTP code must need reveal permission.
