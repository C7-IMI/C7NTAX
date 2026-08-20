# AWS Dev/Prod Split & Sync Plan

**Plan Label:** AWS Dev/Prod Split & Sync Plan
**Status:** Proposed (plan only — no implementation yet)
**Date:** 2026-08-18

---

## 1. Goal

Split the current setup into two AWS environments:

- **Dev** — the existing environment where all future changes are made.
- **Prod** — a new production server running **alongside dev on a different
  port**, so production can be verified by refreshing the browser after pushing
  changes.

**Sync semantics (agent-layer rule, enforced on every future message):**

- A message that is **only a sync command — no other text** — triggers syncing
  all changes, updates, features, and code from dev to production.
- A sync command is any message consisting solely of a trigger phrase,
  optionally followed by target wording: e.g. "Push to Prod", "Go Live",
  "Push to production server", "Go Live on Prod", and variants with the same
  intent.
- If the trigger phrase is part of a longer natural-language sentence, or the
  message explicitly negates or overrides syncing ("do not push to
  production"), treat it as a **normal request — do not sync**.
- All other messages: work on the dev server and carry out the requested task
  without initiating any sync.

## 2. Environment assumptions

- Both environments live in AWS.
- The current local dev environment can push changes to **both** the AWS dev
  and AWS production servers (via AWS CLI / deploy tooling — see §6).

## 3. Current state (verified)

- Local stack: PostgreSQL service `postgresql-c7ntax`, API Express+tsx on
  `:4000`, Vite web on `:3010`; boot pipeline `startup/c7ntax-boot.ps1`
  (prisma skip-if-unchanged, snapshot reseed via `seed-from-snapshots.ts` +
  `seed-service-alerts.ts`), JWT 12h tokens, gzip middleware, service-alert
  monitor (5-min), snapshot poller, PlanDocs registry.
- AWS guidance already exists in PLAN-007 (`SOC2.Compliance.md`): RDS Multi-AZ,
  ECS Fargate + ALB, KMS envelope encryption, Secrets Manager, WAF, CloudTrail,
  prod guards against `--accept-data-loss`/reseed.

## 4. Proposed architecture

```
Local dev (Win) ──deploy.sh / AWS CLI──▶ AWS (VPC)
                                        ├─ ECR (app images, per-env tags)
                                        ├─ CloudFront distribution — SPA edge cache, AWS Shield Standard,
                                        │     WAF attach point (peer review: WAF is L7 rules, not DDoS)
                                        │          └─► ALB (API/SPA origins)
                                        ├─ ECS Fargate service "c7ntax-dev"  ─┐
                                        ├─ ECS Fargate service "c7ntax-prod" ─┤ ALB
                                        │    ├─ listener :3010 → dev target  ─┘  (two listener ports)
                                        │    └─ listener :3011 → prod target
                                        ├─ RDS PostgreSQL "c7ntax-dev"  (small, Single-AZ)
                                        ├─ RDS PostgreSQL "c7ntax-prod" (Multi-AZ + PITR, private subnet)
                                        ├─ S3 — static/backup/log buckets (SSE-KMS baseline; vault data relies on
                                        │     PLAN-015 envelope encryption — bucket SSE alone is not the control)
                                        ├─ CloudTrail + CloudWatch → tamper-evident log bucket
                                        │     (S3 Object Lock compliance mode or dedicated log account)
                                        └─ Secrets Manager (DATABASE_URL, JWT_SECRET, INFERENCE_*, per env)
```

- **One codebase, one image** (`NODE_ENV`/env-var driven). Dev and prod run the
  same container with different environment configuration. Prod verification =
  open the ALB prod port in the browser and refresh.
- **Ports:** dev `3010`, prod `3011` on the same ALB (final choice in §13).
- **Databases:** two separate RDS instances (dev never touches prod data;
  prod keeps Multi-AZ + automated backups + PITR per PLAN-007 AV-01). Schema
  moves dev→prod via `prisma migrate deploy`; sample data via the defined
  snapshot seed process.
- **CI/CD:** GitHub Actions / Forgejo pipeline: on push → build image → ECR →
  deploy **dev** automatically. **Prod deploys only via the sync command.**
- **LLM / inference (custom, containerized):** the API's inference path already
  targets OpenAI-compatible endpoints (`INFERENCE_MODEL` override exists).
  Plan: containerize inference with **vLLM** (GPU) or **Hugging Face TGI** in
  its own ECS task (autoscaling on queue depth), or use **AWS Bedrock** as the
  managed option; wire via new env vars `INFERENCE_BASE_URL` /
  `INFERENCE_API_KEY` / `INFERENCE_MODEL` per environment (Secrets Manager).
  Dev keeps the current provider; prod points at the containerized/Bedrock
  endpoint. Guardrails: per-tenant token budgets, rate limits, PII redaction
  before prompts.
- **Security:** Secrets Manager + KMS for all secrets; per-env `JWT_SECRET`;
  IAM least-privilege (deploy role scoped to ECS/ECR/RDS only); prod RDS in a
  private subnet (no public access); security groups per service; **CloudFront
  + AWS Shield Standard in front of the ALB (edge caching for the SPA; WAF is
  L7 rules/rate limiting, NOT volumetric DDoS protection)**; AWS WAF attached at
  CloudFront/ALB; TLS 1.2+; CloudTrail + CloudWatch logs to a **tamper-evident
  bucket (S3 Object Lock compliance mode or dedicated log account)**; admin
  access via **SSM Session Manager only — no bastion hosts, no inbound SSH**;
  vault data protection = **SC-02/PLAN-015 envelope encryption (per-record/
  per-tenant DEKs wrapped by a KMS CMK)** — S3 SSE-KMS alone is insufficient;
  prod guards from PLAN-007 SC-12/PI-03 (no `--accept-data-loss`, no demo
  reseed endpoints in prod).

## 5. Sync pipeline (dev → prod), run only on a valid sync command

1. **Pre-flight on dev:** `verify-post-change.ts` + boot health checks green.
2. **Code sync:** build the tagged image (ECR) from the current dev tree.
3. **Schema sync:** `prisma migrate deploy` against prod RDS (migrations only —
   never `db push --accept-data-loss` in prod).
4. **Data sync (optional flag):** snapshot-based reseed of sample data into
   prod using the defined process (`seed-from-snapshots.ts` +
   `seed-service-alerts.ts`); skipped when the sync command doesn't ask for
   data.
5. **Deploy:** `aws ecs update-service --force-new-deployment` on
   `c7ntax-prod` (blue/green if configured).
6. **Verify:** health + login + frontend HTTP 200 on the **prod port**; record
   the result.
7. **Log:** BuildNotes entry + Retrace prompt entry + audit trail (per the
   mandatory changelog policy).

The sync-command classifier runs **before** any other processing: only a
standalone trigger phrase (optionally + target wording) enters the pipeline;
negated/longer messages proceed as normal dev work.

## 6. Local → AWS push tooling

- `scripts/aws/deploy-env.sh <dev|prod>` (or `deploy.sh` wrapper): reads env
  config, tags image, calls ECS force-deployment, waits for
  `services-stable`, prints health result.
- Local machine: AWS CLI v2 + profile `c7ntax-deploy` with an IAM role limited
  to `ecr:PutImage`, `ecs:UpdateService`, `ecs:DescribeServices`,
  `secretsmanager:GetSecretValue` (dev + prod scoped).
- Both environments reachable from local; prod verification is a browser
  refresh against the prod ALB port.

## 7. Implementation phases (dependency-ordered — prerequisites first)

| # | Item | Depends on | Risk if prerequisite is skipped |
|---|---|---|---|
| 1 | **Base infrastructure (IaC):** Terraform/CDK — VPC, public/private subnets, NAT, security groups | — (no prerequisites) | Everything below fails; no VPC = no resources. |
| 2 | **Databases:** RDS `c7ntax-dev` (Single-AZ) + `c7ntax-prod` (Multi-AZ + backups + PITR), Secrets Manager entries (`DATABASE_URL` per env) | #1 | Apps can't boot (no DB), and schema/seed phases (#6) have nowhere to apply. |
| 3 | **Registry & CI:** ECR repository + CI workflow (build image, push, deploy dev automatically) | #1, #2 (env vars for build args) | No image → nothing deployable; manual builds invite drift. |
| 4 | **Compute:** ECS Fargate services `c7ntax-dev` + `c7ntax-prod`, ALB with two listeners (dev `:3010`, prod `:3011`), task definitions per env | #1–#3 | Port-based prod verification is impossible; prod has no runtime to verify. |
| 5 | **Local push tooling:** `scripts/aws/deploy-env.sh` + `c7ntax-deploy` IAM profile, verified against both envs | #4 | No safe path from local to AWS; manual console deploys are error-prone. |
| 6 | **Schema & data sync:** `prisma migrate deploy` into prod + snapshot reseed pipeline (optional flag), prod seed guards (no `--accept-data-loss`) | #2, #4 | Prod schema drifts from dev → runtime Prisma errors (e.g. missing tables/columns) after sync. |
| 7 | **Sync-command handler:** agent-layer message classifier (standalone trigger vs negated/longer sentences) + pipeline orchestration script | #5, #6 | Syncs can't be triggered, or worse: incidental sentences trigger prod deploys. |
| 8 | **Prod hardening:** WAF, KMS envelope encryption (PLAN-007 SC-02), prod JWT secret rotation, demo-reseed endpoints disabled, rate limits, CloudTrail/CloudWatch | #4 (prod exists) | Prod inherits dev-grade controls; data loss/abuse risk per PLAN-007 SC-12/PI-03. |
| 9 | **Inference containerization:** vLLM/TGI ECS task (or Bedrock), `INFERENCE_BASE_URL`/`INFERENCE_API_KEY` env config per environment, token budgets + PII redaction | #4 (prod compute), #8 (secrets/KMS) | LLM calls keep hitting the dev provider from prod; or container runs with plaintext secrets. |
| 10 | **Validation & runbook:** end-to-end sync rehearsal, rollback runbook, port-based prod verification checklist, monitoring alerts | #1–#9 | First real sync is unscripted; no recovery path if a sync half-completes. |

All items preserve the existing app behavior; nothing changes until #4 deploys
the first dev copy and #7 enables the sync path.

## 8. Sync trigger specification (agent-layer)

| Message example | Classification | Action |
|---|---|---|
| `Push to Prod` | sync command | run pipeline §5 |
| `Go Live on Prod` | sync command | run pipeline §5 |
| `Push to production server` | sync command | run pipeline §5 |
| `Please push these changes to prod after you fix the calendar` | normal request | dev work only — **no sync** (phrase is part of a longer sentence) |
| `Do not push to production — just fix the bug on dev` | normal request (negated) | dev work only — **no sync** |
| `Fix the calendar page` | normal request | dev work only |

Classifier rules: message trimmed of punctuation must equal a trigger phrase
(optionally + `to <target>` wording, e.g. "prod", "production server", "live")
→ sync. Any additional text, negation words ("do not", "don't", "not yet",
"hold off"), or questions ("should I push to prod?") → normal request.

## 9. Rollback plan

- **Prod instant stop:** set desired count 0 on `c7ntax-prod` (ECS) — dev is
  unaffected (separate service/listener).
- **Bad deploy rollback:** ECS keeps the previous task definition revision —
  redeploy the prior revision (`aws ecs update-service --task-definition
  c7ntax-prod:<prev>`); blue/green makes this one click.
- **Schema rollback:** prod RDS PITR (Multi-AZ + backups per #2) restores the
  pre-sync database state.
- **Dev is never touched by sync** — all sync steps read dev, write prod.
- Kill switch: delete the `c7ntax-deploy` IAM profile/policies → no syncs can
  run while the code remains.

## 10. Verification plan

- **Infra:** `terraform plan` clean; both ALB ports return the app; RDS
  connectivity from ECS tasks only (private subnets).
- **Sync rehearsal (staging the sync itself on dev → dev2 or a throwaway
  task):** full pipeline succeeds, prod port login + frontend 200, DB schema
  matches dev.
- **Classifier unit tests:** table from §8 (trigger/negation/long-sentence
  cases) must all classify correctly.
- **Regression:** local boot pipeline, snapshot reseed, service-alert monitor,
  typecheck baselines unchanged.

## 11. Security & compliance controls (IT Glue parity)

Appended from the IT Glue security comparison (2026-08). Each item is dependency-ordered within this section; WAF/segmentation land with the environments (phases 1–2), scanning/backups follow once prod exists.

| # | Item | Depends on | Notes |
|---|---|---|---|
| 11.1 | **WAF + rate limiting + brute-force protection (edge):** CloudFront distribution in front of the ALB (SPA edge caching; AWS Shield Standard — free, automatic, at the edge — for volumetric DDoS) with AWS WAF attached for L7 rules (SQLi/XSS/bot) and per-IP rate limiting on `/api/auth/login`, `/api/auth/sso/*`, and Kumo reveal endpoints. WAF is not DDoS protection — Shield/CloudFront covers that. | Phases 1–2 (ALB exists) | Peer review (Claude Sonnet 5): "WAF ≠ DDoS protection… put CloudFront in front of the ALB." Complements app-level lockout (PLAN-013 #6). |
| 11.2 | **IP Access Control:** optional allowlist of IPs/CIDRs at the ALB (env-driven, off by default); deny-list mode for API access; vendor/whitelist note for integrations. | 11.1 | IT Glue "IP Access Control" parity — optional, admin-configured, not on by default. |
| 11.3 | **Network segmentation & hardened hosts:** separate VPCs/subnets + security groups per env (dev/test/prod); private prod RDS (no public ingress); **admin access via AWS Systems Manager Session Manager only — no bastion hosts, no inbound SSH/ports**; egress whitelisting. | Phase 1 (env split) | IT Glue "layered security system: firewalls, network segmentation, hardened servers"; peer review: "skip bastion hosts/SSH entirely — Session Manager into private-subnet resources, no inbound ports." |
| 11.4 | **Vulnerability scanning & pen-test calendar:** quarterly internal dependency/vuln scans (Trivy + npm audit in CI, plus scheduled), quarterly third-party scans, annual external penetration test, annual hardening review — recorded in a `SECURITY.md` compliance calendar with evidence links. | 11.3, prod env up | IT Glue SOC 2 scanning/pen-test cadence. |
| 11.5 | **Backups, restore tests & replication/failover:** daily automated RDS backups (monitored; alert on failure), weekly restore-test from backup, real-time cross-region replication (primary→secondary region) with a documented failover runbook (target seconds–minutes cutover; IT Glue's ~1.5s regional cutover as reference, not requirement), DRP tested annually. | Phases 2–3 (RDS exists) | IT Glue "daily backups, replication between regions, DRP tested at least annually". |
| 11.6 | **SOC 2 change management controls:** segregated dev/test/prod change path (already the sync pipeline), mandatory ≥2-reviewer code review + risk assessment + QA before prod deploy, incident documentation (containment, RCA, long-term fix, evidence), high-severity RCA process. | Phase 2 (sync pipeline) | Mirrors IT Glue SOC 2 change management; aligns with existing PLAN-007 audit/evidence work. |
| 11.7 | **Tamper-evident audit trail:** CloudTrail/CloudWatch delivery to a dedicated log bucket protected by S3 Object Lock (compliance mode) or a dedicated log account with restricted write — logs must survive an attacker or a bad reseed script (the plan already records a reseed incident). | Phase 2 (logging exists) | Peer review: "CloudTrail/audit needs to be tamper-evident, not just 'on'." |
| 11.8 | **Envelope encryption for vault data (SC-02/PLAN-015):** bucket-level SSE-KMS is baseline only; the real control is envelope encryption — per-record (PLAN-015 phase 1) and, if multi-tenant, per-tenant DEKs wrapped by per-tenant KMS CMKs (key separation so one leaked key does not expose all tenants). Lock the tenancy model (§13.7) before the SC-02 migration. | PLAN-015 phases 1–2; §13.7 decision | Peer review: "bucket-level SSE-KMS isn't enough for the vault data." |

## 12. Considerations & recommendations summary

- **Databases:** separate dev/prod RDS (never share). Schema via migrations;
  sample data via snapshots. Prod: Multi-AZ + PITR + KMS-encrypted.
- **LLM:** containerize vLLM/TGI on GPU ECS (autoscale on queue depth) or
  Bedrock for managed serving; `INFERENCE_BASE_URL`/`INFERENCE_API_KEY` per
  env in Secrets Manager; redact PII; enforce token budgets.
- **Security:** least-privilege deploy role; per-env JWT secrets; CloudFront +
  Shield Standard + WAF (L7 rules); KMS; private prod DB; tamper-evident
  CloudTrail (S3 Object Lock / log account); SSM Session Manager admin access
  (no bastion/SSH); vault data via SC-02/PLAN-015 envelope encryption;
  prod reseed/wipe guards (PLAN-007).
- **Peer review notes (Claude Sonnet 5, 2026-08):** WAF is L7 rule matching,
  not volumetric DDoS protection — add CloudFront + Shield Standard at the
  edge; S3 SSE-KMS alone does not protect vault data — SC-02 envelope
  encryption (per-record/per-tenant DEKs + KMS CMK) is the control, with
  per-tenant key separation if multi-tenant; make CloudTrail tamper-evident
  (S3 Object Lock or dedicated log account); admin access via SSM Session
  Manager with no inbound ports; decide multi-tenant SaaS vs single-tenant
  deployments BEFORE the SC-02 migration (§13.7) — it changes the data model
  (RLS vs schema-per-tenant) and the key hierarchy.
- **Tooling:** Terraform (or CDK) for IaC; GitHub Actions/Forgejo for CI;
  `deploy-env.sh` for local pushes; ECS blue/green for prod.

## 13. Open decisions to confirm before implementation

1. Prod port: `3011` (ALB) vs 443-path routing — recommend port-based per the
   requirement.
2. Domain & certificates: `c7ntax.example.com:3010/3011` vs single domain two
   listeners.
3. IaC choice: Terraform vs AWS CDK.
4. Inference: self-hosted vLLM on GPU vs Bedrock (cost/latency tradeoff).
5. Region and VPC CIDR planning.
6. Data sync scope: code-only syncs by default vs data+code when the command
   says "with data".
7. **Tenancy model (decide BEFORE SC-02 envelope-encryption migration):**
   multi-tenant SaaS (shared Postgres/S3 — requires tenant isolation in the
   data model: row-level security or schema-per-tenant, plus per-tenant KMS
   keys) vs single-tenant deployment per customer. Ties to PLAN-003 (Step 0
   gate) and PLAN-015 open decision #1.
8. **Edge layer:** adopt CloudFront + Shield Standard in front of the ALB
   (recommended yes — DDoS posture + SPA edge cache + WAF attach point).
