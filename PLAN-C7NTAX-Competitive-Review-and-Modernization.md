# C7NTAX Competitive Review & Modernization Plan (PLAN-013)

**Plan Label:** C7NTAX Competitive Review & Modernization Plan
**Status:** Proposed (plan only — no implementation yet)
**Date:** 2026-08-18
**Reviewed:** Endar (tomkeene/endar), NetLock RMM (0x101-Cyber-Security/NetLock-RMM), Breeze (LanternOps/breeze), C7NTAX (current codebase + pending plans)

---

## 1. Feature / function inventories

### 1.1 Endar (Python/Flask RMM, Docker, binary agents Win/Linux/Mac — alpha)
- Compliance Management: validation + enforcement script pairs, policies, groups, run cadence (e.g. 5 min), toggle enable.
- Monitoring: agent-collected host metrics (disk perf, memory, disk, load), agent list with per-agent compliance tab.
- Dashboard, Agents, Compliance, Policies, Groups, Settings pages; registration-token agent onboarding; default creds; roadmap: software/services/scheduled-tasks inventory, process metrics, one-click app install.

### 1.2 NetLock RMM (C#/.NET, Blazor + SignalR; open-core; agent + 8 server roles)
- Agents: code-signed installers Win/Linux/macOS (x64/ARM64), auto-update, self-heal; Install Builder (GPO/Intune/MDM).
- Multi-tenancy: unlimited tenants/locations/groups, cross-tenant reporting.
- Identity: 100+ granular permissions, role templates, TOTP, SSO (SAML/OIDC: Keycloak/Entra/Auth0/Okta), per-user auth modes.
- Architecture: 8 server roles (Comm/Update/Trust/Remote/Notification/File/LLM/Relay), HA + fallback servers, reverse-proxy, 5k devices on 2C/8GB.
- Remote tools: real-time shell (PS/Bash/Zsh/Python3, VT100, run-as-user, bulk), file browser, task manager, service manager, remote registry, Event Log viewer, Wake-on-LAN, reboot/shutdown.
- Remote screen control: H.264 adaptive, multi-monitor, multi-operator, attended/unattended, chat, session recording, 2FA gate.
- E2E-encrypted relay for RDP/SSH/MySQL/VNC/any TCP; tray icon + support chat; white-label.
- Inventory & hardware monitoring (CPU/RAM/drives/adapters/drivers/services/scheduled tasks/logon history).
- 350+ sensors + custom RegEx script sensors; SNMP v1/2c/3; port scanner; counter triggers, spam prevention, auto-reset; 28 vendors.
- Website & uptime monitoring: SSL expiry (30/14/7/3d), DNS, defacement detection, response-time history, incident timeline, root-cause hints.
- Automation jobs (PS/Bash/Zsh/Python, retries, timeouts, shared script library); sensor-attached self-healing scripts.
- Policy management (most-specific-wins: tenant/location/group/domain/IP/name), antivirus/notification/sensor/patch/job policies.
- Patch management (Win/Linux/macOS/Docker + winget/Chocolatey/Flatpak), approval workflows, SLA windows by severity, rings, Patch-Tuesday scheduling, maintenance windows, automatic rollback on failure-rate thresholds.
- Software deployment & App Hub (4-step wizard, per-device status/attempt history).
- Application control (default-deny allowlisting: path/version/SHA256/SHA512/cert), USB device control (Windows).
- (README truncated here — also documented: reporting templates 53, console languages 9, community edition/pro.)

### 1.3 Breeze (Go agent + Node/React server+web, AGPL; RMM + PSA + AI operator)
- Device management: hardware/software inventory, real-time health + thresholds, hierarchical config policies, advanced fleet filtering, network discovery (ARP/ICMP/port/SNMP), custom fields & tags, drift/change tracking, CIS hardening checks.
- Remote access: terminal, file browser, remote desktop (multi-display, clipboard, TURN relay), Tauri viewer/helper apps, activity monitoring.
- Automation: scripting (PS/Bash/Python), patch management (inventory/approve/deploy, windows + rings), alerts with severity + webhooks, playbooks, bulk deployments, watchdog self-healing supervisor.
- PSA built in: tickets/help desk (SLA, time + parts), quotes (from ticket, catalog + markups), billing & invoicing (ticket → invoice, no sync job), service catalog, customer portal (branded self-service).
- Backup & recovery: Restic snapshot backup (S3-compatible), bare-metal restore, Hyper-V/SQL agents, M365 cloud-to-cloud, restore testing, retention.
- Integrations: SentinelOne/Huntress EDR correlation; MCP server (first in an RMM) with OAuth 2.1 + PKCE for external AI agents.
- AI Operator: AI chat on every page, tool-equipped agent (query/execute), **risk-classified action engine** (human approval for impactful actions, block critical), BYO Anthropic key; Managed AI Ops.
- Security: Argon2id, JWT 15-min, TOTP, RBAC + **forced PostgreSQL RLS on tenant tables**, AES-256-GCM at rest, TLS 1.2+/HSTS, agent bearer tokens (SHA-256), Redis sliding-window rate limits (fail-closed), Zod on all inputs, 5 CI scanners (CodeQL/Gitleaks/npm audit/govulncheck/Trivy), audit trail + retention/S3, DR RTO<1h/RPO<15m.

### 1.4 C7NTAX (current, verified)
- PSA core: tickets (boards, categories, SLAs, time entries, comments, attachments, auto-close/follow-ups, priority deduction), clients/companies, contacts, service agreements, billing (invoices/payments), projects/phases, calendar/schedule + PTO, KB articles, dashboards (KPIs), service boards admin.
- Kumo: asset/document/certificate/password management (TOTP), folders, template fields.
- CloudConnect: integration hub + 8 adapters (M365, Pax8, ITGlue, Proofpoint, Avanan, SentinelOne, QuickBooks, Flexpoint) with test-connection and sync logs.
- Service Alerts: per-service RSS + DownDetector monitoring, severity/status lifecycle, all-clear auto-resolution (2-poll streak), banner + dedicated page.
- Email connector (new): IMAP polling → auto-tickets (deduction, threading, dedup), CloudConnect panel UI.
- Inference: OpenAI-compatible provider abstraction, orchestrator/pattern/search engines (pre-Bedrock), `/api/inference`, `/api/kb`.
- Identity: JWT (12h), TOTP + email MFA, RBAC roles/permissions, session-auth middleware (PLAN-001 partial), login flows.
- Platform: Express+Prisma/PostgreSQL API, Vite React web, Electron desktop, snapshot seeding, self-healing boot, gzip, token-savings hardening, PlanDocs registry (PLAN-001…012).
- UI: dark cyber theme, draggable sidebar sections, card-based layouts, responsive mobile-first, What's New/Changelog.
- Pending plans: PLAN-001 (session auth), PLAN-002 (passkey), PLAN-003 (multi-tenant), PLAN-004 (mobile), PLAN-005/006 (native desktop), PLAN-007 (SOC 2), PLAN-009 (M365 connector phases 5–6), PLAN-010 (AWS dev/prod), PLAN-011 (Bedrock RAG assistant), PLAN-012 (Outlook add-in).

## 2. Comparison

### 2.1 Common across Endar / NetLock / Breeze (all three)
1. **Endpoint agent** that streams telemetry to a self-hosted server (all are RMMs).
2. **Remote monitoring** with host metrics and alerting/thresholds.
3. **Script execution / jobs** on endpoints (validation/enforcement, jobs, scripting).
4. **Policy/group hierarchy** to apply config to sets of endpoints.
5. **Web console UI** with dashboards and agent/device lists.
6. **Patch/software management** (NetLock & Breeze full; Endar roadmap).
7. **Multi-tenant isolation** (NetLock & Breeze native; Endar single-tenant alpha).
8. **Self-healing/watchdog** agent behavior.
9. **Security emphasis** (agent trust, auth, encryption) — RMM agents run privileged.

### 2.2 Unique per reviewed app
- **Endar:** compliance assertion/remediation pairs as the *primary* paradigm; minimal single-purpose footprint (simplest architecture of the three).
- **NetLock:** deepest breadth — remote screen control w/ recording, E2E relay tunnels, 350+ sensor library + SNMP, website/uptime + SSL-expiry monitoring, application control (default-deny allowlist), USB control, patch rings w/ rollback, SSO (SAML/OIDC), 8-role HA architecture.
- **Breeze:** **AI-native operator** (risk-classified actions with human approval, every-page AI, MCP server for external agents), **RMM + PSA in one** (tickets → quotes → invoices in the same system), customer portal, Restic backup + M365 cloud-to-cloud, PostgreSQL RLS forced tenancy, 5-scanner CI supply-chain security.

### 2.3 How each compares to C7NTAX
| Capability | Endar | NetLock | Breeze | C7NTAX today |
|---|---|---|---|---|
| Endpoint agent / device fleet | ✅ | ✅✅ | ✅ | ❌ (none — PSA only) |
| Remote shell/desktop | ❌ | ✅✅ | ✅ | ❌ |
| Patch management | roadmap | ✅✅ | ✅ | ❌ |
| Sensors/uptime monitoring | partial | ✅✅ | health checks | ✅ service alerts (cloud vendors only; no endpoint/website/SSL monitoring) |
| Compliance policies | ✅ | ✅ | ✅ | ❌ |
| PSA ticketing | ❌ | partial | ✅✅ | ✅✅ (deep: boards/SLA/time/attachments) |
| Quotes→invoice chain | ❌ | ❌ | ✅✅ | ⚠️ billing exists; **no quotes** |
| Customer portal | ❌ | ❌ | ✅ | ❌ |
| AI assistant | ❌ | LLM server role | ✅✅ risk-classified operator | ⚠️ basic inference suggestions; PLAN-011 pending |
| MCP server / AI interop | ❌ | ❌ | ✅ | ❌ |
| SSO (SAML/OIDC) | ❌ | ✅✅ | OIDC-ish (MCP) | ❌ (PLAN-002 passkey; no SSO) |
| Multi-tenant isolation | ❌ | ✅✅ | ✅✅ (RLS) | ⚠️ PLAN-003 partial (Tenant model only) |
| Backup/DR for endpoints | ❌ | ❌ | ✅✅ | ❌ (PLAN-007 covers app DR, not endpoints) |
| EDR integrations | ❌ | ❌ | ✅ (SentinelOne/Huntress) | ⚠️ SentinelOne adapter (sync only) |
| KB / docs | ❌ | ❌ | ❌ | ✅ |
| Kumo (secrets/documents/assets) | ❌ | ❌ | ❌ | ✅ unique |
| Cloud vendor status monitoring | ❌ | ✅ uptime | ❌ | ✅ unique (RSS+DownDetector) |
| Email→ticket connector | ❌ | ❌ | ❌ | ✅ unique (just implemented) |

## 3. Gap analysis (what C7NTAX is missing / should upgrade)

**Missing entirely (highest value):**
1. Quotes + quote→invoice chain (Breeze's strongest PSA differentiator) — C7NTAX has agreements/invoices but no quoting.
2. Customer/self-service portal for end-users (open tickets, view devices later).
3. Website/SSL/DNS uptime monitoring with incident timeline (extend Service Alerts beyond vendor feeds).
4. SSO (SAML/OIDC) and passkey (PLAN-002) to match NetLock/Breeze identity.
5. Risk-classified AI action engine + MCP server (Breeze AI operator; C7NTAX's PLAN-011 covers RAG only — needs the action/approval layer).
6. Multi-tenant enforcement: RLS/scope filtering (PLAN-003 must be accelerated; Breeze shows forced RLS).

**Missing but RMM-adjacent (larger, may be out of PSA scope — flagged for decision):**
7. Endpoint agent + device fleet, remote shell/desktop, patch management, sensors/SNMP, application/USB control, network discovery, backup/recovery. These constitute a full RMM product line (NetLock/Breeze territory). Recommendation: adopt selectively in a later program, reusing PLAN-010 AWS infra; do NOT bolt onto PSA now.

**Upgrades to existing features:**
8. Ticket list → bulk actions/advanced fleet-style filtering (Breeze's filter language is the UX reference).
9. Billing: time/parts on ticket flowing to invoice line items automatically (Breeze "no sync job" model); C7NTAX has time entries — link them.
10. Service alerts: add website/SSL/DNS monitor types + incident timeline (NetLock model).
11. AI: attach the PLAN-011 Bedrock agent to tickets with risk-classified actions + approval prompts (merge into PLAN-011).
12. Security: Argon2id-style password hashing review, RLS once PLAN-003 lands, JWT 15-min + refresh rotation (PLAN-007 SC-03).
13. UI/UX modernization (below).
14. Kumo vault encryption parity with IT Glue (PLAN-015): per-password AES keys + RSA-2048 key wrapping with passphrase-protected private key outside the DB, host-proof vault mode, password versioning/rollback, reveal TTL, granular password ACLs, sensitive-password access workflow, at-risk password report, 32-char default generator.

## 4. Implementation plan (dependency-ordered — prerequisites first)

Ordering scheme: same phase table format as prior plans; each item lists affected frontend surfaces.

| # | Item | Depends on | Risk if prerequisite is skipped |
|---|---|---|---|
| 1 | **Quotes module (backend + data):** `Quote`, `QuoteLineItem`, `QuoteStatus` Prisma models; quote CRUD routes; catalog price lookup from service agreements; quote→invoice conversion service (reuses billing engine); ticket→quote link field | — (foundation) | Every later PSA-phase feature (2,3) has no quote data to build on; ticket→invoice chain impossible. |
| 2 | **Quotes UI:** new **Quotes page** (list, create/edit dialog with line items, tax/markup controls, approve→invoice button), ticket-detail "Create Quote" action, Finance dashboard quote widget | #1 | No user surface for quotes; no revenue path visible to techs. |
| 3 | **Customer portal:** public portal routes (`/portal`) with limited login (email + portal token or SSO-lite), "My tickets" list + create + status, per-company branding (logo/color from Company model); portal config section in **Administration** | #1 (quote visibility optional), PLAN-003 tenant scoping (partial ok) | Portal could leak cross-company tickets without scoping; without portal, end-users email/call instead. |
| 4 | **Uptime & SSL/DNS monitoring:** extend Service Alerts — new monitor kinds (`website`, `ssl`, `dns`) on ServiceAlertService; HTTP/HTTPS checks, SSL-expiry tiers (30/14/7/3d), DNS record checks; incident timeline per service; new **Monitors** tab on the Service Alerts page + configuration form fields | alertMonitor service (exists) | Website outages invisible; SSL expiry surprises for MSP clients. |
| 5 | **Billing flow upgrade:** time entries + parts auto-flow from tickets to draft invoice line items (Breeze model); invoice preview dialog shows linked tickets; **Billing page** gains "Generate from tickets" action + linked-ticket column | #1 (quotes optional), existing billing routes | Manual re-entry persists; quote→invoice conversion has nothing to attach work to. |
| 6 | **SSO & identity:** SAML/OIDC via env-configured provider (Keycloak/Entra/Okta) + `/api/auth/sso/*` exchange; **Login page** SSO button + **Administration → Security** SSO config section; keep JWT/password fallback (non-breaking). **Append (IT Glue parity):** enforced MFA admin policy (`MFA_REQUIRED` env + per-user enforcement state), SSO-only mode with per-user override list (SSO Access Control), login brute-force rate limiting + lockout on `/auth/login` (re-sync PLAN-002). | PLAN-001 session infra (in progress), PLAN-002 passkey (parallel) | Enterprise clients can't use IdP; identity story trails NetLock/Breeze; without enforcement, MFA stays opt-in and brute-force resistance relies on infra alone. |
| 7 | **AI action layer + MCP (merge into PLAN-011):** risk-classified action engine (suggest→execute with approval prompt; block critical ops), approval dialog component in ticket detail; MCP server endpoint (OAuth 2.1 + PKCE) exposing ticket/device queries to external agents | PLAN-011 phases (Bedrock agent), #1/#2 UI patterns | AI can only suggest, not act — Breeze parity unachievable; MCP interop missing. |
| 8 | **Security hardening:** RLS enforcement pass once PLAN-003 lands; JWT 15-min + refresh rotation; password-hash review (Argon2id); CI scanners (gitleaks/Trivy) in the boot/CI pipeline. Kumo-specific crypto (per-password keys, RSA wrapping, host-proof vault, versioning, ACLs, access workflows) is tracked in **PLAN-015** — this phase covers app-wide items only. | PLAN-003, PLAN-007 SC-03 | Multi-tenant queries leak; long-lived tokens raise SOC 2 risk (PLAN-007). |
| 9 | **UI/UX modernization pass (incremental, theme-preserving):** advanced filter bar on Tickets/Clients (Breeze-style query chips), bulk actions on ticket list, card density toggle + compact tables, skeletons instead of spinners, consistent empty states, breadcrumb header parity, keyboard shortcuts (T=new ticket), collapsible sidebar groups, dark-theme focus/contrast fixes, responsive table→card transforms on mobile | — (can run parallel after #2) | Usability gaps compound as features land; accessibility/contrast issues remain. |
| 10 | **RMM product line** → **split OUT to C7NTRL** (separate repo `C7-IMI/C7NTRL`, plan C7NTRL-001; mirrored in C7NTAX as **PLAN-014**): endpoint agent, remote shell/desktop, patch mgmt, sensors/SNMP, application/USB control, network discovery, uptime monitoring. C7NTAX stays PSA-only. | C7NTRL phases 1–10; PLAN-014 §3 lists C7NTAX counterpart changes | Attempting it in the PSA would destabilize production and double the codebase; separate repo keeps C7NTAX releasable independently. |
| 11 | **Kumo vault security parity (PLAN-015):** execute PLAN-015 phases 1–11 in order — key hierarchy + per-password DEKs, RSA-2048 KEK outside the DB, key rotation, decrypted-data hygiene, password versioning/rollback, reveal TTL, granular ACLs, host-proof vault mode, sensitive-password access workflow, at-risk report, 32-char generator policy. Frontend surfaces: **Kumo → Passwords** (reveal countdown + auto-clear, version history/restore, vault-mode badge + passphrase flow, generator options, ACL manager), **Reports** (At-Risk Password Report), **Administration → Security** (Kumo ACLs, access-workflow + notification targets, password policy). | PLAN-015 phase order; PLAN-010 §11 controls (KMS, WAF, backups) as infra complement | Single-master-key vault remains the highest-severity security gap vs IT Glue; without versioning/ACLs/TTL, vault UX and auditability trail competitors. |

**Frontend items (all affected surfaces):**
- New: **Quotes** page + create/edit dialog (line items, markups), ticket-detail "Create Quote" action, quote widget on Finance dashboard.
- New: **Customer Portal** standalone pages (`/portal`: tickets list/create/detail, login).
- Modified: **Service Alerts** page (Monitors tab + website/SSL/DNS forms + incident timeline); **Billing** page (generate-from-tickets, linked-ticket column, invoice preview dialog); **Login** page (SSO button, MFA-enforced prompt, lockout notice); **Administration → Security** (SSO config, auth-mode per user, MFA enforcement policy, Kumo ACLs + access workflow + password policy); **Tickets/Clients** (filter chips, bulk actions, skeletons, density toggle); **Layout** (breadcrumbs, collapsible groups, keyboard shortcuts); **Kumo → Passwords** (reveal TTL/auto-clear, version history + restore, vault-mode passphrase flow, generator options, ACL manager); **Reports** (At-Risk Password Report).

**Moved/split/appended notes (explicit):**
- **AI action engine + MCP server** → appended to **PLAN-011** (Bedrock AI plan) as its new Phase 9; PLAN-011's existing phases unchanged.
- **SSO (SAML/OIDC)** → appended to **PLAN-002** (identity plan) as an additional stage; implemented here as phase #6 with a note to re-sync PLAN-002.
- **Multi-tenant RLS enforcement** → appended to **PLAN-003** (multi-tenant plan) as a new Phase 4; referenced by phase #8 here (do not duplicate).
- **Kumo vault encryption & workflows** → new dedicated plan **PLAN-015** (per-password keys, RSA wrapping, host-proof vault, versioning/rollback, reveal TTL, ACLs, access workflow, at-risk report, generator policy); phase #11 here is its integration surface.
- **Enforced MFA + SSO-only mode + login brute-force rate limiting** → appended to phase #6 (re-sync PLAN-002 identity plan).
- **Infra security controls (IT Glue parity)** — WAF + rate limiting + IP allowlists/API restrictions, network segmentation, vulnerability-scan/pen-test calendar, daily backups + restore tests + cross-region replication/failover, SOC 2 change management — → appended to **PLAN-010** as its new §11 (old §11/§12 renumbered to §12/§13).
- **RMM endpoint-agent features** → split OUT into **C7NTRL** (separate repo `C7-IMI/C7NTRL`, plan C7NTRL-001; mirrored here as **PLAN-014**). Originally a decision gate (phase #10); decision now made: C7NTAX stays PSA-only, C7NTRL is the RMM.
- **Website/SSL/DNS monitoring** → **moved to C7NTRL phase 8** (PLAN-014); C7NTAX Service Alerts remains vendor-status-only (RSS/DownDetector).

**Design elements (preserve C7NTAX theme):**
- Keep the dark cyber-blue token set from `DESIGN.md`; adopt Breeze's clean density and NetLock's information hierarchy (status-first rows, secondary metadata muted).
- Modernize without cost: CSS-only skeletons, `content-visibility: auto` for long lists, virtualized tables only where >500 rows (justified: avoids React re-render churn), reduced-motion respected everywhere, WCAG AA contrast pass on muted text.
- No framework migration; no heavy chart libraries — existing patterns + inline SVG.

**Speed/resource tradeoffs (justified):**
- Filter chips and bulk actions are client-side over existing list endpoints (no new round-trips) — negligible cost.
- Quotes and portal add small tables/queries — negligible; pagination reused.
- Website monitoring reuses the 5-minute alertMonitor interval with per-service backoff (same as RSS/DD) — bounded.
- RLS adds a per-query filter cost — justified only after PLAN-003; deferred otherwise (avoids premature slowdown).

## 5. Rollback plan

- All phases are additive (new models/routes/pages). Per-phase revert restores prior state; no destructive migrations.
- New Prisma models require `db push` — dev-safe; prod uses migrations once PLAN-010 lands. `startup/.schema.sha256` must be regenerated after schema changes (PLAN-008 note).
- Feature flags: `QUOTES_ENABLED`, `PORTAL_ENABLED`, `UPTIME_ENABLED`, `SSO_ENABLED` — each phase gated so a broken phase can be disabled without reverting.

## 6. Verification plan

- Typecheck baselines (api 176 / web 17) unchanged or improved; boot pipeline + `verify-post-change` green after every phase.
- E2E: quote → approve → invoice → ticket links; portal login → ticket create visible to company only; uptime monitor flags a down site and clears on recovery (streak rule); SSO round-trip; AI action approval prompt blocks critical op.
- UI: mobile/desktop snapshots for new pages; contrast checks against the token set.

## 7. Open decisions to confirm before implementation

1. RMM product line: adopt, defer, or scope as separate plan (phase #10 gate).
2. Quotes tax/markup defaults and approval flow (who approves).
3. SSO provider priority (Entra ID first?) and whether to keep password login.
4. Customer portal auth: email+portal-token vs full SSO-lite.
5. AI action risk tiers (what needs approval vs blocked) — aligns with PLAN-011.
