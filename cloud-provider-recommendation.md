# Cloud Provider Recommendation — AWS vs Azure (C7NTAX)

**Date:** 2026-10-05 | **Status:** Advisory recommendation (final decision pending)
**Basis:** PLAN-010 (`PLAN-AWS-Dev-Prod-Split-and-Sync.md`), PLAN-016 (`PLAN-Azure-Dev-Prod-Split-and-Sync.md`), PLAN-007 (SOC 2), PLAN-011 (Bedrock/AI assistant), PLAN-015 (feature backlog), and the current codebase/architecture.

Also recorded in `PLAN-Azure-Dev-Prod-Split-and-Sync.md` §15.

---

## Bottom line

**Recommend Azure** for this product.

Both migration plans are technically equivalent for this stack, so the choice is **strategic and operational, not a technical dead-end**. The codebase and product fit tip the balance to Azure.

## Why Azure fits this codebase and product

**1. The product is Microsoft-centric, and the code already proves it.**
The integration hub already registers `Microsoft365Adapter` and `AzureADSSOAdapter` (Entra ID) — see [packages/integrations/src/IntegrationHub.ts](packages/integrations/src/IntegrationHub.ts). You are an MSP whose staff and clients overwhelmingly live in Microsoft 365 and Entra ID. On Azure this gives:
- Entra ID as the platform's own IdP (the existing SSO exchange already speaks OIDC/JWKS), with Conditional Access and MFA inherited from the tenant.
- **Managed identity** for Container Apps → ACR/Key Vault, so there are no static cloud credentials.
- **Azure Bastion** for admin access — the Azure analog of the AWS plan's "SSM only, no inbound SSH" control.

**2. The AI assistant (PLAN-011) survives the move intact.**
PLAN-011's non-negotiables are "ticket data never leaves the cloud environment" and "never used to train base models". **Azure OpenAI / AI Foundry + Azure AI Search** satisfy that exactly like Bedrock Agents + Knowledge Bases do. Choosing Azure does not cost the plan's core objective.

**3. Container Apps maps cleanly to the "push to prod, refresh the browser" requirement.**
PLAN-010 had to bolt blue/green onto ECS (CodeDeploy). Azure Container Apps has **revisions + traffic splitting built in**, so prod verification and rollback are native.

**4. SOC 2 (PLAN-007) maps 1:1.**
Every AWS control in PLAN-007 has a direct Azure equivalent, tabulated in PLAN-016 §2/§12: Secrets Manager → **Key Vault**, KMS → **Key Vault keys / Managed HSM** (SC-02 envelope encryption, per-tenant keys), CloudTrail → **Activity Log + immutable Blob**, RDS Multi-AZ → **PostgreSQL Flexible Server zone-redundant HA**.

## Where AWS legitimately wins

- **The AWS plan is the incumbent.** PLAN-010 is already authored and PLAN-007/011/015 reference AWS services. Choosing Azure means re-pointing those references (PLAN-016 already carries the full mapping, so it is documentation work, not rework).
- **Bedrock maturity** — broader model catalog and no access-approval/regional-availability friction (Azure OpenAI requires model access approval and is region-constrained).
- **Existing team depth / credits** — if engineers already operate AWS, or you hold AWS credits/commitments, that operational familiarity can outweigh the identity fit.

## Deciding factors

| If… | Choose |
|---|---|
| Staff and clients are Microsoft-centric and you want one identity plane (Entra ID) | **Azure** |
| Your team already operates AWS, or you hold AWS credits/commitments, and Bedrock is the AI priority | **AWS** |
| Azure OpenAI model access is blocked in the target region | **AWS** (Bedrock) |

## Practical notes

- **Code impact is near-zero either way.** There is no cloud SDK lock-in — no `@aws-sdk/*` or `@azure/*` dependencies; the integration adapters are plain HTTP. The app is a containerized Node/Express + Prisma + PostgreSQL API with a React SPA and Electron desktop, and containerizes identically on ECS, Container Apps, or AKS. The migration is infrastructure + identity + operations, not a rewrite.
- **One Azure-specific gotcha:** Front Door only serves 443/80, so the AWS plan's port-based prod verification (`3010`/`3011`) maps to **Application Gateway listeners** — or switch to host-based (`dev.`/`prod.`). Not a blocker; lock it in early (PLAN-016 §2/§14).

## Related plans

- `PLAN-AWS-Dev-Prod-Split-and-Sync.md` (PLAN-010) — AWS dev/prod split and sync.
- `PLAN-Azure-Dev-Prod-Split-and-Sync.md` (PLAN-016) — Azure twin, including the service mapping (§2) and decision record (§15).
- `PlanDocs/PLAN-007-SOC2-Compliance.md`, `PlanDocs/PLAN-011-Bedrock-Agentic-RAG-AI-Assistant.md`, `PlanDocs/PLAN-015-Feature-Backlog-UI-Billing-Kumo-Integrations.md`.

Both migration plans are plan-only today and can run in parallel until the provider decision is made.
