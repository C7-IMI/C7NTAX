# Kumo Vault Security & Encryption Upgrade — Implementation Plan (PLAN-015)

> Reference: IT Glue Security Whitepaper (itglue.com/resources/itglue-security) and Kaseya "About password security and encryption" (help.itglue.kaseya.com). Goal: bring C7NTAX Kumo password/encryption practices to IT Glue parity, with particular focus on Kumo (password vault, TOTP secrets, documents).

## 1. Goal

Upgrade C7NTAX Kumo from a single master-key vault to an IT Glue-style layered encryption architecture: per-password data keys wrapped by an RSA key-encryption key whose private key is passphrase-protected and stored outside the database; an optional host-proof (client-side-only) vault mode; immutable password versioning with rollback; reveal lifecycle hardening; granular password access control; sensitive-password access workflows; and an at-risk password report. Decrypted password data must never be written to disk or logs.

## 2. Reference architecture (IT Glue model)

- AES-256(-GCM) per password with a **unique key per encrypted password**.
- RSA-2048 wraps each AES key; the RSA keypair is itself encrypted with a **passphrase** and stored in an **isolated key store** that only the app servers can read for decryption.
- Private keys **never stored in the database**; decryption is server-side for standard passwords.
- **Host-proof vault**: for vault-mode passwords, decryption happens **only in the user's browser** under a user-specific passphrase; the server (and IT Glue/the vendor) can never decrypt; administrators can share vault access by handing users a copy of the vault key.
- Decrypted passwords never written to disk; revealed passwords visible only briefly; every reveal writes an audit entry; password changes are version-controlled, immutable, and rollback-able; strong random generator (32-char default); MFA/SSO enforcement; IP access control; SOC 2 program.

## 3. Current state (verified)

- `apps/api/src/services/kumoCrypto.ts`: AES-256-GCM with **one master key** (`KUMO_MASTER_KEY` env, else SHA-256 derived from `JWT_SECRET`) shared by all passwords and TOTP secrets. No per-password keys, no RSA wrapping, no key store.
- Reveal endpoint exists (`POST /kumo/passwords/:id/reveal`) with an access-log write (`kumoPasswordAccessLog`: reveal / totp_verify, IP, user agent, success). TOTP secrets stored encrypted (base32) and verified via speakeasy.
- No password change versioning/rollback (documents have `kumoDocumentRevision`, passwords do not).
- No reveal TTL / auto-hide / auto-clear; revealed plaintext persists in the modal until closed.
- No per-password or per-folder ACLs (role permissions only: `KumoPasswordsView/Reveal/Manage`).
- Password generator exists (`apps/web/src/lib/generatePassword.ts`) — default length/policy to verify; no strength meter.
- No sensitive-password workflow notifications; no at-risk/offboarding password report.

## 4. Dependency-ordered implementation phases (prerequisites first)

| # | Phase | Depends on | Risk if prerequisite is skipped |
|---|---|---|---|
| 1 | **Key hierarchy & per-password data keys:** refactor `kumoCrypto.ts` — each `kumoPassword`/TOTP secret gets a unique AES-256-GCM **data key (DEK)**; generate an org-level **RSA-2048 keypair (KEK)** via new `scripts/kumo-keys.mjs`; wrap each DEK with the RSA public key and store the wrapped DEK in the DB; encrypt the RSA private key with a passphrase and store it **outside the DB** (`secrets/kumo-kek.private.pem`, path via `KUMO_KEK_PRIVATE_PATH` + `KUMO_KEK_PASSPHRASE` env; gitignored). One-time migration re-encrypts existing ciphertexts under the new scheme (background, idempotent, rollback-able via legacy-key window). Schema: add `wrappedKey`/`keyVersion` columns (or parallel table). **Peer-review gate:** if the tenancy model ends up multi-tenant (PLAN-010 §13.7, PLAN-003 Step 0), use **per-tenant KEKs/CMKs** (key separation so one leaked key does not expose all tenants) — decide tenancy BEFORE this migration runs. | — (foundation) | All later phases (versioning, ACLs, vault, rotation) have no key hierarchy to build on; single-master-key breach exposes every password; a late tenancy decision forces a re-migration of every wrapped DEK. |
| 2 | **Key rotation tooling:** `scripts/kumo-rotate-keys.mjs` — per-password DEK rotation and org KEK rotation (re-wrap all DEKs); rotation records written to `kumoPasswordAccessLog` (`key_rotate`) and audit log; rotation window supports both old and new KEKs during migration. | 1 | Key compromise has no remediation path; SOC 2 evidence for key rotation missing. |
| 3 | **Decrypted-data hygiene:** never log/`console` decrypted values; redact `password`/`secret`/`totp` fields from morgan/request logging; keep `secureClear()` on all plaintext buffers; reveal responses excluded from error snapshots; automated tamper tests (modified authTag must fail closed). | 1 | Plaintext leaks into boot/dev logs; violates the "never written to disk" requirement. |
| 4 | **Password change versioning & rollback:** `kumoPasswordVersion` model — immutable history per password (ciphertext parts, wrapped-key ref, `changedById`, `changedAt`, `changeReason`); update/create routes append history; `POST /kumo/passwords/:id/rollback/:versionId` restores a prior version (recorded as a new version). UI: version history dialog + Restore in **Kumo → Passwords**. | 1 | Password overwrites are destructive; no audit-able change history (IT Glue: version-controlled + rollback). |
| 5 | **Reveal lifecycle hardening:** reveal TTL (default 60s, `KUMO_REVEAL_TTL_SECONDS`), auto-hide countdown + copy-to-clipboard with auto-clear in **Kumo → Passwords** modal; extend access log with `reason`/context and log **denied** ACL attempts too; reveal audit visible on the password detail. | 1 | Revealed secrets linger on screen/screen-capture; denied-access attempts invisible. |
| 6 | **Granular password access control:** `kumoPasswordAccess` ACL (password↔user with view/reveal/edit grants; folder-scoped ACL inheritance on Kumo folders); enforcement in list/reveal/update/document routes; ACL manager UI in **Kumo → Passwords** and **Administration → Security**. | 1, 4 | Role-level permissions only — cannot restrict one password to a subset of users (IT Glue: granular user/group access). |
| 7 | **Host-proof vault mode (client-side-only encryption):** optional per-password `vault` mode — WebCrypto AES-256-GCM key derived from a **user passphrase** (argon2id) in the browser; server stores only the encrypted blob and can never decrypt; vault sharing between users via admin-granted key copy (IT Glue Vault model); lost passphrase = unrecoverable (documented in UI + docs). Requires CSP/passphrase entry flow in **Kumo → Passwords**. | 1, 6 | Sensitive secrets remain decryptable server-side even for highest-risk items; no zero-knowledge option for clients who require it. |
| 8 | **Password Access Workflow (sensitive passwords):** `isSensitive` flag on `kumoPassword`; revealing a sensitive password triggers immediate admin notification (in-app + email via existing mailer, env-gated) with actor/date/asset; admin enable + notification targets in **Administration → Security**. | 5 | Admins learn of sensitive-password access only after the fact (IT Glue: triggered notifications). |
| 9 | **At-Risk Password Report:** offboarding report — for a user, all passwords they had access to (ACL + access log), exportable CSV, on **Reports** page; admin-only permission. | 5, 6 | Manual password rotation audits on offboarding; credential residue risk. |
| 10 | **Password generator & policy:** 32-char default generator (IT Glue parity); options length/symbols/ambiguous chars; strength meter in create/edit dialogs; enforce minimum length/policy server-side on create/update; policy defaults in **Administration → Security**. | — (independent; can run parallel) | Weak generated passwords undermine all encryption phases. |
| 11 | **Snapshot, reseed & verification:** add new models to `snapshot-capture.ts` TABLES + `seed-from-snapshots.ts` SEED_ORDER (exclude secret-bearing columns — wrapped keys may be captured, plaintext never); `verify-post-change.ts` gains Kumo crypto round-trip + tamper checks; typecheck baselines updated; BuildNotes + Retrace entries per changelog policy. | 1–10 | Reseed loses or corrupts vault data; regressions undetected. |

## 5. Rollback plan

- All phases additive (new columns/tables/scripts). Phases 1–2 keep a **legacy-key compatibility window**: the migration retains the old master-key decrypt path until the re-encryption job reports 100% and the flag `KUMO_LEGACY_KEY_FALLBACK` is removed in a later release.
- `kumoPasswordVersion` rollback is inherent to phase 4. KEK private key backup: export passphrase-encrypted backup via `scripts/kumo-keys.mjs export-backup` before any rotation.
- Feature flags: `KUMO_VAULT_MODE`, `KUMO_ACCESS_WORKFLOW`, `KUMO_REVEAL_TTL_SECONDS` — per-phase kill switches.

## 6. Verification plan

- Crypto unit tests: round-trip, tampered ciphertext/authTag fails closed, per-password key isolation (decrypting one password cannot decrypt another), KEK wrap/unwrap, rotation re-wrap, vault-mode blob decrypts only with the user passphrase.
- API typecheck baseline tracked (changed files clean); web typecheck; boot pipeline + `verify-post-change` green after every phase.
- Manual checks: reveal TTL auto-hides; sensitive-password reveal emails admin; rollback restores prior value and logs the event; at-risk report lists expected passwords; reseed round-trip preserves all vault rows.

## 7. Open decisions to confirm before implementation

1. KEK scope: single org-level KEK vs per-tenant KEK once the **tenancy model is decided** (PLAN-010 §13.7 / PLAN-003 Step 0 gate). Peer review: if this is multi-tenant SaaS, per-tenant key separation is required — **lock the tenancy decision before the phase-1 (SC-02-style) migration**.
2. Key store location: local `secrets/` file vs AWS KMS once PLAN-010 lands (recommend file now with KMS as provider behind the same interface — enables per-tenant CMKs and aligns with PLAN-010 §11.8).
3. Vault-mode key derivation: argon2id in browser (WebCrypto PBKDF2 lacks argon2) — accept slower PBKDF2 or bundle argon2-wasm? (recommend argon2-wasm with PBKDF2 fallback).
4. Reveal TTL default: 60s vs 30s.
5. Access-workflow notification channel: in-app + email both, or configurable per admin.
