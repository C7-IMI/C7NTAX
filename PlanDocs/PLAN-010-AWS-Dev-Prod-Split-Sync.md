> **Plan ID:** PLAN-010
> **Title:** AWS Dev/Prod Split & Sync Plan
> **Source:** `PLAN-AWS-Dev-Prod-Split-and-Sync.md` (original remains in place)
> **Indexed:** 2026-08-18

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
                                        ├─ ECS Fargate service "c7ntax-dev"  ─┐
                                        ├─ ECS Fargate service "c7ntax-prod" ─┤ ALB
                                        │    ├─ listener :3010 → dev target  ─┘  (two listener ports)
                                        │    └─ listener :3011 → prod target
                                        ├─ RDS PostgreSQL "c7ntax-dev"  (small, Single-AZ)
                                        ├─ RDS PostgreSQL "c7ntax-prod" (Multi-AZ + PITR, private subnet)
                                        └─ Secrets Manager (DATABASE_URL, JWT_SECRET, INFERENCE_*, per env)
```

- **One codebase, one image** (`NODE_ENV`/env-var driven). Dev and prod run the
  same container with different environment configuration. Prod verification =
  open the ALB prod port in the browser and refresh.
- **Ports:** dev `3010`, prod `3011` on the same ALB (final choice in §12).
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
  private subnet (no public access); security groups per service; WAF on the
  ALB; TLS 1.2+; CloudTrail + CloudWatch logs; prod guards from PLAN-007
  SC-12/PI-03 (no `--accept-data-loss`, no demo reseed endpoints in prod).

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

## 11. Considerations & recommendations summary

- **Databases:** separate dev/prod RDS (never share). Schema via migrations;
  sample data via snapshots. Prod: Multi-AZ + PITR + KMS-encrypted.
- **LLM:** containerize vLLM/TGI on GPU ECS (autoscale on queue depth) or
  Bedrock for managed serving; `INFERENCE_BASE_URL`/`INFERENCE_API_KEY` per
  env in Secrets Manager; redact PII; enforce token budgets.
- **Security:** least-privilege deploy role; per-env JWT secrets; WAF; KMS;
  private prod DB; CloudTrail; prod reseed/wipe guards (PLAN-007).
- **Tooling:** Terraform (or CDK) for IaC; GitHub Actions/Forgejo for CI;
  `deploy-env.sh` for local pushes; ECS blue/green for prod.

## 12. Open decisions to confirm before implementation

1. Prod port: `3011` (ALB) vs 443-path routing — recommend port-based per the
   requirement.
2. Domain & certificates: `c7ntax.example.com:3010/3011` vs single domain two
   listeners.
3. IaC choice: Terraform vs AWS CDK.
4. Inference: self-hosted vLLM on GPU vs Bedrock (cost/latency tradeoff).
5. Region and VPC CIDR planning.
6. Data sync scope: code-only syncs by default vs data+code when the command
   says "with data".
