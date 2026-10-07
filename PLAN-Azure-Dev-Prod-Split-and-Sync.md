# Azure Dev/Prod Split & Sync Plan

> **Sequence:** Wave 3 · position 6 of 12 (re-sequenced 2026-10-06) · **Status:** ⬜ Not started — plan + decision record only (§15 recommends Azure; final call pending)
> **Implemented:** nothing in-repo — no IaC, no container definitions, no deploy pipeline; `.github/workflows` contains only `desktop-build.yml`, so there is no CI that runs typecheck, tests or migrations.
> **Outstanding:** every phase, plus the CI/CD the repository currently lacks entirely. Note the Prisma workflow: migrations are applied with `db push` in dev and there is no versioned migration history (PLAN-007 PI-01), which has to be fixed as part of this plan rather than after it.
> **Depends on:** nothing — this is the foundation. **Unblocks:** PLAN-007's AV/CF/OR controls, PLAN-011's hosting/AI services, PLAN-005's update feed.
> **Next action:** confirm Azure vs AWS, then build dev environment #1 (app + PostgreSQL + Key Vault equivalent) behind a CI pipeline that runs typecheck and tests before deploy.

**Plan Label:** Azure Dev/Prod Split & Sync Plan
**Status:** ⬜ Not started — plan and decision record only (see the sequence block below).
**Date:** 2026-10-05
**Companion:** `PLAN-AWS-Dev-Prod-Split-and-Sync.md` (PLAN-010) — identical goals, sync semantics, phases, and rollback model; every AWS service is mapped to its Azure equivalent in §2.

---

## 1. Goal

Split the current single-server setup into two Azure environments:

- **Dev** — the existing environment where all future changes are made.
- **Prod** — a new production deployment running **alongside dev**, reachable on a
  **different port** so production can be verified by refreshing the browser
  after pushing changes.

**Sync semantics (agent-layer rule, enforced on every future message — identical to PLAN-010):**

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

## 2. AWS → Azure service mapping

| Concern | AWS (PLAN-010) | Azure equivalent | Notes |
|---|---|---|---|
| Container registry | ECR | **Azure Container Registry (ACR)** | Per-env image tags; geo-replication optional. |
| Container compute | ECS Fargate | **Azure Container Apps (ACA)** | Revisions give built-in blue/green + traffic splitting (better than ECS+CodeDeploy). AKS is the alternative if full control is needed. |
| Load balancer / two listeners | ALB (`:3010`, `:3011`) | **Application Gateway v2** (multi-site listeners) | The only Azure L7 option that serves arbitrary ports — required for port-based prod verification. |
| Global edge / CDN / DDoS / WAF attach point | CloudFront + AWS Shield Standard | **Azure Front Door Premium** | Front Door serves **only 80/443**; used for the public entry point, SPA edge cache, WAF and DDoS. |
| L7 WAF | AWS WAF | **Azure WAF** on Front Door / Application Gateway | OWASP rule sets + per-IP rate limiting. |
| Volumetric DDoS | Shield Standard/Advanced | **Azure DDoS Protection Standard** (VNet) | Front Door absorbs edge floods; DDoS Protection Standard protects the VNet/App Gateway. |
| Relational DB | RDS PostgreSQL (Single-AZ / Multi-AZ + PITR) | **Azure Database for PostgreSQL Flexible Server** | Dev Burstable, single-zone; prod General Purpose, **zone-redundant HA** + PITR + geo-redundant backup. |
| Object storage | S3 | **Azure Blob Storage** (GPv2) | Immutable containers for logs/backups; private endpoints. |
| Secrets | AWS Secrets Manager | **Azure Key Vault** (secrets) | RBAC + soft-delete + purge protection; referenced by Container Apps via managed identity. |
| Encryption keys | AWS KMS | **Azure Key Vault** keys (Premium) / **Managed HSM** | Envelope encryption (SC-02/PLAN-015) via per-record/per-tenant keys. |
| Audit / metrics / logs | CloudTrail + CloudWatch | **Azure Activity Log + Azure Monitor + Log Analytics** | Diagnostic settings → immutable Blob container (or dedicated log subscription). |
| Identity / RBAC | AWS IAM | **Microsoft Entra ID + Azure RBAC** | Container Apps use **managed identity**; no static service credentials. |
| Admin access | SSM Session Manager (no SSH) | **Azure Bastion** / `az containerapp exec` | No public SSH/RDP; Bastion for any IaaS, portal/CLI exec for containers. |
| Network | VPC, subnets, NAT, SGs | **Virtual Network (VNet)**, subnets, **NAT Gateway**, **NSGs**, private endpoints | Private DNS zones for Postgres/Key Vault/Storage/ACR. |
| DNS / TLS | Route 53 + ACM | **Azure DNS** + Front Door/App Gateway managed certs (or Key Vault certs) | TLS 1.2+ enforced. |
| Managed LLM | Amazon Bedrock | **Azure OpenAI Service** / Azure AI Foundry Models | PLAN-011 becomes "Azure OpenAI agentic RAG"; data stays in the Azure tenant. |
| Self-hosted LLM | vLLM/TGI on GPU ECS | **vLLM/TGI on ACA GPU workload profile or AKS GPU node pool** | Same `INFERENCE_BASE_URL`/`INFERENCE_API_KEY`/`INFERENCE_MODEL` contract. |
| CI/CD | GitHub Actions + AWS CLI profile | **GitHub Actions + `azure/login` OIDC** (federated credential) | No long-lived cloud secrets stored in CI. |
| IaC | Terraform / CDK | **Bicep** (native) or **Terraform `azurerm`** | See §7 #1 / §13.3. |
| Policy guardrails | AWS SCP / Config | **Azure Policy** | Enforce private endpoints, TLS, allowed regions, tag policy. |

**Azure-specific caveats (must be designed around, not discovered later):**

1. **Front Door cannot serve arbitrary ports (443/80 only).** Port-based prod
   verification (`3010` vs `3011`) therefore maps to **Application Gateway
   listeners**, not Front Door. Front Door, if adopted, sits in front on 443 and
   routes by host/path. See §13.1.
2. **Zone-redundant HA for PostgreSQL Flexible Server is region-dependent.**
   Pick a primary region that supports zone-redundant HA and a paired region for
   geo-redundant backups.
3. **Key Vault has soft-delete + purge protection.** Enable both before prod so
   a rotation/deletion can never be irreversible.
4. **Managed identity replaces IAM access keys.** Container Apps pull images
   from ACR and read Key Vault via their managed identity — no stored secrets.
5. **Private endpoints + private DNS** are required so Postgres/Key Vault/Storage
   are unreachable from the public internet.

## 3. Environment assumptions

- Both environments live in Azure. Recommended topology: **two subscriptions**
  (`c7ntax-dev`, `c7ntax-prod`) or one subscription with separate resource
  groups and strict RBAC — dev identities cannot touch prod resources.
- The current local dev environment can push changes to **both** the Azure dev
  and Azure production deployments (via `az` CLI / OIDC federated credential —
  see §6).
- Region pairing: primary `eastus2`, secondary `centralus` (example; confirm in
  §13.5).

## 4. Current state (verified)

- Local stack: PostgreSQL service `postgresql-c7ntax`, API Express+tsx on
  `:4000`, Vite web on `:3010`; boot pipeline `startup/c7ntax-boot.ps1`
  (prisma skip-if-unchanged, snapshot reseed via `seed-from-snapshots.ts` +
  `seed-service-alerts.ts`), JWT 12h tokens (15-min when
  `AUTH_HARDENING_ENABLED=true`), gzip middleware, service-alert monitor
  (5-min), snapshot poller, PlanDocs registry.
- No Azure artifacts exist yet. The SOC 2 controls in PLAN-007 (`SOC2.Compliance.md`)
  are cloud-agnostic in intent and map to the Azure services in §2 and §11.

## 5. Proposed architecture

```
Local dev (Win) ──az CLI / azure deploy script (OIDC)──▶ Azure (VNet, region)
                                                        ├─ Azure Container Registry (app images, per-env tags)
                                                        ├─ Azure Front Door Premium — global edge, WAF (L7),
                                                        │     DDoS absorption, TLS, SPA edge cache   (80/443 only)
                                                        │        └─► Application Gateway v2 (WAF_v2)
                                                        ├─ Container Apps env "c7ntax-dev"  ─┐
                                                        ├─ Container Apps env "c7ntax-prod" ─┤ App Gateway listeners
                                                        │    ├─ listener :3010 → dev backend  ─┘   (two listener ports)
                                                        │    └─ listener :3011 → prod backend
                                                        ├─ PostgreSQL Flexible Server "c7ntax-dev"  (Burstable, single-zone)
                                                        ├─ PostgreSQL Flexible Server "c7ntax-prod" (GP, zone-redundant HA + PITR, geo-backup, private subnet)
                                                        ├─ Blob Storage — static/backup/log containers (immutable policy for logs;
                                                        │     vault data relies on PLAN-015 envelope encryption, not bucket SSE)
                                                        ├─ Azure Monitor + Log Analytics + Activity Log → immutable log storage
                                                        └─ Key Vault (secrets + keys) — per env, managed-identity access
```

- **One codebase, one image** (`NODE_ENV`/env-var driven). Dev and prod run the
  same container with different environment configuration. Prod verification =
  open the App Gateway prod port in the browser and refresh.
- **Ports:** dev `3010`, prod `3011` on the same Application Gateway (final
  choice in §13.1). Front Door, if used, terminates on 443 and forwards.
- **Databases:** two separate flexible servers (dev never touches prod data;
  prod keeps zone-redundant HA + automated backups + PITR per PLAN-007 AV-01).
  Schema moves dev→prod via `prisma migrate deploy`; sample data via the defined
  snapshot seed process.
- **CI/CD:** GitHub Actions: on push → build image → ACR → deploy **dev**
  automatically (new Container Apps revision). **Prod deploys only via the sync
  command.**
- **LLM / inference (custom, containerized):** the API's inference path already
  targets OpenAI-compatible endpoints (`INFERENCE_MODEL` override exists).
  Plan: containerize inference with **vLLM** or **Hugging Face TGI** on an ACA
  GPU workload profile / AKS GPU pool (autoscaling on queue depth), or use
  **Azure OpenAI Service** (managed) — the Azure analog of Bedrock, with the
  data-residency advantage Bedrock provides on AWS. Wire via
  `INFERENCE_BASE_URL` / `INFERENCE_API_KEY` / `INFERENCE_MODEL` per environment
  (Key Vault). Dev keeps the current provider; prod points at the
  containerized/Azure OpenAI endpoint. Guardrails: per-tenant token budgets,
  rate limits, PII redaction before prompts.
- **Security:** Key Vault + customer-managed keys for all secrets; per-env
  `JWT_SECRET`; managed identity + least-privilege Azure RBAC (deploy identity
  scoped to ACR push + Container Apps update + Key Vault read only); prod
  Postgres in a private subnet via **private endpoint** (no public access);
  NSGs per subnet; **Front Door + Azure DDoS Protection Standard in front of the
  Application Gateway** (edge caching for the SPA; WAF is L7 rules/rate limiting,
  NOT volumetric DDoS protection); Azure WAF attached at Front Door and App
  Gateway; TLS 1.2+; Activity Log + diagnostic settings to an **immutable Blob
  container (time-based retention / legal hold)**; admin access via **Azure
  Bastion / portal exec — no public SSH/RDP**; vault data protection =
  **SC-02/PLAN-015 envelope encryption (per-record/per-tenant DEKs wrapped by a
  Key Vault key or Managed HSM key)** — Blob SSE alone is insufficient; prod
  guards from PLAN-007 SC-12/PI-03 (no `--accept-data-loss`, no demo reseed
  endpoints in prod).

## 6. Local → Azure push tooling

- `scripts/azure/deploy-env.sh <dev|prod>`: reads env config, tags the image,
  calls `az acr build` / `docker push`, then
  `az containerapp update --name c7ntax-<env> --image <acr>/c7ntax:<tag>
  --revision-suffix <git-sha>`, waits for the revision to become healthy,
  shifts traffic to the new revision, and prints the health result.
- Local machine: Azure CLI (`az`) authenticated via **workload identity
  federation / OIDC** (GitHub Actions) or a dedicated service principal with a
  role assignment limited to `AcrPush`, `Container Apps Contributor` (scoped to
  the two apps), and `Key Vault Secrets User` (dev + prod scoped).
- Both environments reachable from local; prod verification is a browser
  refresh against the prod App Gateway port.

## 7. Implementation phases (dependency-ordered — prerequisites first)

| # | Item | Depends on | Risk if prerequisite is skipped |
|---|---|---|---|
| 1 | **Base infrastructure (IaC):** Bicep/Terraform — resource groups, VNet, public/private subnets, NAT Gateway, NSGs, private DNS zones | — (no prerequisites) | Everything below fails; no VNet = no resources. |
| 2 | **Databases:** PostgreSQL Flexible Server `c7ntax-dev` (Burstable, single-zone) + `c7ntax-prod` (General Purpose, zone-redundant HA + backups + PITR + geo-backup, private subnet), Key Vault secrets (`DATABASE_URL` per env, `JWT_SECRET`, `KUMO_MASTER_KEY`) | #1 | Apps can't boot (no DB), and schema/seed phases (#6) have nowhere to apply. |
| 3 | **Registry & CI:** ACR repository + GitHub Actions workflow (`azure/login` OIDC; build image, push, deploy dev automatically) | #1, #2 (env vars for connection strings come from Key Vault) | No image pipeline; dev can't be deployed automatically and #4 has no image to run. |
| 4 | **Compute & ingress:** Container Apps environments + apps `c7ntax-dev` / `c7ntax-prod` (system-assigned managed identity; ACR pull + Key Vault references), Application Gateway v2 with two listeners (dev `:3010`, prod `:3011`); Front Door Premium in front (443) for prod once decided | #1–#3 | Port-based prod verification is impossible; prod has no runtime to verify. |
| 5 | **Local push tooling:** `scripts/azure/deploy-env.sh` + deploy identity/RBAC, verified against both envs | #4 | No safe path from local to Azure; manual portal deploys are error-prone. |
| 6 | **Schema & data sync:** `prisma migrate deploy` into prod + snapshot reseed pipeline (optional flag), prod seed guards (no `--accept-data-loss`) | #2, #4 | Prod schema drifts from dev → runtime Prisma errors (e.g. missing tables/columns) after sync. |
| 7 | **Sync-command handler:** agent-layer message classifier (standalone trigger vs negated/longer sentences) + pipeline orchestration script | #5, #6 | Syncs can't be triggered, or worse: incidental sentences trigger prod deploys. |
| 8 | **Prod hardening:** WAF policy (Front Door + App Gateway), Key Vault customer-managed keys / Managed HSM (PLAN-007 SC-02), prod JWT secret rotation, demo-reseed endpoints disabled, rate limits, Azure Monitor + diagnostic settings to immutable Blob | #4 (prod exists) | Prod inherits dev-grade controls; data loss/abuse risk per PLAN-007 SC-12/PI-03. |
| 9 | **Inference containerization:** vLLM/TGI on ACA GPU profile (or Azure OpenAI), `INFERENCE_BASE_URL`/`INFERENCE_API_KEY` env config per environment from Key Vault, token budgets + PII redaction | #4 (prod compute), #8 (secrets/KMS) | LLM calls keep hitting the dev provider from prod; or the container runs with plaintext secrets. |
| 10 | **Validation & runbook:** end-to-end sync rehearsal, rollback runbook, port-based prod verification checklist, Azure Monitor alerts (health, DB, revision failures) | #1–#9 | First real sync is unscripted; no recovery path if a sync half-completes. |

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

## 9. Sync pipeline (dev → prod), run only on a valid sync command

1. **Pre-flight on dev:** `verify-post-change.ts` + boot health checks green.
2. **Code sync:** build the tagged image in ACR from the current dev tree.
3. **Schema sync:** `prisma migrate deploy` against prod Postgres (migrations
   only — never `db push --accept-data-loss` in prod).
4. **Data sync (optional flag):** snapshot-based reseed of sample data into
   prod using the defined process (`seed-from-snapshots.ts` +
   `seed-service-alerts.ts`); skipped when the sync command doesn't ask for
   data.
5. **Deploy:** create a new Container Apps revision
   (`az containerapp update --revision-suffix <sha>`) and shift 100% traffic to
   it (single-revision mode; blue/green via multi-revision when required).
6. **Verify:** health + login + frontend HTTP 200 on the **prod port**; record
   the result.
7. **Log:** BuildNotes entry + Retrace prompt entry + audit trail (per the
   mandatory changelog policy).

The sync-command classifier runs **before** any other processing: only a
standalone trigger phrase (optionally + target wording) enters the pipeline;
negated/longer messages proceed as normal dev work.

## 10. Rollback plan

- **Prod instant stop:** set prod Container App min/max replicas to 0 — dev is
  unaffected (separate app/listener).
- **Bad deploy rollback:** Container Apps keeps prior revisions — shift traffic
  back to the previous revision (`az containerapp ingress traffic set
  --revision-weight <prev>=100`) or activate it; blue/green makes this one
  command.
- **Schema rollback:** Postgres PITR (zone-redundant HA + backups per #2)
  restores the pre-sync database state.
- **Key/secret rollback:** Key Vault versioning + soft-delete/purge protection
  lets a rotated secret or key be restored to the previous version.
- **Dev is never touched by sync** — all sync steps read dev, write prod.
- Kill switch: remove the deploy identity's role assignments (or disable the
  federated credential) → no syncs can run while the code remains.

## 11. Verification plan

- **Infra:** `bicep build` / `terraform plan` clean; both App Gateway listeners
  return the app; PostgreSQL reachable only from the Container Apps subnet
  (private endpoint + NSG), never publicly.
- **Sync rehearsal (staging the sync itself on dev → dev2 or a throwaway
  revision):** full pipeline succeeds, prod port login + frontend 200, DB schema
  matches dev.
- **Classifier unit tests:** table from §8 (trigger/negation/long-sentence
  cases) must all classify correctly.
- **Regression:** local boot pipeline, snapshot reseed, service-alert monitor,
  typecheck baselines unchanged.

## 12. Security & compliance controls (IT Glue parity)

Appended from the IT Glue security comparison (2026-08). Each item is
dependency-ordered within this section; WAF/segmentation land with the
environments (phases 1–2), scanning/backups follow once prod exists. Azure
services per §2.

| # | Item | Depends on | Notes |
|---|---|---|---|
| 12.1 | **WAF + rate limiting + brute-force protection (edge):** Azure Front Door Premium (SPA edge caching; Azure DDoS Protection Standard for volumetric DDoS at the VNet/edge) with an **Azure WAF policy** for L7 rules (SQLi/XSS/bot) and per-IP rate limiting on `/api/auth/login`, `/api/auth/sso/*`, `/api/auth/webauthn/*`, and Kumo reveal endpoints. WAF is not DDoS protection — Front Door + DDoS Protection Standard cover that. | Phases 1–2 (App Gateway exists) | Azure counterpart of PLAN-010 §11.1. Complements app-level lockout (PLAN-013 #8). |
| 12.2 | **IP Access Control:** optional allowlist of IPs/CIDRs at Front Door / App Gateway (env-driven, off by default); deny-list mode for API access; vendor/whitelist note for integrations. | 12.1 | IT Glue "IP Access Control" parity — optional, admin-configured, not on by default. |
| 12.3 | **Network segmentation & hardened hosts:** VNet with separate subnets per env; prod Postgres and Key Vault reachable only via **private endpoints** (public access disabled); NSGs per subnet; **admin access via Azure Bastion / portal exec — no public SSH/RDP**; egress via NAT Gateway with optional destination allowlisting. | Phase 1 (env split) | IT Glue "layered security system"; Azure counterpart of SSM Session Manager. |
| 12.4 | **Vulnerability scanning & pen-test calendar:** quarterly internal dependency/vuln scans (Trivy + `npm audit` in CI, plus Microsoft Defender for Containers/Cloud), quarterly third-party scans, annual external penetration test, annual hardening review — recorded in a `SECURITY.md` compliance calendar with evidence links. | 12.3, prod env up | IT Glue SOC 2 scanning/pen-test cadence. |
| 12.5 | **Backups, restore tests & replication/failover:** daily automated Postgres backups (monitored; alert on failure), weekly restore-test, **zone-redundant HA** in-region and **geo-redundant backups** to the paired region with a documented failover runbook (target seconds–minutes cutover), DRP tested annually. | Phases 2–3 (Postgres exists) | Azure counterpart of RDS Multi-AZ + cross-region replication. |
| 12.6 | **SOC 2 change management controls:** segregated dev/test/prod change path (already the sync pipeline), mandatory ≥2-reviewer code review + risk assessment + QA before prod deploy, incident documentation (containment, RCA, long-term fix, evidence), high-severity RCA process. | Phase 2 (sync pipeline) | Mirrors IT Glue SOC 2 change management; aligns with existing PLAN-007 audit/evidence work. |
| 12.7 | **Tamper-evident audit trail:** Azure Activity Log + resource diagnostic settings delivered to a **Storage account container with an immutable (time-based retention) policy**, or a dedicated log subscription with restricted write — logs must survive an attacker or a bad reseed script (the plan already records a reseed incident). | Phase 2 (logging exists) | Azure counterpart of CloudTrail → S3 Object Lock. |
| 12.8 | **Envelope encryption for vault data (SC-02/PLAN-015):** Blob/disk SSE is baseline only; the real control is envelope encryption — per-record (PLAN-015 phase 1) and, if multi-tenant, per-tenant DEKs wrapped by per-tenant Key Vault keys / Managed HSM keys (key separation so one leaked key does not expose all tenants). Lock the tenancy model (§13.7) before the SC-02 migration. | PLAN-015 phases 1–2; §13.7 decision | Azure counterpart of KMS CMK envelope encryption. |

## 13. Considerations & recommendations summary

- **Databases:** separate dev/prod Flexible Servers (never share). Schema via
  migrations; sample data via snapshots. Prod: zone-redundant HA + PITR +
  geo-redundant backup + customer-managed key encryption.
- **LLM:** containerize vLLM/TGI on an ACA GPU profile (autoscale on queue
  depth) or Azure OpenAI for managed serving; `INFERENCE_BASE_URL`/`INFERENCE_API_KEY`
  per env in Key Vault; redact PII before prompts.
- **Security:** least-privilege deploy identity (managed identity + OIDC); per-env
  JWT secrets; Front Door + DDoS Protection Standard + WAF (L7 rules); Key Vault
  keys; private prod DB; tamper-evident Activity Log (immutable Blob); Azure
  Bastion/portal exec admin access (no public SSH); vault data via
  SC-02/PLAN-015 envelope encryption; prod reseed/wipe guards (PLAN-007).
- **Azure-specific guidance:** Front Door only serves 443/80 — use Application
  Gateway listeners for ports `3010`/`3011` (or Front Door hostnames if a
  host-based scheme is chosen, §13.1); enable Key Vault soft-delete + purge
  protection; use private endpoints + private DNS; prefer Container Apps
  revisions over VM-based blue/green; use Azure Policy to enforce private
  endpoints and allowed regions.
- **Supersedes/parallels:** This plan is the Azure twin of PLAN-010. PLAN-011
  (Bedrock RAG) maps to Azure OpenAI; PLAN-007 controls map to Key Vault, private
  endpoints, immutable Blob logs, and DDoS Protection Standard. PLAN-015's
  "serverless AWS packaging / OpenTofu CI/CD / dev=prod" items apply here as
  "Container Apps / Bicep-or-Terraform / dev-prod split".
- **Tooling:** Bicep (or Terraform `azurerm`) for IaC; GitHub Actions with
  `azure/login` OIDC for CI; `deploy-env.sh` for local pushes; Container Apps
  revisions for blue/green.

## 14. Open decisions to confirm before implementation

1. **Port-based vs host-based prod verification:** Application Gateway with two
   listeners (`:3010`/`:3011`) vs Front Door with two hostnames
   (`dev.`/`prod.`). Recommend **Application Gateway ports** for parity with the
   AWS plan; Front Door (443) can front both if a custom domain is preferred.
2. **Domain & certificates:** `c7ntax.example.com:3010/3011` vs
   `dev.c7ntax.example.com` / `prod.c7ntax.example.com` with Front Door managed
   certs.
3. **IaC choice:** Bicep (native, tighter portal integration) vs Terraform
   `azurerm` (multi-cloud parity with the AWS plan).
4. **Inference:** Azure OpenAI vs self-hosted vLLM on ACA GPU (cost/latency/
   data-residency tradeoff).
5. **Regions:** primary region (must support zone-redundant HA) and its paired
   region for geo-redundant backups.
6. **Subscription topology:** two subscriptions (strongest isolation) vs one
   subscription with separate resource groups + RBAC.
7. **Data sync scope:** code-only syncs by default vs data+code when the command
   says "with data".
8. **Tenancy model (decide BEFORE SC-02 envelope-encryption migration):**
   multi-tenant SaaS (shared Postgres/Blob — requires tenant isolation in the
   data model: row-level security or schema-per-tenant, plus per-tenant Key
   Vault keys) vs single-tenant deployment per customer. Ties to PLAN-003
   (Step 0 gate) and PLAN-015 open decision #1.
9. **Edge layer:** adopt Front Door Premium + DDoS Protection Standard in front
   of the Application Gateway (recommended yes — DDoS posture + SPA edge cache +
   WAF attach point).
10. **Log immutability mechanism:** Blob immutability policy (time-based
    retention) vs a dedicated log subscription with restricted write access.

## 15. Recommendation & decision record (AWS vs Azure)

**Date:** 2026-10-05 | **Status:** Advisory — recommendation recorded, final call pending.

Comparing this plan (PLAN-016, Azure), PLAN-010 (AWS), PLAN-007 (SOC 2), PLAN-011 (AI assistant), and the current codebase/architecture:

**Recommendation: Azure** for this product, with the conditions noted below.

**Why Azure fits this codebase and product:**
1. **Microsoft-centric identity is already in the code.** The integration hub registers `Microsoft365Adapter` and `AzureADSSOAdapter` (Entra ID) alongside cloud adapters (`packages/integrations/src/IntegrationHub.ts`). For a Microsoft-centric MSP this lets the platform's own auth run on Entra ID (Managed Identity for Container Apps → ACR/Key Vault; Entra ID + Conditional Access for admin/SSO) with no static cloud credentials.
2. **The AI assistant (PLAN-011) survives the move.** PLAN-011's constraints — ticket data never leaves the cloud environment, never trains base models — are met by Azure OpenAI / AI Foundry + Azure AI Search, the Azure analog of Bedrock Agents + Knowledge Bases.
3. **Blue/green is native.** Container Apps revisions with traffic splitting serve the "push to prod, refresh the browser" requirement directly; PLAN-010 had to add CodeDeploy to ECS.
4. **SOC 2 controls map 1:1** (§2 / §12): Key Vault (+ Managed HSM) for SC-02 envelope encryption, PostgreSQL Flexible Server zone-redundant HA for AV controls, Activity Log → immutable Blob for tamper-evident audit.

**Where AWS is the better choice:**
- Team already operates AWS, or holds AWS credits/commitments.
- Bedrock is the priority and Azure OpenAI access/model availability is constrained in the target region.
- Minimizing plan churn: PLAN-010 is the incumbent and is referenced by PLAN-007/011/015 (this plan already carries the full service mapping, so the churn is documentation only).

**Deciding factors:**

| If… | Choose |
|---|---|
| Staff/clients are Microsoft-centric and you want one identity plane (Entra ID) | **Azure** |
| Existing AWS depth/credits, or Bedrock priority, or Azure OpenAI access blocked | **AWS** |

**Implementation note:** the application code impact is near-zero either way — there are no cloud SDK dependencies (`@aws-sdk/*`, `@azure/*` are absent; adapters are plain HTTP) and the stack (Node/Express + Prisma + PostgreSQL API, React SPA, Electron desktop) is portable across ECS, Container Apps, or AKS. The migration is infrastructure, identity, and operations — not a rewrite. Both plans remain plan-only until this decision is made.
