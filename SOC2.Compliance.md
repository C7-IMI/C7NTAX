# SOC2.Compliance — C7NTAX SOC 2 Readiness Plan

> Version: 2026.8.14.004 | Owner: C7NTAX engineering | Status: PLAN (no code changes yet)
> Scope: SOC 2 Type II readiness for C7NTAX as deployed to AWS.
> How to use: reference items by ID (`SC-04`, `AV-02`, …) in prompts and tickets.
> Legend: ⚠️ = change can break part or all of the application if applied without migration/staging.
>
> Review basis: current codebase state (Express + Prisma API, React SPA, Electron desktop,
> dev boot pipeline `startup/c7ntax-boot.ps1`, snapshot reseed system, PostgreSQL on Windows
> service in dev) mapped to SOC 2 Trust Services Criteria: Security, Availability,
> Confidentiality, Processing Integrity, Privacy.

---

## 0. Current state snapshot (verified)

Strengths already in place:
- RBAC with granular permissions (`Permission` enum, role editor), JWT auth, optional MFA (TOTP)
- bcrypt password hashing, helmet security headers, CORS allow-list, `sessionAuth` middleware
- AES-256 vault for Kumo passwords (`kumoCrypto.ts`), audit log middleware (`auditLog.ts`)
- `.env` gitignored; retention-policy APIs; snapshots as dev data fixtures

Top gaps (details below): dev-grade secrets/keys, permissive rate limit (9999 req/60 s),
JWT without rotation/refresh, `prisma db push --accept-data-loss` in the boot pipeline,
reseed-able audit trail (demonstrated data loss this sprint), no AWS deployment hardening yet.

---

## 1. Security (CC1.x – CC7.x)

### SC-01 — Centralize secrets in AWS Secrets Manager / SSM Parameter Store
- **Why**: SOC 2 requires controlled, rotated, audited secrets. Today `DATABASE_URL`,
  `JWT_SECRET`, `KUMO_MASTER_KEY` live in a local `.env` with dev values.
- **Functional impact**: none at runtime if loaded identically (env vars injected at ECS task
  start from Secrets Manager via AppSpec/`secrets` block).
- **Risk**: ⚠️ Low — if Secret rotation changes `JWT_SECRET` without a migration window, all
  sessions invalidate (see SC-03).

### SC-02 — Replace `kumoCrypto` fallback key chain with KMS envelope encryption
- **Why**: current code falls back `KUMO_MASTER_KEY → JWT_SECRET → hardcoded dev string`;
  a missing env silently degrades to a known key — fails CC6 confidentiality controls.
- **Functional impact**: vault features unchanged after migration; existing rows must be
  re-encrypted once under a KMS-generated DEK (one-time migration job).
- **Risk**: ⚠️ **High** — a migration error makes stored passwords unreadable. Requires
  dual-write + verify before cutover and a rollback window.

### SC-03 — JWT hardening: shorter access tokens + refresh rotation + revocation
- **Why**: 12 h stateless tokens with no revocation list is below SOC 2 expectations for
  session security (CC6.6/CC6.7).
- **Functional impact**: users re-login at least daily; add refresh-token rotation; logout
  revokes server-side (`sessionAuth.ts` already exists — extend it).
- **Risk**: ⚠️ Medium — token change breaks existing desktop/web sessions once.

### SC-04 — Login/auth rate limiting + account lockout
- **Why**: global limiter (9999/60 s) does not prevent credential stuffing (CC6.1).
- **Functional impact**: aggressive lockout can annoy users — use per-IP + per-account
  (5 fails → 15 min lock) with exponential backoff; monitor false lockouts.
- **Risk**: ⚠️ Low-Medium — mis-tuned thresholds can lock out legitimate users.

### SC-05 — Enforce MFA for all admin/system roles + SSO for staff
- **Why**: MFA exists but is optional; SOC 2 expects enforced MFA/SAML SSO for privileged
  access (CC6.2/CC6.3).
- **Functional impact**: admins must enroll TOTP (or SAML) before destructive actions;
  login flow gains an enforcement check.
- **Risk**: ⚠️ Low — first-login friction; provide grace period.

### SC-06 — Password policy & breached-password screening
- **Why**: no complexity/rotation rules visible; bcrypt alone doesn't block weak passwords.
- **Functional impact**: registration/reset forms enforce policy (12+ chars, no top-10k list).
- **Risk**: Low.

### SC-07 — TLS 1.2+ everywhere, HSTS, secure cookies
- **Why**: CC6.1 transport controls. Dev runs plain HTTP on localhost — acceptable locally,
  required in AWS.
- **Functional impact**: none (ALB/ACM terminates TLS; app unchanged); set `Secure`/`SameSite`
  cookie flags and HSTS header via helmet config.
- **Risk**: Low (prod-only).

### SC-08 — Dependency & image vulnerability scanning (npm audit, Trivy/Inspector, Dependabot)
- **Why**: CC7.1/CC7.2 — known CVEs must be patched on a defined cadence.
- **Functional impact**: none until a forced upgrade changes behavior.
- **Risk**: ⚠️ Low-Medium per dependency bump (test suite guards).

### SC-09 — SAST + secrets-in-repo scanning in CI (Semgrep, gitleaks, CodeQL)
- **Why**: CC8.1 SDLC controls; prevent secret leakage in commits (e.g., the auto-sync bot
  currently commits everything — see SC-10).
- **Functional impact**: none; may block merges until findings triaged.
- **Risk**: Low.

### SC-10 — Restrict the auto-sync/self-committing pipeline in production
- **Why**: an unattended bot committing repository state with no review violates change
  management (CC8.1). Acceptable in dev; must be disabled for prod branches.
- **Functional impact**: none at runtime.
- **Risk**: Low (dev-only tooling).

### SC-11 — Tamper-evident, append-only audit trail (CloudWatch + CloudTrail + immutable log bucket)
- **Why**: CC7.2/CC7.4 — audit events must be protected from alteration/deletion. This sprint
  demonstrated `seed-from-snapshots` **wiped days of AuditLog rows**; a reseed must never be
  able to erase compliance logs.
- **Functional impact**: none for users; audit UI may read from a separate stream.
- **Risk**: ⚠️ Medium — if the app's audit viewer is pointed at the new stream, history display
  changes (plan read-path migration).

### SC-12 — GuardRail: remove `--accept-data-loss` and reseed from production boot
- **Why**: the dev boot script force-pushes schema and reseeds sample data — catastrophic and
  non-compliant in prod (CC8.1/CC6.1 integrity).
- **Functional impact**: none in prod (dev-only pipeline); in dev it keeps working.
- **Risk**: ⚠️ **High** if someone runs the boot script against prod DB — add environment
  guard (refuse to run when `NODE_ENV=production`).

---

## 2. Availability (A1.x)

### AV-01 — RDS Multi-AZ + automated backups + PITR (KMS-encrypted)
- **Why**: A1.2/A1.3 — durability and recovery objectives; dev has no real backup beyond
  snapshot fixtures.
- **Functional impact**: none; failover adds ~60–120 s on AZ loss.
- **Risk**: ⚠️ Low — connection retry logic should tolerate failover (add pool retry).

### AV-02 — ECS Fargate service with health checks, autoscaling, and ALB in private subnets
- **Why**: A1.1/A1.2 — capacity and resilience; today dev runs long-lived node/vite processes.
- **Functional impact**: dev UX changes (no `localhost` prod); WebSocket (`/ws`) must be
  configured on ALB with sticky sessions.
- **Risk**: ⚠️ Medium — WebSocket/ALB idle-timeout misconfig breaks chat.

### AV-03 — Backup/restore runbook + quarterly restore test
- **Why**: SOC 2 requires documented and tested recovery (A1.3).
- **Functional impact**: none.
- **Risk**: Low.

### AV-04 — CloudWatch alarms + runbooks (error rate, p95 latency, DB capacity, disk)
- **Why**: A1.1 monitoring; current "self-heal poller" is dev-grade.
- **Functional impact**: none.
- **Risk**: Low.

### AV-05 — Health-check endpoint consumed by ALB target groups
- **Why**: reliable load-balancer routing; existing `/api/auth/login` poller isn't a health
  check.
- **Functional impact**: add `GET /api/health` (DB ping, no auth) — trivial.
- **Risk**: Low.

---

## 3. Confidentiality (C1.x)

### CF-01 — KMS encryption at rest: RDS storage, S3 buckets (documents/uploads), ECR images
- **Why**: C1.1/C1.2; current file storage is local disk (`storagePath`) — must move to S3.
- **Functional impact**: file upload/download paths change to S3 (pre-signed URLs).
- **Risk**: ⚠️ **High** — file-manager and kumo-file features depend on `storagePath`;
  migrate with a storage abstraction + one-time object copy.

### CF-02 — Least-privilege IAM (task roles, no long-lived access keys, SCPs)
- **Why**: C1.2/C1.3; dev uses LocalSystem Windows service (inappropriate in prod).
- **Functional impact**: none.
- **Risk**: Low.

### CF-03 — Network segmentation: private subnets, security groups, VPC endpoints, WAF on ALB
- **Why**: C1.1/C1.4 defense-in-depth.
- **Functional impact**: outbound integrations (email/SMTP, RSS feeds for Service Alerts,
  CloudConnect connectors) need NAT or endpoints.
- **Risk**: ⚠️ Medium — Service Alerts RSS monitor + CloudConnect egress breaks if egress
  is locked down without allow-listing.

### CF-04 — Data classification + PII inventory (names, emails, client data)
- **Why**: P1/P2 + C1.1; must know what's where to protect it.
- **Functional impact**: none.
- **Risk**: Low.

---

## 4. Processing Integrity (PI1.x)

### PI-01 — Versioned Prisma migrations in CI (no runtime `db push` in prod)
- **Why**: PI1.1/CC8.1 — schema changes must be reviewed and replayable.
- **Functional impact**: deploy step adds `prisma migrate deploy`.
- **Risk**: ⚠️ Medium during first migration baseline.

### PI-02 — Input validation hardening + idempotency on payment/billing writes
- **Why**: PI1.2/PI1.3 — accuracy; double-submit protection on invoices/payments.
- **Functional impact**: duplicate guards on payment endpoints.
- **Risk**: ⚠️ Low — may reject previously-allowed payloads.

### PI-03 — Remove demo reseed/wipe paths from authenticated surface (sample-data-toggle guarded)
- **Why**: production must not expose bulk deletion (CC6.1/PI1.1).
- **Functional impact**: dev-only features stay; gate behind `NODE_ENV !== production`.
- **Risk**: ⚠️ Low (guards exist; make them env-enforced).

---

## 5. Privacy (P1.x – P8.x)

### PR-01 — Retention & deletion automation from existing retention-policy APIs
- **Why**: P4/P6; policies exist in code — wire to scheduled jobs with evidence logs.
- **Functional impact**: records auto-archive/delete per policy.
- **Risk**: ⚠️ Medium — wrong policy could delete needed data; default conservative.

### PR-02 — Privacy notice, consent capture, and DSR (access/delete) tooling
- **Why**: P3/P5/P6 obligations.
- **Functional impact**: new admin screens for DSR handling.
- **Risk**: Low.

---

## 6. Organizational controls (needed for SOC 2, mostly non-code)

### OR-01 — Policy pack: security policy, access control, change management, vendor, BC/DR, data retention, privacy
- **Why**: required control documentation (CC1.x).
- **Functional impact**: none.
- **Risk**: n/a.

### OR-02 — Access reviews (quarterly), onboarding/offboarding checklists, admin role attestation
- **Why**: CC6.2/CC6.4.
- **Functional impact**: none.
- **Risk**: n/a.

### OR-03 — AWS Security Hub + GuardDuty + Config + CloudTrail org-trail enabled
- **Why**: continuous compliance evidence (CC7/CC8).
- **Functional impact**: none.
- **Risk**: Low.

### OR-04 — Incident response plan + tabletop; breach notification playbook
- **Why**: CC7.4/CC7.5.
- **Functional impact**: none.
- **Risk**: n/a.

---

## 7. Dependency-ordered sequencing (prerequisites first)

Original item names and control IDs are preserved; the revised order and
notes explain why each group must follow the previous one.

1. **SC-12 + PI-03** (prod guards against dev pipelines) — no prerequisites.
   Prevents catastrophic data loss and blocks demo wipe paths before anything
   else runs in the same environment. **Risk if skipped:** every later step
   operates next to a live wipe/reseed path; one bad boot can destroy prod data.
2. **SC-11 + SC-01** (secrets + immutable audit) — SC-11's CloudTrail/KMS-encrypted
   log bucket depends on SC-01's key/secret management being in place first.
   **Risk if SC-01 is skipped first:** audit evidence lands unencrypted or
   appendable, and later controls (SC-02, CF-01, AV-01) have no key store to use.
3. **AV-01/AV-02/AV-03/AV-05** (RDS/ECS/backups + health endpoint) — AV-01's
   KMS-encrypted RDS depends on SC-01 (key material); AV-02's ALB target groups
   depend on AV-05's health endpoint existing. **Risk if skipped:** no
   availability foundation — later encryption (CF-01 RDS part) has no cluster
   to encrypt, and CI migrations (PI-01) have no backup safety net.
4. **CF-01/CF-03** (S3 + network segmentation) — CF-01's at-rest encryption
   depends on SC-01/SC-02 KMS keys and AV-01 (the RDS/S3 resources must exist
   before they can be encrypted); CF-03's subnets/WAF depend on AV-02 (ALB/ECS
   placement). **Risk if skipped:** file data flows before encryption exists;
   network segmentation is retrofitted onto running workloads.
5. **SC-02..SC-07** (auth/crypto hardening) — SC-02 depends on SC-01 (KMS key
   store); SC-03 depends on PLAN-001 session/MFA architecture; SC-05 (MFA/SSO
   enforcement) depends on SC-03 (token/refresh infra). **Risk if skipped:**
   real client accounts are onboarded on weak auth; crypto changes later
   require key migrations on live data.
6. **PI-01/PI-02, PR-01/PR-02, OR-xx** (complete control set) — PI-01 (versioned
   migrations) depends on AV-01 (backups/PITR as safety net); PR-01 (retention/
   deletion) depends on CF-01 (encrypted storage for the data it deletes);
   OR-03 (Security Hub/GuardDuty/Config/CloudTrail) depends on SC-11 (the audit
   trail it monitors). OR-01 (policy pack) has **no code dependencies** and may
   start in parallel with step 1. **Risk if skipped:** the audit window is
   incomplete and dependent controls have nothing to operate on.

---

## 8. Open items / decisions needed

- Target SOC 2 date and Type I vs Type II
- Whether the Electron desktop app is in scope (it is a distribution channel → include in
  CC8 change management and update-signing controls)
- AWS account strategy: dedicated prod account in an AWS Organization with SCPs
- Pen-test vendor and audit firm selection

*End of plan — items are numbered for reference in prompts: "Implement SC-01 and SC-11".*
