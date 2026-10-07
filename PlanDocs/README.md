# PlanDocs — Plan Registry & Implementation Sequence

Central registry of every plan created or requested during the C7NTAX project,
plus the order they are to be executed in. Each plan has a unique **Plan ID** for
easy reference in implementation work, commits, and future updates. Copies live
here; the original files remain in place at their `Source` paths.

**Indexed:** 2026-08-18
**Re-sequenced:** 2026-10-06 — statuses re-verified against the codebase, and the
execution order rebuilt around what is actually shipped (see *Why the order
changed* at the end). Each plan document carries the same decision in a
`> **Sequence:**` block at the top of its body.

---

## 1. Implementation sequence

Legend: ✅ complete · 🟡 partial (in the codebase now) · ⬜ not started · ⏸ deferred by decision · ⏭ superseded / folded

| Order | Plan | Title | Wave | Status | What is actually left |
|---|---|---|---|---|---|
| **W0** | **PLAN-018** | **Dependency & application security remediation (CVE review)** | **W0 — pre-deployment blocker** | ✅ Complete | **Applied:** every application finding closed in code — invoice escaping, config/reserved-key guard, webhook secret stripping, the permission matrix across 322 routes with a route-guard check that fails the build, company scoping, the outbound-request policy (A5/A10) with an egress log, no sign-in token in any URL, and the dependency wave: **128 advisories → 4, none in the production closure** (was 21), critical 2 → 0. Multi-role personas drive the verification. **Gated in CI:** guard:routes, both typechecks, guard:deps (the audit baseline), gitleaks, trivy. **Left:** the four accepted advisories carry their reasons in security/audit-baseline.json; grouped update PRs (Renovate/Dependabot) are a repository setting, not code |
| 1 | PLAN-017 | Microsoft 365 OAuth app: build & deploy | W1 — finish the foundation | ⬜ runbook complete, execution pending | Tenant-side only: register the app, consent `Mail.ReadWrite`, scope it to the mailbox, test + enable the connector |
| 2 | PLAN-001 | Session-based authentication & permissions | W1 | ✅ Phase 1 shipped (2026.10.7.001) | **Done:** `sessionAuth` mounted, httpOnly cookie sessions with CSRF, idle timeout + the "Stay signed in" extension, the `?reason=` banner, one-live-session, and the exempt test account (`AUTH_TEST_BYPASS`) reporting `timeoutMinutes: 0`. Verified 34/34. **Left:** refresh rotation for app sessions (the token flow the Electron client uses), and the decision to retire the legacy JWT path once nothing needs it |
| 3 | PLAN-002 | Passkey authentication (+ SSO stage) | W1 | 🟢 management shipped (2026.10.7.002) | **Done:** credential matching by assertion id, device labels, `lastUsedAt`, the owner-scoped credential API, the Settings manager and the login-page passkey button (a real WebAuthn ceremony verified through a CDP virtual authenticator). **Left by decision:** per-role passkey policy, SAML, and moving the challenge store to a table before more than one replica |
| 4 | PLAN-015 | Feature backlog — UI, billing, Kumo, integrations | W2 — revenue & daily ops | 🟢 Phase A complete; Phase B complete except SMS | **Done:** Phase A #1–#3 (agreements + time engine, expenses, bill-through batch invoicing) and Phase B #4–#12 (per-user dashboard, board tile arrangement, Kumo audit trail, MFA QR-screenshot enrolment, Outage Board + social source, CloudConnect live statuses, report writer + Client Value Report, AI KB auto-generation, M365 inactivity + offboarding). **Left:** #13 SMS, blocked on the provider decision recorded in PLAN-016's decision table |
| 5 | PLAN-013 | Competitive review & modernization | W2 | 🟡 quotes + monitors shipped, portal/AI/UX not | #3 customer portal, #5 billing UI completion, #7 AI action layer + MCP (→ PLAN-011), #8 hardening, #9 UI/UX pass, #10 RMM gate (→ PLAN-014) |
| 6 | PLAN-016 | Azure dev/prod split & sync (decision record) | W3 — platform & compliance | 🟡 package built and validated, no deployment yet — **hard stop without a subscription** | **In-repo now:** the container image (API + SPA in one), Bicep for the platform (VNet, Postgres, Key Vault, ACR, Container Apps), the preflight + `deploy-env.ps1` push tool, the deploy workflow (dev automatic, prod on dispatch) and the security gate, plus the Prisma migration baseline the plan required. **Left:** the subscription-side setup (runbook in `infra/README.md`), the first deployment, and the ingress module — Application Gateway v2 with the two listeners, then Front Door + WAF + DDoS before production. **This step's decision table (12 items) is in the plan header** |
| 7 | PLAN-007 | SOC 2 readiness (38 controls) | W3 | ⬜ code-side groundwork only | Code controls (SC-03/04/05/06/08/09/10/11/12, PI-01/03) now; AV/CF/PR/OR controls on the chosen cloud. The Kumo audit trail (2026.10.7.007) closed the shared-credential accountability gap it named |
| 8 | PLAN-011 | Bedrock agentic RAG AI assistant (+ action layer, MCP) | W4 — intelligence | ⬜ integration seam exists | All 8 phases + phase 9 (risk-classified action layer + MCP server moved here from PLAN-013 #7). `llmJsonCompletion()` (2026.10.7.012) is a reusable provider seam this can build on |
| 9 | PLAN-012 | Outlook add-in: email-to-ticket | W5 — client surfaces | 🟢 add-in built and verified in-repo (2026.10.7.015) | **Done:** `apps/outlook-addin/` (manifest, taskpane, command file, icons, README), served at `/addin` from the API origin with a tailored CSP, selection logic (multi-select with a single-message fallback), board selector, per-message results, and the endpoint returning them. **Left, both decisions:** `POST /api/auth/office-sso` needs the PLAN-017 registration; AppSource submission needs a Partner Center account (the internal admin-center path needs none) |
| 10 | PLAN-004 | Native mobile applications | W5 | ⬜ PWA baseline only | Store apps (or a decision to stay PWA-only), offline sync, push, mobile UX |
| 11 | PLAN-005 | Native desktop clients (Windows/Linux/macOS) | W5 | 🟡 Windows shell shipped | macOS/Linux targets, signing/notarisation, auto-update, CI perf budgets |
| 12 | PLAN-014 | C7NTRL RMM product line & PSA integration | W6 — partner integration | ⬜ no PSA-side endpoints yet | The `/api/rmm/*` contract (device/tenant sync, HMAC alert webhook, compliance display, patch approval, device deep-link), each gated on a C7NTRL phase |
| — | PLAN-006 | Native desktop — open-source edition | folded into PLAN-005 | ⏭ superseded in practice | The shipped toolchain (Electron + electron-builder + GitHub Actions) is already OSS; keep only as the constraint list if a fully self-hosted CI is required |
| — | PLAN-010 | AWS dev/prod split & sync | not scheduled | ⏭ superseded by PLAN-016 (Azure recommendation) | Keep as the AWS decision record / fallback |
| — | PLAN-008 | Token savings — 10 options | closed | ✅ complete (2026-08-14) | Nothing; keep the rollback table |
| — | PLAN-003 | Multi-tenant architecture | **deferred by decision** | 🟡 Step 1 only | Steps 2–3 (tenant middleware, full isolation/RLS). Nothing else in the sequence may wait on it |

### 1.1 Waves

| Wave | Theme | Plans | Why this wave |
|---|---|---|---|
| **W0** | **Security & exposure** | 018 | Not a feature wave: these are defects in what is already shipped. Two critical authorization gaps and an XSS in the invoice renderer mean any authenticated account — including a client contact — reaches every company's data, and nothing here is fixed by the cloud split. It also has to land *before* PLAN-016, because that plan is the first time the API is reachable from the internet, and it upgrades the Electron runtime already installed on user machines |
| **W1** | Finish the half-built foundation | 017, 001, 002 | Three things are *nearly* done and currently deliver nothing: the Microsoft 365 go-live (code shipped, tenant setup pending), session auth (models + middleware exist, never mounted) and identity (passkeys work, surrounding flows do not). Cheap to close, and W2/W3 features reuse them |
| **W2** | Revenue & daily operations | 015, 013 | The PSA money path is the largest functional gap left (agreements, overtime, expenses, batch invoicing) and the portal/UI work needs no cloud migration. PLAN-013 #9 UI/UX is deliberately parallel-safe |
| **W3** | Platform & compliance | 016, 007 | Everything hosting-related is blocked on a real dev/prod split; SOC 2's infrastructure controls (and its CI scanners) land on top of that. The *code-side* SOC 2 controls may be pulled forward into W2 |
| **W4** | Intelligence | 011 | The RAG assistant needs the private network, data export and hosting from W3 (Bedrock on AWS, or Azure OpenAI + AI Search on Azure) |
| **W5** | Client surfaces | 012, 004, 005 | Add-in, mobile and desktop all consume APIs that should be stable first; the add-in additionally wants the identity work from W1 |
| **W6** | Partner integration | 014 | Fully gated on C7NTRL phases in the other repository — nothing here can start early |

### 1.2 Dependency notes that matter

- **Multi-tenant is deferred, so its dependants need substitutes.** The customer
  portal (PLAN-013 #3) and SSO scope by **company** (`User.companyId` /
  `Contact.companyId`), which already exists; PLAN-011 phase 7 drops the
  `tenant_id` vector filter until PLAN-003 lands. PLAN-013 #8's "RLS enforcement
  pass" is reduced to company-scoped query review.
- **Azure vs AWS is unresolved** (PLAN-016 §15 is advisory). The order above
  assumes Azure is confirmed; if AWS wins, PLAN-016 ↔ PLAN-010 swap and PLAN-011
  returns to Bedrock-as-written. Either way PLAN-016's CI/CD gap must be fixed.
- **PLAN-012 and PLAN-009 share the ingest path.** The connector (done) already
  provides deduction, threading, dedup and ticket creation, so the add-in is
  mostly transport + identity + packaging.
- **PLAN-005's auto-update** wants a release host, which arrives with PLAN-016.
- **Schema changes and the boot pipeline:** PLAN-008 option 4 skips
  `prisma generate`/`db push` when `startup/.schema.sha256` is unchanged, so any
  plan that edits `schema.prisma` (PLAN-001, PLAN-002, PLAN-015, PLAN-011) must
  let that hash re-sync.

### 1.3 Evidence basis

Statuses were verified on **2026-10-06** by inspecting the repository, not by
reading the plans: `apps/api/src/routes/*.ts`, `apps/api/src/middleware/*`,
`apps/api/src/services/*`, `apps/api/prisma/schema.prisma`,
`apps/web/src/{App.tsx,pages,public}`, `apps/desktop/*`, `packages/*`,
`.github/workflows/*` and `scripts/*`. Where a plan's own status line disagreed
with the code, the code won and the line was corrected.

---

## 2. Registry

| Plan ID | Title | File | Source (original) | Created | Status |
|---|---|---|---|---|---|
| PLAN-001 | Session-Based Authentication & Permissions Implementation Plan | `PLAN-001-Session-Auth.md` | `docs/SESSION_AUTH_PLAN.md` | 2026-08-10 | 🟡 Partial (not wired) |
| PLAN-002 | Passkey Authentication Implementation Plan | `PLAN-002-Passkey-Auth.md` | `PassKey.md` | 2026-08-10 | 🟡 Partial |
| PLAN-003 | Multi-Tenant Architecture Implementation Plan | `PLAN-003-Multi-Tenant.md` | `MultiTenant.md` | 2026-08-12 | ⏸ Deferred (Step 1 only) |
| PLAN-004 | Native Mobile Applications Plan | `PLAN-004-Native-Mobile.md` | `mobile-native-plan.md` | 2026-08-12 | ⬜ Not started (PWA baseline) |
| PLAN-005 | Native Desktop Clients Plan (Windows / Linux / macOS) | `PLAN-005-Native-Desktop.md` | `native-desktop-plan.md` | 2026-08-12 | 🟡 Partial (Windows) |
| PLAN-006 | Native Desktop Clients Plan — Open-Source Edition | `PLAN-006-Native-Desktop-OSS.md` | `native-desktop-oss-plan.md` | 2026-08-12 | ⏭ Folded into PLAN-005 |
| PLAN-007 | C7NTAX SOC 2 Readiness Plan | `PLAN-007-SOC2-Compliance.md` | `SOC2.Compliance.md` | 2026-08-14 | ⬜ Not started |
| PLAN-008 | Token Savings — 10 Options Implementation & Rollback Guide | `PLAN-008-Token-Savings.md` | `TOKEN-SAVINGS.md` | 2026-08-14 | ✅ Complete |
| PLAN-009 | Monitored Mailbox Email-to-Ticket Connector Plan | `PLAN-009-Email-to-Ticket-Connector.md` | `PLAN-Monitored-Mailbox-Email-to-Ticket-Connector.md` | 2026-08-18 | ✅ Complete (phase 7 optional item open) |
| PLAN-010 | AWS Dev/Prod Split & Sync Plan | `PLAN-010-AWS-Dev-Prod-Split-Sync.md` | `PLAN-AWS-Dev-Prod-Split-and-Sync.md` | 2026-08-18 | ⏭ Superseded by PLAN-016 (alternate) |
| PLAN-011 | Bedrock Agentic RAG AI Assistant for PSA Plan | `PLAN-011-Bedrock-Agentic-RAG-AI-Assistant.md` | `PLAN-Bedrock-Agentic-RAG-AI-Assistant.md` | 2026-08-18 | ⬜ Not started |
| PLAN-012 | Outlook Add-in Email-to-Ticket Generator Plan | `PLAN-012-Outlook-Addin-Email-to-Ticket.md` | `PLAN-Outlook-Addin-Email-to-Ticket.md` | 2026-08-18 | 🟡 Partial |
| PLAN-013 | C7NTAX Competitive Review & Modernization Plan | `PLAN-013-Competitive-Review-and-Modernization.md` | `PLAN-C7NTAX-Competitive-Review-and-Modernization.md` | 2026-08-18 | 🟡 Partial |
| PLAN-014 | C7NTRL RMM Product Line & PSA Integration Plan | `PLAN-014-C7NTRL-RMM-Product-Line-and-PSA-Integration.md` | `PLAN-C7NTRL-RMM-Product-Line-and-PSA-Integration.md` | 2026-08-18 | ⬜ Not started (external gate) |
| PLAN-015 | C7NTAX Feature Backlog — UI, Billing, Kumo, Integrations & Infrastructure | `PLAN-015-Feature-Backlog-UI-Billing-Kumo-Integrations.md` | `PLAN-C7NTAX-Feature-Backlog-UI-Billing-Kumo-Integrations.md` | 2026-08-18 | 🟡 Partial (Phase A untouched) |
| PLAN-016 | Azure Dev/Prod Split & Sync Plan | `PLAN-016-Azure-Dev-Prod-Split-Sync.md` | `PLAN-Azure-Dev-Prod-Split-and-Sync.md` | 2026-10-05 | ⬜ Not started (decision advisory) |
| PLAN-017 | Microsoft 365 OAuth app: build & deploy | `PLAN-017-Microsoft-365-OAuth-App-Setup.md` | authored in `PlanDocs/` | 2026-10-06 | ⬜ Ready to execute (runbook) |
| PLAN-018 | Dependency & application security remediation (CVE review) | `PLAN-018-Dependency-and-Application-Security-Remediation.md` | authored in `PlanDocs/` | 2026-10-06 | 🟠 Partly applied — Phase 0 status table inside the plan |

---

## 3. Why the order changed

The original order was **registration order** (PLAN-001 … PLAN-017 as they were
written). Re-verifying against the codebase showed that order is no longer
useful, for three reasons:

1. **Several "pending" plans are substantially shipped already.** PLAN-009 was
   marked "Proposed (no implementation yet)" and is now the most complete feature
   in the product (four transports, attribution, health, UI). PLAN-013's #1/#2
   (quotes + quote→invoice) and #4 (website/SSL/DNS monitors) are live; PLAN-015's
   Phase B landed piecemeal; PLAN-005 already ships a Windows Electron build;
   PLAN-002's passkeys sign users in today. Leaving them at their old positions
   hid both the work done and the small amount actually left.
2. **The half-finished items were the cheapest wins.** Session auth is written
   but never mounted, passkeys lack their surrounding flows, and the Microsoft 365
   go-live needs no code at all. These now lead the sequence because they close
   open loops rather than opening new ones.
3. **Infrastructure became the real gate.** PLAN-016 (or PLAN-010) blocks the
   SOC 2 controls *and* all of PLAN-011, so it moved ahead of both, while the
   revenue/UX work that needs no cloud migration moved ahead of it.

**Multi-tenant (PLAN-003) is deferred by decision** and removed from the active
sequence. Because several plans cited it as a prerequisite, each of those now
names the substitute it will use instead (see §1.2).

**Wave 0 (PLAN-018) was added after the re-sequence, not during it.** A security
review of the shipped code and its dependencies found defects that are independent
of every plan above: two routers reachable by any authenticated account with no
permission gate (so a client contact reads every company's data), an XSS in the
invoice renderer, a role-escalation path through `PATCH /api/users`, an
unvalidated OIDC `state` that provisions unknown identities as admins, and 1
critical + 16 high vulnerable dependency groups inside code we ship — including
the `electron` runtime already installed on user machines. None of these are
fixed by any other plan, and PLAN-016 is the first time the API becomes
reachable from the internet, so they are positioned ahead of it rather than
slotted into a feature wave.

**What has since been applied from Wave 0 (2026-10-06):** the invoice XSS escaping,
the config-dump and reserved-key guard, webhook-secret stripping, the
role/permission guards on user management, fail-closed auth with boot assertions on
the JWT secret, CSPRNG MFA codes plus a per-endpoint credential limiter, OIDC state
validation with inactive/read-only provisioning, removal of the two unused
CVE-carrying packages and the low-risk version pins (128 → 99 advisory instances).
The items deliberately left open all need a decision or a wider change — the
per-router permission matrix and company scoping, the egress host policy, the
`?token=` removal, and the `nodemailer`/`vite`/`electron` majors — and each is
marked in the plan's Phase 0 status table.

---

## 4. Conventions

- **ID format:** `PLAN-NNN` assigned chronologically by the plan document's
  original creation date. IDs are stable and never reused — re-sequencing changes
  the *order*, never an ID or a filename.
- **Ordering:** the sequence lives in this file and in the `> **Sequence:**` block
  at the top of each plan document. Positions are `n of 12` for plans in the
  active sequence.
- **Updates:** when a plan changes, update its document (keep the header
  `Plan ID` block and its `> **Sequence:**` block current) and its row here.
  Prefer updating the source file first, then re-copy here.
- **New plans:** copy into `PlanDocs/` as `PLAN-NNN-<slug>.md` with the next
  sequential ID, add the header block and a `> **Sequence:**` block, and add a
  row to the registry plus a position in the sequence.
- **Dependency-ordered items (mandatory for all plans):** every plan must list
  its implementation items in dependency order (prerequisites first) and add a
  `Depends on:` / `Risk if skipped:` note to every dependent or reordered item.
  Preserve original item names, paths, and details when renumbering.
- **Status vocabulary:** ✅ complete · 🟡 partial · ⬜ not started · ⏸ deferred
  (deliberate) · ⏭ superseded/folded. A status is only ever claimed with file
  evidence in the plan's `> **Sequence:**` block; text in a plan or a BuildNotes
  entry is not evidence that code exists.

## 5. Coverage note

Search performed 2026-08-18 across the repository for plan documents; all
registered above, and no requested plan was found without a document. Reviewed
again 2026-10-06 for sequencing only — no new plan documents were authored, and
no plan was deleted or renamed.

