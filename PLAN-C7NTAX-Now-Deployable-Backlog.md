# C7NTAX Now-Deployable Backlog (No AWS, Non-Breaking)

**Date:** 2026-08-18 | **Status:** Review deliverable (implementation not started)
**Scope:** Features from PLAN-001…013 that can be implemented and deployed **now** on the current single-server infrastructure (no AWS migration) without breaking the running application.

**Method:** Each candidate was checked against three gates:
1. **No AWS dependency** (excludes PLAN-010 AWS split, PLAN-011 Bedrock).
2. **Non-breaking** (additive models/routes/UI only; existing behavior preserved; feature-gated where uncertain).
3. **Deployable now** (current boot pipeline, self-hosted Postgres, existing poller/service patterns).

---

## ✅ Now-deployable features

### 1. Quotes & service catalog (PLAN-013 #1–#2)
- **Approach:** Additive Prisma models (`Quote`, `QuoteLineItem`) + CRUD routes under `/api/quotes`; a "Convert to Invoice" service that reuses the existing billing/invoice engine and `ticketNumber` sequence. New **Quotes** sidebar page reusing existing list/dialog patterns; ticket-detail "Create Quote" button; Finance dashboard widget. No existing table or route is altered.
- **Safety:** Schema `db push` is additive (no destructive migration); `startup/.schema.sha256` regenerated after. Rollback = drop new models + remove page.
- **Why now:** Pure PSA value-add; zero dependency on device agents or infra changes.

### 2. Billing flow upgrade — time/parts → invoice lines (PLAN-013 #5)
- **Approach:** Read-only linkage first: invoice preview dialog that aggregates approved time entries and ticket parts for the invoice's client, with a "Generate draft lines" action writing into the existing invoice line-item structure. Existing billing routes untouched; new optional endpoint `/api/invoices/generate-from-tickets`.
- **Safety:** Additive endpoint + one dialog; manual entry remains the default path (no behavior change unless the button is used).

### 3. Website/SSL/DNS monitoring (PLAN-013 #4)
- **Approach:** Extend the existing `alertMonitor` poller with new monitor kinds (`website`, `ssl`, `dns`) as new columns/rows in the existing service-alert tables; reuse the proven 5-minute poll + 2-poll all-clear streak logic, per-service backoff. New **Monitors** tab on the Service Alerts page with the same form/dialog styling.
- **Safety:** Existing RSS/DownDetector monitor rows untouched; new kinds default off until a monitor is created. Same bounded poller budget.

### 4. Alerting & routing upgrade (PLAN-013 #8 subset)
- **Approach:** Add severity classification and webhook delivery to existing alert rows (`severity` default 'info' preserves current rendering); new `POST /api/alert-webhooks` registration + outbound POST worker on the existing poller tick. Alert→ticket deep link on the banner/detail views.
- **Safety:** Additive fields default to current behavior; no existing consumers changed.

### 5. AI risk-classified actions — provider-agnostic variant (PLAN-013 #7, decoupled from Bedrock)
- **Approach:** Reuse the existing OpenAI-compatible inference provider (env-configured, already deployed; cheap-model config from PLAN-008). New risk-tier table + approval dialog in ticket detail: AI-suggested actions are executed only after human approval; critical tiers blocked. Audit rows written to a new `AiActionAudit` table.
- **Safety:** Additive UI + audit table; inference engine untouched (same provider interface). Works with any OpenAI-compatible endpoint — no AWS.
- **Note:** The Bedrock RAG knowledge base itself (PLAN-011) remains AWS-gated and is excluded; this phase deliberately uses the current inference stack instead.

### 6. SSO — SAML/OIDC login path (PLAN-013 #6, PLAN-002 extension)
- **Approach:** Env-configured IdP via lightweight SAML/OIDC exchange (`samlify` / `openid-client`) behind a new `/api/auth/sso/*` route group; SSO button on the Login page shown only when `SSO_ENABLED=true`. Existing JWT + password + MFA paths fully preserved as fallback.
- **Safety:** Feature-gated; zero change to current auth flow when disabled (default). JWT issuance reuses the existing session-auth middleware.

### 7. Passkey (WebAuthn) login (PLAN-002)
- **Approach:** Additive `Credential` table + `/api/auth/webauthn/*` routes (registration/attestation/assertion) using the `@simplewebauthn/server` library; "Sign in with passkey" button on the existing login page. Falls back to existing login when no credential exists.
- **Safety:** Fully additive; depends only on PLAN-001's already-implemented session/MFA flow.

### 8. Outlook add-in backend + manifest (PLAN-012)
- **Approach:** Implement the planned `POST /api/outlook-addin/tickets` batch endpoint reusing `emailToTicket`/`createTicketFromEmail` (PLAN-009 code already in production); ship the Office Web Add-in manifest + taskpane as static assets. Sideload for internal rollout.
- **Safety:** New endpoint only; existing email-connector pipeline unchanged; internetMessageId dedup preserves idempotency.

### 9. Email connector Phase 5 — M365 Graph transport (PLAN-009)
- **Approach:** Add a Graph transport alongside the existing IMAP path behind the same `EmailConnectorConfig` UI variant (PLAN-009 already reserved the form); OAuth 2.0 client-id/secret via env. Poller selects transport per connector row; IMAP connectors keep working.
- **Safety:** Transport-selection is additive; legacy IMAP untouched; default off until an M365 connector is configured.

### 10. Mobile backend enablement (PLAN-004 Phase 1 subset)
- **Approach:** Additive endpoints only: device registration (`/api/push/devices`), token storage, sync markers (`updatedAt`-cursor fields on existing list endpoints, no query changes), attachment upload already exists. Push token endpoints are inert until a mobile client registers.
- **Safety:** New tables + new endpoints; all existing endpoints byte-identical in response shape.
- **Note:** Native app builds + store publishing are separate later steps (need mobile toolchains, not AWS); include only backend enablement in this "now" scope.

### 11. SOC 2 non-AWS hardening subset (PLAN-007)
- **Approach:** Items with no AWS dependency: password-hash review (argon2id via `argon2` package with rehash-on-login), JWT 15-min expiry + refresh-token rotation behind existing session middleware, structured audit-log table + writer, Kumo encryption-at-rest already present (kumoCrypto), local CI scanners (gitleaks/Trivy) wired into the existing startup/boot checks.
- **Safety:** Hash upgrade uses rehash-on-login (no forced reset); token rotation uses new refresh endpoint while old tokens remain valid until expiry (grace window), so no one is logged out.

### 12. UI/UX modernization pass (PLAN-013 #9)
- **Approach:** Theme-preserving, CSS-first polish: filter chips on Tickets/Clients lists (client-side over existing endpoints), bulk actions on the ticket list (batch endpoint reusing existing update route), skeleton loaders, density toggle, empty states, keyboard shortcut `T` = new ticket, WCAG AA contrast fixes, responsive table→card transforms on mobile. No framework or data-flow changes.
- **Safety:** Pure frontend; API untouched; each item lands behind existing patterns and can be reverted file-by-file.

---

## ❌ Excluded (with reason)

| Feature | Reason |
|---|---|
| AWS dev/prod split & sync (PLAN-010) | Direct AWS dependency |
| Bedrock agentic RAG assistant (PLAN-011) | Direct AWS dependency (Bedrock) |
| Device agents / RMM fleet, patch management, sensors, remote tools (PLAN-013 #6 RMM line) | Planned to follow PLAN-010 infra topology; large new product line, breaking-risk on the current single-server topology |
| Full multi-tenant isolation / RLS (PLAN-003 Steps 2–3) | Touches every query — high risk of breaking the running app; deferred until isolated rollout is planned |
| Customer portal with tenant-wide access (PLAN-013 #3) | Depends on PLAN-003 tenant scoping; deferred (a company-scoped portal could be revisited later) |
| Mobile store publishing / app builds (PLAN-004 later phases) | Requires mobile toolchains + signing, not AWS, but outside "deploy now" single-server scope |
| SOC 2 items requiring AWS (cloud infra, WAF, external pen-test coordination) | AWS/third-party dependent |

## Tradeoffs
- No new infrastructure: everything rides the existing Express + Prisma + poller patterns and the existing boot pipeline.
- Poller budget unchanged: new monitor kinds share the existing 5-minute tick with per-service backoff.
- All additions are gated or default-off so a broken item can be disabled without reverting.

## Verification
- Boot pipeline + typecheck baselines (api 176 / web 17) must remain green after each item; `verify-post-change` per item.
- E2E: quote→invoice round trip; webhook fires on alert transition; SSO round-trip with JWT fallback still working; passkey registration/assertion; M365 connector polls once configured; existing IMAP connectors unaffected.
