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
**Extended:** 2026-10-08 — PLAN-023 filed (a UI decision with a mockup; not scheduled — see the
`—` rows below). **Extended again 2026-10-08:** PLAN-024 filed and then built (2026.10.8.016), and
**PLAN-025** filed — an MCP server for C7NTAX, which takes over PLAN-011's phase 9 and answers
PLAN-013 #7. PLAN-025 is a plan for a capability, so it is not in the wave order.
**Extended a third time 2026-10-08:** **PLAN-026** filed — model control of the whole application,
within the prompting user's permissions. Its **Phase 0 was not optional**: approving an AI action
applied nothing, so it closed a hole in what had already shipped — **built the same day**
(BuildNotes 2026.10.8.028; the executor, the intent record, and the two functions the operator's
sentence needed). Also a capability, so it is not in the wave order.
**Extended a fourth time 2026-10-08:** **PLAN-027** filed with its mockup — CloudConnect merged into
C7NC. A layout and naming change: no API, schema or permission moves, and every old route (including
`/api/cloudconnect`) keeps working, so it is not in the wave order. **Phases 0–5 built** the same
day (BuildNotes 2026.10.8.026/**.027**).
**Extended a fifth time 2026-10-08:** **PLAN-028** filed — a **console and CLI** to run commands against
the application (`ticket show 1001`, `report run 12 --out qbr.csv`). A capability, so not in the wave
order: one grammar in `packages/shared` shared by an in-app panel, a `c7ntax` CLI and PLAN-025's MCP
tools, executed through the real routes, with PowerShell-standard completion specified in §5.1 and a
command catalogue of ~230 grouped commands in §12. **Its catalogue is a projection of PLAN-026's
manifest**, which is the one thing it waits on. The header icon (inert, `Console (coming soon)`) is in
place — BuildNotes **2026.10.8.029**.
**Extended a sixth time 2026-10-08:** **PLAN-029** filed — a register of the work that was **found and
deliberately not done** during the 2026-10-08 sessions: the committed snapshot's secrets (§1), the API's
emitted tree versus its `start` script (§2), the unmounted `tenants` router (§3), the gap in
`guard:console` that let a wrong column descriptor live in the catalogue (§4), and five smaller items
(§5). Not a capability and not in the wave order: every entry is either something that would break
something else if fixed casually, or a decision the operator owns.

---

## 1. Implementation sequence

Legend: ✅ complete · 🟡 partial (in the codebase now) · ⬜ not started · ⏸ deferred by decision · ⏭ superseded / folded

| Order | Plan | Title | Wave | Status | What is actually left |
|---|---|---|---|---|---|
| **W0** | **PLAN-018** | **Dependency & application security remediation (CVE review)** | **W0 — pre-deployment blocker** | ✅ Complete | **Applied:** every application finding closed in code — invoice escaping, config/reserved-key guard, webhook secret stripping, the permission matrix across 322 routes with a route-guard check that fails the build, company scoping, the outbound-request policy (A5/A10) with an egress log, no sign-in token in any URL, and the dependency wave: **128 advisories → 4, none in the production closure** (was 21), critical 2 → 0. Multi-role personas drive the verification. **Gated in CI:** guard:routes, both typechecks, guard:deps (the audit baseline), gitleaks, trivy. **Left:** the four accepted advisories carry their reasons in security/audit-baseline.json; grouped update PRs (Renovate/Dependabot) are a repository setting, not code |
| 1 | PLAN-017 | Microsoft 365 OAuth app: build & deploy | W1 — finish the foundation | ⬜ runbook complete, **now scripted** | Tenant-side only: register the app, consent `Mail.ReadWrite`, scope it to the mailbox, test + enable the connector. **`O365/New-C7NTAXMailboxApp.ps1` does the first two over Graph REST** (PLAN-022 §3) — re-run it, or follow §4/§5 by hand |
| 2 | PLAN-001 | Session-based authentication & permissions | W1 | ✅ Phase 1 shipped (2026.10.7.001) | **Done:** `sessionAuth` mounted, httpOnly cookie sessions with CSRF, idle timeout + the "Stay signed in" extension, the `?reason=` banner, one-live-session, and the exempt test account (`AUTH_TEST_BYPASS`) reporting `timeoutMinutes: 0`. Verified 34/34. **Left:** refresh rotation for app sessions (the token flow the Electron client uses), and the decision to retire the legacy JWT path once nothing needs it |
| 3 | PLAN-002 | Passkey authentication (+ SSO stage) | W1 | 🟢 management shipped (2026.10.7.002) | **Done:** credential matching by assertion id, device labels, `lastUsedAt`, the owner-scoped credential API, the Settings manager and the login-page passkey button (a real WebAuthn ceremony verified through a CDP virtual authenticator). **Left by decision:** per-role passkey policy, SAML, and moving the challenge store to a table before more than one replica |
| 4 | PLAN-015 | Feature backlog — UI, billing, Kumo, integrations | W2 — revenue & daily ops | 🟢 Phase A complete; Phase B complete except SMS | **Done:** Phase A #1–#3 (agreements + time engine, expenses, bill-through batch invoicing) and Phase B #4–#12 (per-user dashboard, board tile arrangement, Kumo audit trail, MFA QR-screenshot enrolment, Outage Board + social source, CloudConnect live statuses, report writer + Client Value Report, AI KB auto-generation, M365 inactivity + offboarding). **Left:** #13 SMS, blocked on the provider decision recorded in PLAN-016's decision table |
| 5 | PLAN-013 | Competitive review & modernization | W2 | 🟢 quoted items shipped; #8 hardening verified, #9 UI pass outstanding | #7 AI action layer + MCP (→ PLAN-011), #9 UI/UX pass (chips, bulk actions, skeletons, density, empty states, shortcuts), #8's RLS pass (waits on PLAN-003), #10 RMM gate (→ PLAN-014) |
| 6 | PLAN-016 | Azure dev/prod split & sync (decision record) | W3 — platform & compliance | 🟡 package built and validated, no deployment yet — **hard stop without a subscription** | **In-repo now:** the container image (API + SPA in one), Bicep for the platform (VNet, Postgres, Key Vault, ACR, Container Apps), the preflight + `deploy-env.ps1` push tool (`-Create` to create an environment, `-PromoteFrom dev` to promote), the deploy workflow (dev automatic on push; a prod dispatch **promotes the tag dev is running**, copying the image between the two registries) and the security gate, plus the Prisma migration baseline the plan required. **§16 is the environment model and the promotion path** — sync to GitHub → push to dev → push to production. **Left:** the subscription-side setup (runbook in `infra/README.md`), the first deployment of both environments, and the ingress module — Application Gateway v2 with the two listeners, then Front Door + WAF + DDoS before production. **This step's decision table (12 items) is in the plan header** |
| 7 | PLAN-007 | SOC 2 readiness (38 controls) | W3 | ⬜ code-side groundwork only | Code controls (SC-03/04/05/06/08/09/10/11/12, PI-01/03) now; AV/CF/PR/OR controls on the chosen cloud. The Kumo audit trail (2026.10.7.007) closed the shared-credential accountability gap it named |
| 8 | PLAN-011 | Bedrock agentic RAG AI assistant (+ action layer, MCP) | W4 — intelligence | ⬜ integration seam exists | All 8 phases + phase 9 (risk-classified action layer + MCP server moved here from PLAN-013 #7). `llmJsonCompletion()` (2026.10.7.012) is a reusable provider seam this can build on |
| 9 | PLAN-012 | Outlook add-in: email-to-ticket | W5 — client surfaces | 🟢 add-in built and verified in-repo (2026.10.7.015) | **Done:** `apps/outlook-addin/` (manifest, taskpane, command file, icons, README), served at `/addin` from the API origin with a tailored CSP, selection logic (multi-select with a single-message fallback), board selector, per-message results, and the endpoint returning them. **Left, both decisions:** `POST /api/auth/office-sso` needs the PLAN-017 registration; AppSource submission needs a Partner Center account (the internal admin-center path needs none). **Distribution is now closed** by PLAN-022: the served manifest is generated for the requesting origin, and a per-user Windows installer plus the C7NC section make it installable — BuildNotes 2026.10.7.031 |
| 10 | PLAN-004 | Native mobile applications | W5 | ⬜ PWA baseline only | Store apps (or a decision to stay PWA-only), offline sync, push, mobile UX |
| 11 | PLAN-005 | Native desktop clients (Windows/Linux/macOS) | W5 | 🟡 Windows shell shipped | macOS/Linux targets, signing/notarisation, auto-update, CI perf budgets |
| 12 | PLAN-014 | C7NTRL RMM product line & PSA integration | W6 — partner integration | ⬜ no PSA-side endpoints yet | The `/api/rmm/*` contract (device/tenant sync, HMAC alert webhook, compliance display, patch approval, device deep-link), each gated on a C7NTRL phase |
| — | PLAN-006 | Native desktop — open-source edition | folded into PLAN-005 | ⏭ superseded in practice | The shipped toolchain (Electron + electron-builder + GitHub Actions) is already OSS; keep only as the constraint list if a fully self-hosted CI is required |
| — | PLAN-010 | AWS dev/prod split & sync | not scheduled | ⏭ superseded by PLAN-016 (Azure recommendation) | Keep as the AWS decision record / fallback |
| — | PLAN-008 | Token savings — 10 options | closed | ✅ complete (2026-08-14) | Nothing; keep the rollback table |
| — | PLAN-003 | Multi-tenant architecture | **deferred by decision** | 🟡 Step 1 only | Steps 2–3 (tenant middleware, full isolation/RLS). Nothing else in the sequence may wait on it |
| — | **PLAN-022** | **Outlook add-in packaging, distribution, and the C7NC section** | **overlay — packages PLAN-012 and points at PLAN-017** | ✅ **Built — BuildNotes 2026.10.7.031** | Started from three faults found by measuring rather than by reading the README: the served manifest still held `__ADDIN_HOST__` and could never load, the sideload registration was per-user and undocumented, and nothing in the application mentioned the add-in. §1 records all three. Adds a **generated** manifest, a per-user WiX MSI (`installer/`), three public `/addin` download routes with a JSON artifact descriptor, a new top-level **C7NC** nav section whose page installs it without administrator detail, and `O365/New-C7NTAXMailboxApp.ps1` — PLAN-017 §4/§5 as Graph REST instead of portal clicks. §4 lists thirteen decisions including two rejections (`util:XmlFile` URL rewriting, a build endpoint on the API) |
| — | **PLAN-020** | **Custom report designer (build / embed / buy)** | **overlay — advises on the Reporting designer** | ✅ **Built here — all six phases shipped (0–5 in 2026.10.7.026, phase 6 in 2026.10.7.027)** | Answers the question the Custom Reports landing page raises: **build a banded designer here on a JSON template document** — jsreport is **LGPL on the engine plus a commercial cap of 5 stored templates** and has **no banded WYSIWYG designer to adopt**, ReportBro is **AGPL or paid with a Python-only renderer**, and every other banded JS designer is commercial. §4 defines the document model, §5 costs the work honestly, §6 phases it with an exit condition each — and now records that every phase is in the product |
| — | **PLAN-023** | **Setting explanations behind a "Why" control** | **filed — a UI taste decision, not scheduled** | 📝 mockup + measurements, **not built** | The follow-on to the tab work in 2026.10.8.007: Portal settings is still the tallest tab because each of its sixteen fields prints its reasoning, so folding `detail` / `Changes:` / `Default` behind a `Why` control is worth **75%** of the height — measured in the mockup ([`docs/mockups/portal-settings-why-toggle.html`](../docs/mockups/portal-settings-why-toggle.html)) at **2,621 px → 695 px** scaled to sixteen fields, **1,770 px** with everything expanded. §3 names the trap: "Use the deployment's value" shares a row with the `Default …` line and must not hide behind the fold. `FieldCard` serves every settings screen, so it is all-or-nothing |
| — | **PLAN-025** | **C7NTAX as an MCP server** | **filed — a capability, not scheduled; phases 0–2 need nothing that is missing, phases 3+ want PLAN-016** | 📝 plan only, **nothing built** | The assistant's ten functions exposed to the AI clients technicians already use (Claude Desktop, VS Code/Copilot, Cursor, ChatGPT), behind the permission model that exists. Takes over **PLAN-011 phase 9** and answers **PLAN-013 #7**. §5 recommends API keys as bearer tokens first and OAuth 2.1 (RFC 9728 + resource indicators, CIMD over DCR) only when a hosted client is genuinely wanted; §6 keeps writes as proposals with **no approval tool**; §10 is five phases with a probe each (≈4 days for phases 0–2, ≈5 for the OAuth phase). §4 is a spec snapshot — **verified 2026-10-08 and to be re-verified before phase 2**, because the protocol was rewritten twice in twelve months and Claude follows an older authorization revision than the current one |
| — | **PLAN-026** | **Model control of C7NTAX (within the prompting user's permissions)** | **filed — Phase 0 is a fix, the rest is a capability; no external gate** | 🟢 **Phase 0 built** (BuildNotes **2026.10.8.028**): approving an AI action now **applies it** — one executor that re-enters the real route as the prompting user, `critical` never applied, an unknown payload kind fails rather than pretends, the intent row records `before`/`result`/`error`; plus `find_people` and `list_boards` and a contact/board-aware `propose_ticket`, so *"create a ticket for David Chen"* works end to end (probe `probe-ai-apply.mts`, 49 checks). **Phases 1, 2, 4, 5, 6, 7 not built** | "Control all aspects, not just ticket creation", bounded by "within the context of the logged in/connected user's permissions". Two findings from the code decide its shape: `POST /api/ai-actions/:id/decide` sets a status and **applies nothing** (no executor exists anywhere), and the operator's sentence is not expressible because no tool resolves a person and ticket creation needs a board. So: a **manifest of all 233 staff-facing mutating routes** (250 minus `auth`/`portal`/`push`) with a permission, a tier, a preview and an inverse per action, enforced by `guard:actions`; one executor that **re-enters the real route as the caller**; three modes per connection — read only / **ask** (default) / act; tier decides **who may skip the click, never who may do it**; `high` always asks, `critical` is proposal-only. §2.1 is the load-bearing wall: authority is the session's, re-read per request, never the model's or the connection's |
| — | **PLAN-027** | **Merging CloudConnect into C7NC** | **filed — a layout and naming change, blocks nothing** | 🟡 **Phases 0–5 built** (2026.10.8.026): the section, the hub, the four subsections, the redirects, the nav and the visible rename; **left:** the service-detail page, the API alias, the non-UI rename, the guard | CloudConnect (Administration, one page of five tabs, 79 KB) and C7NC (a two-item group) become **one top-level C7NC** with a hub landing page and four subsections — Services, AI models, Email, Companion apps — each a tab-style page, plus **a page per service**. The merge's real prize is FlexPoint, whose connection is configured in one section and whose ledger and invoices live in the other (§1). Measures the rename rather than guessing: **230 occurrences across 41 files** (web 99, docs 65, probes 31, api 25, shared 8), with `/api/cloudconnect`, the `CLOUDCONNECT_LIVE_STATUS_ENABLED` config key, a stored landing-page value and a Help walkthrough anchor all deliberately kept — no new permissions, and the hub shows only what you can open |
| — | **PLAN-028** | **The C7NTAX console and CLI — running commands against the application** | **filed — capability; reads need nothing new, writes want PLAN-026 Phase 1** | 🟢 **Phases 0–1 built, and phase 3 for reads** (BuildNotes 2026.10.8.038/.039/.041): the popup console, 85 read commands, completion, `guard:console`, `GET /api/console/catalog`, `/console` as a page with `?c=` links, and the `c7ntax` CLI on an API key | A command surface for the application: `ticket show 1001`, `invoice send 412`, `report run 12 --out qbr.csv` — **one grammar, three front ends** (the in-app panel/`/console`, a `c7ntax` CLI on an API key, and PLAN-025's MCP tools), parsed in `packages/shared`, executed by re-entering the real route as the caller, so there is **no new execution endpoint and no second authorization model**, and the one permission it does carry (`console:use`, added 2026.10.8.043 against D4's original answer) gates only *whether the surface is offered* — every command is still authorized by the route's own permission. **No schema change, no migration.** Completion is specified to PowerShell's standard (§5.1: `Tab` cycles, `Ctrl+Space` opens a described menu, `→` accepts inline history prediction, values complete from the API through a warm cache, `Tab` completes rather than moving focus) and generated from the catalogue, as `help` is. §12 is the deliverable the operator asked for: **401 commands in 16 groups** — console basics, session, tickets, boards/work, clients, billing, stock, Kumo, knowledge, reporting, monitoring, AI, integrations, administration, diagnostics — each with its permission and tier, derived from the real route surface (**437 declarations, 250 writes, 187 reads**; measured with the guard script's own enumeration). §12.17 lists what is deliberately absent (credentials, the customer portal, `critical` actions, pipes, impersonation). Load-bearing dependency: the catalogue is a **projection of PLAN-026's manifest**, never a second list | 📋 **Recommendation only, nothing applied** | Not work of its own: it sequences what is left into three tiers, names the exit condition for each step, and lists the ten decisions with their owners. Written after the W0–W2/W5-1 programme completed (BuildNotes 2026.10.7.017–.022). §3.1 recommends production flag values, §3.4 recommends deploying **dev first and running the battery against it**, §6 recommends a single battery runner and a primary-surfaces click-through |
| — | **PLAN-021** | **Application configuration — one registry, one screen, and the customer portal's section** | **overlay — replaces the settings surfaces that did not work** | ✅ **Built — BuildNotes 2026.10.7.029** | The measurement first: of the roughly thirty controls on System Settings, **exactly one was read by anything**, the session-timeout control on it wrote a key nothing read, and My Settings wrote two **instance-wide** keys as though they were personal. Every setting is now declared once in `packages/shared/src/appConfiguration.ts`, resolved *stored → environment → default* by `apps/api/src/services/appSettings.ts`, enforced by `apps/api/src/routes/configuration.ts` and **drawn from that same declaration**. Adds the Customer Portal section, a `/system/deployment` report of the facts only a deployment owns, and 78 probe assertions. §5 lists what was deliberately left unconfigurable — starting with the switches that decide whether authentication is enforced. **2026.10.7.030** moved the Outlook add-in switch to Client Apps & Notifications, made it govern the taskpane as well as the endpoint, and fixed a service-worker defect that cached a cross-origin 404 (§12) |

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
- **PLAN-011 phase 9 has split in two, and the first half is done.** The
  risk-classified action layer shipped with the assistant (2026.10.8.020); what
  remains of it is the **MCP server (PLAN-025)** and the **executor that makes an
  approved action apply (PLAN-026 Phase 0)** — neither of which needs PLAN-011's
  Bedrock/RAG phases. When PLAN-011 is picked up, phase 9 hands over to those two
  rather than being built twice, and its remaining phases stay behind the hosting
  work in W3.
- **PLAN-025's phases 3+ want PLAN-016.** A remote MCP endpoint needs the
  deployment's public origin, TLS and WAF; phases 0–2 (a local stdio server and a
  read-only tool surface) do not, which is why the plan is costed in two halves.
- **PLAN-026 is where PLAN-025's tool surface comes from, and it starts with a fix.**
  Its Phase 0 makes an approved AI action actually apply — nothing does today — and
  its manifest becomes the MCP tool list in PLAN-025 Phase 6. Neither blocks the
  other's first phases; both share that one. **PLAN-011 phase 9's action layer** is
  now PLAN-026 §6 plus the assistant that shipped.
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
| PLAN-019 | Remaining Work & Go-Live Sequencing (advisory overlay) | `PLAN-019-Remaining-Work-and-Go-Live-Sequencing.md` | authored in `PlanDocs/` | 2026-10-07 | 📋 Advice only — nothing applied |
| PLAN-020 | Custom Report Designer — build it here, embed jsreport, or buy | `PLAN-020-Custom-Report-Designer.md` | authored in `PlanDocs/` | 2026-10-07 | ✅ **Accepted and built — all six phases** (0–5 in BuildNotes 2026.10.7.026, phase 6 in 2026.10.7.027): a banded designer on a JSON template document, with the expression language and the layout engine in `packages/shared`, plus charts, sub-reports and running totals. **Nothing outstanding** |
| PLAN-021 | Application Configuration — one registry, one screen, and the customer portal's section | `PLAN-021-Application-Configuration-Registry.md` | authored in `PlanDocs/` | 2026-10-07 | ✅ **Built** (BuildNotes 2026.10.7.029): a declarative registry in `packages/shared`, resolution *stored → environment → default* in the API, validated writes, and screens generated from the declaration — plus the Customer Portal configuration section and per-client access. §5 records what was deliberately left unconfigurable. §8 lists five decisions taken no further |
| PLAN-022 | Outlook Add-in packaging, distribution, and the C7NC section | `PLAN-022-Outlook-Add-in-Packaging-and-Distribution.md` | authored in `PlanDocs/` | 2026-10-07 | ✅ **Built** (BuildNotes 2026.10.7.031): the served manifest is now **generated** for the requesting origin (it previously shipped a placeholder Office rejects), a per-user WiX MSI registers it in the user's own hive, three public `/addin` download routes serve it, a new top-level **C7NC** nav section installs it from inside the application, and `O365/` provisions the Entra app registration PLAN-017 describes by hand. **Left:** an installer built for the production origin, and the tenant-side run of the `O365` script |
| PLAN-023 | Setting explanations behind a "Why" control | `PLAN-023-Setting-Explanation-Why-Toggle.md` | authored in `PlanDocs/` | 2026-10-08 | 📝 **Filed, not built** — a UI taste decision with a measured mockup; see the `—` row in §1 |
| PLAN-024 | Boards as tabs on the Tickets screen | `PLAN-024-Tickets-Board-Tabs.md` | authored in `PlanDocs/` | 2026-10-08 | ✅ **Built** (BuildNotes 2026.10.8.016): one tab per board with its count plus *All Boards*, a band naming the board in view, the URL still the source of selection, and the whole thing behind `BOARD_TABS` in `apps/web/src/pages/Tickets.tsx` so one line restores the dropdown |
| PLAN-025 | C7NTAX as an MCP server | `PLAN-025-C7NTAX-MCP-Server.md` | authored in `PlanDocs/` | 2026-10-08 | 📝 **Plan only** — the assistant's function registry exposed over MCP to external AI clients. Takes over **PLAN-011 phase 9** and answers **PLAN-013 #7**; §9 lists the eight decisions to freeze (D1, authorization, is the gate) |
| PLAN-026 | Model control of C7NTAX within the prompting user's permissions | `PLAN-026-Model-Control-of-C7NTAX.md` | authored in `PlanDocs/` | 2026-10-08 | 🟢 **Phase 0 built** (BuildNotes **2026.10.8.028**) — the executor (`apps/api/src/services/ai/apply.ts`) applies an approved action by re-entering the real route as the prompting user, `critical` is never applied, an unknown payload kind fails rather than pretends, and the intent row records `before`/`result`/`error`/`appliedAt`. `find_people` + `list_boards` added and `propose_ticket` carries a contact and board, so the operator's own sentence works end to end; probe `probe-ai-apply.mts` **49 checks**. **Phases 1, 2, 4, 5, 6, 7 plan-only** — the manifest and `guard:actions`, the generic action tools, tiering waves B/C, `act` mode with caps and undo, MCP parity, and docs. Ten decisions to freeze in §12 |
| PLAN-027 | Merging CloudConnect into C7NC | `PLAN-027-Merging-CloudConnect-into-C7NC.md` | authored in `PlanDocs/` | 2026-10-08 | 🟢 **Phases 0–5 built** (BuildNotes 2026.10.8.026/**.027**) — the C7NC section (five tabs, a route each), the hub, the redirects, the nav and its permission, and the visible rename. **Left:** the service-detail page, the `/api/c7nc` mount with the old path as an alias, the non-UI rename (api strings, `docs/API.md`, `openapi.yaml`, `api-operations.json`, probes), and the guard that fails the build when `CloudConnect` reappears. **Two holes found and closed:** a stored landing page of `/cloudconnect` would have silently reset (now `resolveLandingPagePath()` in `packages/shared`, 11 assertions), and the mockup's card spacing was missing classes. Mockup: `docs/mockups/c7nc-merged-hub.html` |
| PLAN-028 | The C7NTAX console and CLI — running commands against the application | `PLAN-028-C7NTAX-Console-and-CLI.md` | authored in `PlanDocs/` | 2026-10-08 | 🟢 **Phases 0–1 built, and phase 3 for reads** (BuildNotes 2026.10.8.038/**.039**/**.041**/**.043**/**.045**/**.047**) — the header icon opens a **popup console** (the operator's frame, not §10's drawer) and `/console` is the same component with `?c=` deep links; `packages/shared/src/console/` holds the grammar, the catalogue, the parser and the **PowerShell-grade completion** of §5.1 (`Tab` cycles to the common prefix, `Ctrl+Space` opens the described menu, `→` accepts inline history prediction, values complete from the API through a warm cache). **85 read commands in 15 groups**, every path, permission and flag verified against the routes by `pnpm guard:console` (a Security Gate step), plus `GET /api/console/catalog[/:name]` serving the same catalogue permission-filtered. **`apps/cli`** — `c7ntax` on an API key, `login`/`context`/`help`/`_complete`, generated bash/zsh/pwsh completion, and exit codes 0/1/2/3/5/6 — proves the grammar is genuinely shared rather than merely reused. **`console:use`** is the one permission the plan gained, against D4's original answer: the operator's requirement that the *icon not be drawn* without permission is not a question per-command permissions can answer, so the surface carries one and each command keeps its own on top (`User.deniedPermissions`, `Company.consoleEnabled`, the Workspace switch). Output reads two ways — **Basic/Advanced** — the record rendering is labelled rather than dumped, the popup resizes and remembers its size, and the CLI needs nothing beyond `apiKeys.ts`. **Writes are refused with §7's message**, `CONSOLE_ENABLED` turns the whole feature off, and the probes are 37 (CLI, as a subprocess against the live API) + 55 (grammar/completion/ambiguity) + 18 (live catalogue) + 24 (the four gates). **Left:** phase 2 writes (behind PLAN-026's manifest), `--csv`/`--out`/`script`, the assistant cross-links, the remaining catalogue entries |
| PLAN-029 | Deferred work and known risks — the things that must not be fixed casually | `PLAN-029-Deferred-Work-and-Known-Risks.md` | authored in `PlanDocs/` | 2026-10-08 | 📋 **A register, not work.** Every entry was found on 2026-10-08 and left deliberately: **§1 the committed snapshot carries secrets** (plaintext connector credentials in `integrations.json`, the vault's ciphertext whose dev key is a constant in the source, password hashes and MFA seeds in `users.json`) — deferred because redacting the capture without teaching `seed-from-snapshots.ts` to substitute placeholders breaks the re-seed, and the remediation includes **rotating** the exposed credentials; **§2 `apps/api` emits `dist/apps/api/src/index.js` while `start` names `dist/index.js`** — deferred because both fixes decide how production starts (project references, or a `start` that names what is produced); **§3 `tenants.ts` is written and never mounted** — mounting changes the API surface, deleting removes a wanted feature; **§4 `guard:console` does not check that a declared column exists in a response** — the gap that let three wrong client descriptors live until a screenshot found them; **§5** five smaller items, each with its reason |

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

