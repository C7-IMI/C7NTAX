# C7NTAX — Feature List Summary
## Version: 2026.8.19.009 | Last Updated: 2026-08-19

---

### Versioning Scheme
- Date-based: `Year.Month.Day.Build` (e.g., `2026.8.10.001`)
- First three octets set to the release date
- Build number starts at `001` each day, increments sequentially for same-day entries
- **The date octets MUST be the actual current date when the entry is written** (derived, never typed). Use `node scripts/next-version.mjs` to compute the next version; the build number resets to `001` on a new day.
- This file is the authoritative source for the What's New changelog
- Each entry uses type indicators: `[New]`, `[Update]`, `[Fix]`

---

## 2026.8.19.009 — Sample data coverage for every section & subsection
- **[New]** `apps/api/src/seed-coverage.ts` — idempotent per-table guards (creates only when count is 0) seeding sample rows for every previously-empty area: Calendar (scheduleEntry), Procurement (vendor, purchaseOrder, pOLineItem), Payments (payment), Analytics (report + reportSchedule), PTO & Holidays, Contracts + milestones, Sales activities, KB categories, Chat (session + messages), Workflows (rule + action + execution), Locales + translations, Surveys (survey/question/response/answer), M365 (user/group/subscription), Sync logs + synced entities, Expenses, Alert rules + log, Notifications, Kumo Configurations (kumoServer), Kumo domains/certificates/links, and Project phases + tasks. 39 tables verified non-empty after reseed.
- **[Update]** Snapshot pipeline: added the 23 new tables to `snapshot-capture.ts` TABLES and `seed-from-snapshots.ts` SEED_ORDER in dependency order (parents before children: vendor→purchaseOrder→pOLineItem, survey→question→response→answer, contract→milestone, workflowRule→action/execution, locale→translation, chatSession→chatMessage, projectPhase→projectTask). Corrected Prisma client names for two models (pOLineItem, kBCategory). Captured all new fixtures; full delete+re-insert reseed round-trip verified (71 fixture inserts).
- **[Fix]** Notification sample fields corrected to the schema (type instead of severity); m365Group/m365Subscription guarded separately so partial states self-heal.
- **[Verification]** `ALL COVERED (39 tables)` after reseed; fixture files present with expected row counts; version computed via `scripts/next-version.mjs` (2026.8.19.009).

## 2026.8.19.008 — Service alert banner: reliable per-alert dismissal
- **[Fix]** `components/Layout.tsx` — banner dismissal raced with the visibility-gated poller: the polling callback captured a stale `dismissedAlerts` state closure, so a poll that started before dismissal could resurrect the same banner within the next minute. Rewrote the logic to read the dismissed-alert set FRESH from localStorage on every poll (`loadDismissed()`), made the poll callback identity-stable (`useCallback([])`), and made `dismissBanner` persist the dismissal synchronously to localStorage (capped at 50 ids) before hiding the banner. Result: the close button reliably hides the banner, the same alert never reappears, and a NEW alert (different id) shows the banner again immediately.
- **[Verification]** web typecheck 17 (baseline; changed file clean); Vite transforms Layout.tsx (200); next version computed via `scripts/next-version.mjs` (2026.8.19.008).

## 2026.8.19.007 — Ticket list: configurable columns, drag reorder, Timestamp/Technician/Summary
- **[New]** `pages/Tickets.tsx` — PSA-style configurable ticket list (Autotask/ConnectWise/HaloPSA/Kantata/Scoro/NinjaOne/Atera reference):
  - Timestamp column: shows creation time; switches to last-updated time once the ticket has changed (tooltip shows both).
  - Summary (ticket subject) moved to its own column; Technician column added (assignee from the API's existing `assignedTo` include).
  - Columns are draggable via header drag-and-drop to reorder; click a header to sort (supported fields keep sorting).
  - Choose Columns button above the ticket card opens a modal with a checkbox list of all columns; displayed columns are pre-checked; Priority is available but unchecked by default. Visibility + order persist per user via localStorage (`c7_ticket_columns`).
- **[Update]** Help docs: "Ticket list columns" steps added to the UI Shortcuts & Batch Actions walkthrough + Index row (maintenance rule).
- **[Verification]** web typecheck 17 (baseline; changed file clean); Vite transforms Tickets.tsx (200); `/tickets` serves 200; version computed via `scripts/next-version.mjs` (2026.8.19.007).

## 2026.8.19.006 — Date/version generation logic fixed permanently
- **[Fix]** Entries 2026.8.18.018–.022 were created on 2026-08-19 but carried the previous day's date octets (manually typed). Renumbered to 2026.8.19.001–.005 per the scheme (build resets to 001 on a new day). Header Last Updated corrected to 2026-08-19; Retrace references updated to match.
- **[New]** `scripts/next-version.mjs` — computes the next version from the actual system date + the highest existing build for that day; eliminates manual date errors permanently.
- **[Update]** `apps/api/src/verify-post-change.ts` — now also runs `scripts/generate-buildnotes.mjs` automatically, so What's New outputs refresh after every post-change verification (in addition to the boot step 6a).
- **[Update]** Versioning Scheme + `PROMPT-LIBRARY.md`/`NewProjectPrompts.md` P2 — version date octets must be derived from the current date, never typed.

## 2026.8.19.005 — App-wide button/endpoint audit (all sections & subsections)
- **[Fix]** Cross-checked every API path used by web buttons/dialogs against the mounted API routes. Four silent-404 breakages found and fixed:
  - `GET /api/kumo/dashboard` missing → added (Kumo dashboard stats: asset/password/document/server/folder counts).
  - `GET/POST /api/system/failover/status|reset` missing → added (SystemConfig-backed failover counter + reset, survives restarts).
  - `GET /api/assets?limit=50` (Tickets → configurations tab) → repointed to existing `/kumo/assets?limit=50`.
  - Verified all other web API calls resolve (cloudconnect/types, billing/expenses, kumo/configs/servers, inference/suggestions, system/audit-logs, service-alerts/monitor-status, tickets/batch, inventory/assets/import, etc.).
- **[Verification]** api typecheck 177 / web 17 (both baseline; changed files clean). Boot via scheduled task clean; the three fixed endpoints now return 401 (auth-gated route exists) instead of 404; `/api/health` 200.

## 2026.8.19.004 — Service Alerts: Add Service button fixed
- **[Fix]** `ServiceAlertsSettings.tsx` — the Add Service button appeared to do nothing: the editor dialog rendered only when `form.name !== "" || editing`, but `openNew()` reset the form to an empty name, so the dialog never opened. Added a dedicated `showForm` state — `openNew`/`openEdit` set it true, save/Cancel/backdrop close it via a new `closeForm()` — and the dialog now renders on `showForm`. Save still posts to the existing `POST /api/service-alerts/services` (verified the route + SERVICE_FIELDS whitelist already include the form's fields).
- **[Verification]** web typecheck 17 (baseline, changed file clean); `/admin/service-alerts` serves 200.

## 2026.8.19.003 — Broken buttons/links audit & fixes
- **[Fix]** Audited the entire web app for non-functional buttons/links (grep sweeps for href="#", no-op onClick, handler-less button blocks, and Link targets vs registered routes). All nav Links verified against App.tsx routes; all multiline buttons in Users/Roles/Tickets/ServiceAlerts/Settings verified to have handlers. Top-right header placeholders excluded per instruction.
- **[Fix]** `Reports.tsx` Analytics → Quick Actions: "Export Dashboard PDF" now generates a real PDF (jsPDF + autoTable with revenue metrics); "Schedule Weekly Report" now opens a working dialog (report select, day, time, recipients) posting to `POST /api/reports/:id/schedules`; "Custom Report Builder" was navigating to a dead SPA route (`window.location.href = "/reports/custom"`) — now a `Link` to the new route.
- **[New]** `pages/CustomReports.tsx` + route `/reports/custom` — list/create custom reports (name, type ticket_summary/revenue/custom, config JSON validated), Run (uses `GET /api/reports/:id/run`) with results table.
- **[Update]** Help docs (maintenance rule): added "Custom Reports & Scheduling" walkthrough + Index rows in the same change.
- **[Verification]** web typecheck 17 (baseline; one transient noUncheckedIndexedAccess error fixed in CustomReports); `/reports/custom` and `/help/walkthroughs/custom-reports` serve 200.

## 2026.8.19.002 — Help walkthroughs + documentation maintenance rule
- **[New]** Feature walkthroughs in the Help docs (`pages/HelpDoc.tsx`, 12 new sections under `/help/walkthroughs/*`): Email-to-Ticket Setup, Quotes & Convert to Invoice, Billing & Agreements (block/Cyber Care/spot, overtime, midnight split, bill-through), Uptime Monitors (website/SSL/DNS), Service Alerts & Outage Monitoring, Alert Webhooks, AI Actions (risk-classified), MFA/SSO/Passkeys, Outlook Add-in, CloudConnect Integrations, Kumo (passwords/documents/audit/file manager), UI Shortcuts & Batch Actions. Each includes step-by-step configuration instructions where configuration is required, and clickable related-content links.
- **[Update]** Help Index reorganized into feature-set groups (Getting started & UI, Ticketing & email, Billing & agreements, Monitoring & alerts, Integrations, AI, Identity & security, Kumo & KB, Mobile) with rows linking to walkthroughs and app pages. Help landing page now shows the 4 core sections plus a Feature walkthroughs grid.
- **[New]** Documentation maintenance rule (durable): whenever a feature or function is added, updated, changed, or removed, create/update its walkthrough in the same change and keep its Help Index rows and related-content links accurate. Rule recorded in `PROMPT-LIBRARY.md` (P3) and `NewProjectPrompts.md` (P3).
- **[Verification]** web typecheck 17 (baseline); Vite transforms HelpDoc/Help (200); `/help/walkthroughs/email-tickets` serves 200.

## 2026.8.19.001 — Help section (button + nav + PSA-style docs)
- **[New]** `pages/Help.tsx` — Help landing page: hero + 4 subsection cards (icon, title, description) + quick links.
- **[New]** `pages/HelpDoc.tsx` — PSA-style documentation frame modeled on Autotask / ConnectWise Asio / HaloPSA help centers: left rail (section navigation + on-page anchors), content blocks (headings, numbered steps, note/tip/warn callouts, tables), and a "Related topics" cross-reference box linking help sections and app pages. Content for Getting Started, FAQ, Configuration, Index (data-driven `HELP_SECTIONS`).
- **[Update]** `components/Layout.tsx` — Help button (top right) converted from placeholder to a `Link` to `/help`; new parent nav section "Help" in `NAV_TREE` with subsections Help Home, Getting Started, FAQ, Configuration, Index; header descriptions added for the five `/help*` routes; `Settings2`/`ListOrdered` icons imported.
- **[Update]** `App.tsx` — routes for `/help` + 4 subsections; removed a duplicate `/quotes` route.
- **[Fix]** Callout styles: removed side-accent borders (border-l + rounded-r) in favor of full tinted backgrounds per design review.
- **[Verification]** web typecheck 17 (baseline; changed files clean); Vite transforms both new modules (200); `/help` SPA route serves 200.

## 2026.8.18.017 — What's New auto-refresh fix
- **[Fix]** What's New stopped updating: `scripts/generate-buildnotes.mjs` had not been re-run after BuildNotes entries .014–.016, so `apps/web/public/BuildNotes.md` (the What's New page data source) and `apps/api/src/BuildNotes.json` stalled at .008. Regenerated both (68 versions, through .016); verified `/BuildNotes.md` serves .016 and `BuildNotes.json` contains .014–.016.
- **[Update]** `startup/c7ntax-boot.ps1` — added step 6a: runs `scripts/generate-buildnotes.mjs` on every boot so What's New outputs refresh automatically from the root BuildNotes.md (idempotent).

## 2026.8.18.016 — Now-deployable backlog implemented (12 items, non-breaking, verified)
- **[New]** Backend: `Quote`/`QuoteLineItem`/`WebauthnCredential`/`PushDevice`/`AiAction`/`AiActionAudit`/`AlertWebhookDelivery`/`OutlookAddinToken` models + `EmailConnector.transport/clientId/clientSecretEncrypted/tenantId` + `ServiceAlertService.monitorKind/monitorUrl/monitorConfig` (additive, `db push` synced).
- **[New]** Routes: `quotes.ts` (CRUD + convert-to-invoice), `push.ts` (device registration + sync markers), `aiActions.ts` (risk-tier propose/decide; critical blocked), `alertWebhooks.ts` (webhook CRUD + delivery log), `outlookAddin.ts` (batch email→ticket with messageId dedup), `ssoExchange.ts` (env-gated OIDC login, JWKS RS256 verify, user auto-provision), `webauthn.ts` (@simplewebauthn passkey register/login). `billing.ts` gains `POST /invoices/generate-from-tickets` (draft-only).
- **[Update]** `alertMonitor.ts`: website/ssl/dns monitor kinds with the existing 2-poll clear-streak rule; `serviceAlerts.ts` field whitelist extended.
- **[Update]** `emailConnectorRuntime.ts`: M365 Graph transport (client-credentials OAuth + Graph mail API) beside IMAP.
- **[Update]** Auth: `signToken` 15-min expiry + bcrypt cost-12 rehash-on-login behind `AUTH_HARDENING_ENABLED`; `startup/security-scanners.ps1` (optional gitleaks/trivy) wired into boot.
- **[New]** Web: `Quotes`, `Monitors`, `Webhooks`, `AiActions` pages + routes; Login gains SSO button, passkey sign-in/register, `?token=` SSO callback; FinanceDashboard gains generate-from-tickets; keyboard shortcut `T`→tickets; skeleton CSS (reduced-motion safe).
- **[New]** `ROLLBACK-BACKLOG-2026-08-18.md` (per-item + unified rollback; all flags listed). `seed-backlog.ts` + snapshot fixtures for new tables (capture + seed-from-snapshots lists extended).
- **[Verify]** Boot (scheduled task) → API PID fresh, `/api/health` 200, web `/` 200, login check 200; new routes live (quotes/ai-actions/webhooks/push = 401 auth-gated, sso/status 200 `{"enabled":false}`); typechecks: api 177 / web 17 (all errors in pre-existing files; changed files clean). C7NTRL `docs/DEV-HANDOFF.md` updated + pushed (commit 72ffdcf): prerequisites fulfilled, Phase 4 should target C7NTAX alert webhooks.

## 2026.8.18.015 — PLAN-015: strict dependency-order renumbering
- **[Update]** `PLAN-C7NTAX-Feature-Backlog-UI-Billing-Kumo-Integrations.md` (PLAN-015 §2) — reorganized the 16-item implementation plan into strict dependency order: Phase A billing chain (#1 agreements/time engine → #2 expenses → #3 bill-through batch invoicing), Phase B independent upgrades (#4–#13, no unresolved prerequisites, parallel-safe), Phase C externally gated (#14 remote-session notes ← C7NTRL phase 7; #15 client portal ← PLAN-003 Step 2/PLAN-002; #16 infrastructure ← PLAN-010). SMS verification moved #14 → #13 (ungated before gated). All `Depends on` / `Risk if skipped` notes updated with the verified statuses (batch ops ✅, QB Realm ID ✅, file manager ✅, connection fix/re-test ⚠️, per-service RSS/DownDetector ⚠️). No items added or removed; names, paths, and details preserved. PlanDocs copy re-synced with revision note.

## 2026.8.18.014 — PLAN-015: Feature Backlog (UI, Billing, Kumo, Integrations, Infrastructure)
- **[New]** `PLAN-C7NTAX-Feature-Backlog-UI-Billing-Kumo-Integrations.md` (PLAN-015) — status-mapped all 24 requested features against the verified codebase (✅ batch ticket ops via `bulk.ts` + Tickets.tsx selection, QuickBooks Realm ID fields, Kumo file manager; ⚠️ partials: invoice generate, report writer, CloudConnect fix/re-test dialog, M365 sync, service alerts; 📋 planned elsewhere: client portal FI0042 → PLAN-013 #3, remote-session notes → C7NTRL-001 phase 7 / PLAN-014, serverless/OpenTofu/dev=prod → PLAN-010; ❌ new: 16-item dependency-ordered implementation plan — agreements/time engine (block/cyberCare/spot rates, 1.5x overtime after 18:00, midnight split, 1.5:1 block deduction), expenses tab, bill-through batch invoicing with preview/approve, per-user dashboard, board drag-and-drop, Kumo audit log, MFA QR upload, Outage Board, CloudConnect live statuses, report fix + client value template, AI KB auto-generation, M365 inactivity/offboarding, SMS verification) with `Depends on`/`Risk if skipped` notes, moved/appended notes, frontend items, rollback (flag-gated), verification, and open decisions.

## 2026.8.18.013 — PLAN-014: C7NTRL RMM split-out + GitHub repo created
- **[New]** `PLAN-C7NTRL-RMM-Product-Line-and-PSA-Integration.md` (PLAN-014) — C7NTAX stays PSA-only; the RMM product line from PLAN-013 is split into a separate application **C7NTRL** with its own GitHub repository (`C7-IMI/C7NTRL`, private, `main`+`develop` branches pushed) and mirrored plan C7NTRL-001 (architecture: Node/Express server + React console reusing the C7NTAX theme, Go agent; 10 dependency-ordered phases derived from re-reviewing Endar/NetLock/Breeze with clean-room reuse only — Endar CC BY-NC-ND, NetLock & Breeze AGPL).
- **[New]** `docs/INTEGRATION-CONTRACT.md` v0.1 committed to both repos: versioned endpoints, HMAC-signed webhooks, shared-JWT trust, contract fixtures + `integration-contract` CI jobs enforcing bidirectional change checks (C7NTAX changes validated against C7NTRL and vice versa).
- **[Update]** `PLAN-C7NTAX-Competitive-Review-and-Modernization.md` (PLAN-013) — phase #10 RMM line now split OUT to C7NTRL/PLAN-014; website/SSL/DNS monitoring moved to C7NTRL phase 8 (C7NTAX Service Alerts stays vendor-only).
- **[New]** Reference clones of endar / NetLock-RMM / breeze under `../_ref/` (study only, never merged).

## 2026.8.18.012 — Now-Deployable Backlog Review (No AWS, Non-Breaking)
- **[New]** `PLAN-C7NTAX-Now-Deployable-Backlog.md` — reviewed all 13 plans + live codebase and identified 12 features deployable now without AWS migration and without breaking the app, each with an implementation approach that preserves existing functionality (quotes/service catalog, time→invoice lines, website/SSL/DNS monitoring, alert severity/webhooks, provider-agnostic AI risk-classified actions, SAML/OIDC SSO, WebAuthn passkey, Outlook add-in backend, M365 Graph transport, mobile backend enablement, SOC 2 non-AWS hardening, UI/UX modernization). Explicit exclusion table with reasons (AWS-dependent or break-risk items deferred).

## 2026.8.18.011 — PLAN-013: Competitive Review & Modernization
- **[New]** `PLAN-C7NTAX-Competitive-Review-and-Modernization.md` (PLAN-013) — in-depth review of Endar, NetLock RMM, and Breeze vs C7NTAX: full feature inventories for all four; comparison tables (common features across the three, unique per app, vs C7NTAX); gap analysis (RMM device agents/monitoring, patch management, remote tools, SSO, quoting→invoice, customer portal, backup, risk-classified AI actions, MCP, RLS multi-tenancy, UI modernization); dependency-ordered incremental implementation plan with per-phase `Depends on`/`Risk if skipped` notes, explicit moved-items notes (AI risk engine → extends PLAN-011; SSO → links PLAN-002; multi-tenant RLS → links PLAN-003; device agents deferred until PLAN-010 AWS infra), frontend items (dialogs, settings, sections), design modernization preserving C7NTAX theming, and performance tradeoff justifications.

## 2026.8.18.010 — PLAN-012: Outlook Add-in Email-to-Ticket Generator
- **[New]** `PLAN-Outlook-Addin-Email-to-Ticket.md` (PLAN-012) — detailed plan for an Outlook plugin that creates service tickets from emails: recommends an **Office Web Add-in** (MessageReadCommandSurface + ExecuteFunction + taskpane) for cross-platform reach matching the C7NTAX TS/React stack; reuses PLAN-009's implemented machinery (`createTicketFromEmail`, deduction, `EmailConnector` patterns) via a new `POST /api/outlook-addin/tickets` batch endpoint with internetMessageId dedup; full email→ticket field mapping table; SSO auth (Office SSO → `/api/auth/office-sso` exchange → C7NTAX JWT) with manual-login fallback; C7 icon from the Composite asset sheet at 16/32/80 px; selection behavior spec (multi-select → one ticket per email via `getSelectedItemsAsync`; single open/previewed message → that message); testing (unit + Outlook desktop/web E2E) and deployment (sideload → Integrated Apps/AppSource) steps; 7 dependency-ordered phases with `Depends on`/`Risk if skipped` notes; rollback + open decisions.

## 2026.8.18.009 — Monitored Mailbox Email-to-Ticket Connector (PLAN-009 Phases 1–4)
- **[New]** Implemented the email-to-ticket connector core (no cross-plan prerequisites existed): `packages/email/src/imapFetch.ts` (real IMAP polling via node-imap + mailparser; process-then-mark contract left to API), `packages/email/src/fieldDeduction.ts` (subject stripping, name/domain deduction, quoted-reply stripping, priority, auto-reply detection), `EmailConnector.pollNow()`; `apps/api/src/services/ticketNumber.ts` (extracted from ticket routes), `services/emailToTicket.ts` (system user `connector@c7ntax.local`, contact/company resolution, ticket + email-comment creation, threaded replies), `services/emailConnectorRuntime.ts` (manager singleton, boot hydration guarded by `EMAIL_CONNECTORS_ENABLED`, Message-ID dedup cursors), `services/emailConnectorCrypto.ts` (kumoCrypto-backed password encryption), `routes/email-connectors.ts` (CRUD/test/poll/status on the existing `EmailConnector` Prisma model), CloudConnect `EmailConnectorsPanel` UI (list/create/test/enable/poll/delete).
- **[Fix]** `routes/boards.ts` pre-existing broken `EmailConnector` queries corrected to the real model fields (select/create/update; `boardId` validation) — 6 baseline tsc errors removed (182 → 176).
- **[Verified]** Smoke-tested: list/create/test(502 graceful on unreachable host)/nested board list/delete all pass; typecheck at baseline; boot green.
- **[Pending]** PLAN-009 Phases 5–6 (M365 modern/legacy auth) NOT implemented — external prerequisites listed for review: Azure AD app registration, tenant ids, M365 test mailbox.

## 2026.8.18.008 — Service Alerts: DownDetector Auto-Resolution
- **[Update]** `apps/api/src/services/alertMonitor.ts` — extended the all-clear auto-resolve logic to DownDetector: every configured service now checks its `downDetectorUrl` alongside the RSS feed; a page whose own H1 status line says "no current problems" counts as all-clear (2-consecutive-poll streak + min alert age, same anti-flap rule), and "possible problems / issues" pages create or keep a `downdetector`-sourced alert. DownDetector's Cloudflare blocks non-browser TLS fingerprints (Node fetch 403), so the page is fetched through the r.jina.ai reader (`DD_READER_BASE_URL` env-overridable); classification uses only the page's own H1 so sidebar tweets about other services can't cause false alerts. Verified live: stale Comcast Xfinity alert auto-resolved (page: "no current problems"); GitHub correctly got a new degraded alert (page: "possible problems with GitHub"); Google Workspace RSS incident still active; 0 monitor errors.

## 2026.8.18.007 — PLAN-011: Bedrock Agentic RAG AI Assistant
- **[New]** `PLAN-Bedrock-Agentic-RAG-AI-Assistant.md` (PLAN-011) — AWS-native Agentic RAG plan for the PSA: Bedrock Agents (Claude 3.5 Sonnet / Llama 3), Knowledge Bases + Titan embeddings + OpenSearch Serverless over RDS→S3 ticket exports, Lambda `search_web` Action Group (Tavily/Brave/SerpApi), API Gateway + IAM `InvokeAgent` integration with the existing `/api/inference` + `/api/kb` code, EventBridge + Step Functions weekly KB batch generation, Bedrock Guardrails + tenant_id vector filtering + PrivateLink. 8 dependency-ordered phases with `Depends on`/`Risk if skipped` notes; rollback (BEDROCK_ENABLED flag falls back to existing provider); verification and open decisions (model, embeddings, search vendor, DMS vs Lambda ETL).

## 2026.8.18.006 — PLAN-010: AWS Dev/Prod Split & Sync Plan
- **[New]** `PLAN-AWS-Dev-Prod-Split-and-Sync.md` (PLAN-010) — plan to split into two AWS environments (dev + prod) with prod running alongside dev on a different port (`:3011` vs `:3010`) for browser-refresh verification; separate RDS databases; ECS Fargate + ALB; local→AWS push tooling; **sync-command semantics** (standalone trigger phrases like "Push to Prod" sync; negated or mid-sentence occurrences never sync; all other messages work on dev only); 10 dependency-ordered phases with `Depends on`/`Risk if skipped` notes (per PlanDocs convention), rollback plan, verification plan, security (KMS, Secrets Manager, WAF, prod seed guards), and LLM/inference containerization options (vLLM/TGI on ECS or Bedrock with `INFERENCE_BASE_URL` config).

## 2026.8.18.005 — Service Alerts Auto-Clear on All-Green Sources
- **[Fix]** `apps/api/src/services/alertMonitor.ts` — active alerts are now auto-resolved when the monitored source shows **all green**: after a successful feed fetch with no outage-classified items, two consecutive all-clear polls (anti-flap streak) and a minimum alert age of one poll interval resolve the alert with an "all clear confirmed" note. Explicit "restored" items still resolve immediately; **manual alerts are never auto-resolved**; services without an RSS feed are untouched. Verified live: stale Microsoft 365 and Azure alerts (active since 2026-08-14) auto-resolved; the genuine Google Workspace incident (current "investigating" item) correctly stays active; Comcast (downdetector-only, no feed) correctly untouched.

## 2026.8.18.004 — All Plans Reordered: Prerequisites Before Dependents
- **[Update]** Reviewed all 9 plan documents (`PLAN-001`…`PLAN-009`) against the codebase and renumbered their implementation items into dependency order, preserving every original item name, path, and detail. Added `Depends on:` / `Risk if skipped:` notes to every dependent item: PLAN-001 phases 1–6 (foundation → timeout → TOTP → email → SMS → admin UI; noted `mfaSmsPhone` column already lands in Phase 1), PLAN-002 passkey stages 1–4 (+ cross-plan dep on PLAN-001 MFA flow), PLAN-003 multi-tenant steps 1–3 (foundation → middleware → isolation, with cross-tenant leak risk if middleware precedes columns), PLAN-004 mobile 13-step sequence (Phase 0 → backend enablement → Android/iOS builds → publishing), PLAN-005/006 desktop P0–P5 dependency notes, PLAN-007 SOC 2 dependency-ordered sequencing (SC-12+PI-03 → SC-11+SC-01 → AV-01/02/03/05 → CF-01/03 → SC-02..07 → PI/PR/OR), PLAN-008 token-savings cross-cutting notes (schema-hash regeneration for future schema changes), PLAN-009 email-connector phases 1–7 dependency/risk notes.
- **[New]** PlanDocs registry convention added: all future plans must list implementation items in dependency order with `Depends on:`/`Risk if skipped:` notes; originals updated and PlanDocs copies re-synced.

## 2026.8.18.003 — Calendar Content Scales with Container (Width-Driven)
- **[Update]** `apps/web/src/hooks/useCalendarScale.ts` — scaling is now width-driven (`k = availW / baseW`, min 1) instead of being capped by remaining viewport height, so the month calendar (date cards + all inner content) grows to fill the calendar container's width on wide windows and scales down with the window; uniform transform keeps square cells and aspect ratio; date cards and their content now scale proportionally with the container. Base measurement loop also made stable (state only updates on real size changes).

## 2026.8.18.002 — Calendar Fixes & Scaling, PlanDocs Registry, Email Connector Plan (M365), Changelog Policy
- **[Fix]** Calendar and Time Off pages restored: their API routes (`/api/schedule`, `/api/schedule/skills`, `/api/pto`, `/api/pto/all`) used Prisma `include` on relations that don't exist on `ScheduleEntry`/`TechnicianSkill`/`PtoRequest` (scalar-only `userId`/`ticketId`/`approvedById`) — every call returned 500. Replaced with manual joins preserving the same response shape; API typecheck improved 186 → 182 errors.
- **[New]** Dynamic calendar scaling: new `apps/web/src/hooks/useCalendarScale.ts` scales the Calendar and Time Off month grids with the window via uniform CSS transform (`k = max(1, min(availW/baseW, availH/baseH))`) — square day cells and aspect ratio preserved; current size is the minimum (never shrinks below 1), grows to fill the window when maximized.
- **[New]** `PlanDocs/` plan registry: all 9 project plan documents copied with stable IDs `PLAN-001`…`PLAN-009` (session auth, passkey, multi-tenant, native mobile, native desktop, desktop OSS, SOC 2, token savings, email-to-ticket connector) plus `README.md` index with conventions; originals remain in place.
- **[New]** `PLAN-Monitored-Mailbox-Email-to-Ticket-Connector.md` (PLAN-009) — Monitored Mailbox Email-to-Ticket Connector implementation plan (AutoTask/ConnectWise Manage/Asio-guided): IMAP polling, field deduction (name/company/contact/subject/description), threading, rollback plan, phased delivery; extended with **Microsoft 365 Exchange mailbox support** (legacy Basic Auth IMAP/EWS with deprecation warnings + modern OAuth 2.0/Microsoft Graph with delegated or app-only flows, shared mailboxes, token rotation).
- **[New]** Mandatory changelog policy: every change now updates all three records — **What's New** (generated from BuildNotes), **build notes** (`BuildNotes.md`), and **Retrace** (`Retrace.md`) — and today's previously unrecorded changes were backfilled.

## 2026.8.18.001 — Login Flow Restoration & Token-Savings Hardening
- **[Fix]** Login loop resolved: the gzip middleware truncated response bodies (the zlib stream flushed after `res.end()`), corrupting the login JWT so `/users/me` returned 401 and the app bounced straight back to the login screen; replaced streaming compression with buffered compress-once-and-end (atomic responses with correct `Content-Length`).
- **[Fix]** Removed the leftover temp auth bypass (`TEMP_BYPASS_AUTH` / `c7_bypass`) that silently cleared real tokens, disabled the 401→login redirect, and left every section polling with invalid auth; real login flow restored and stale bypass flags are now cleared automatically.
- **[Update]** Implemented the 10-option token-savings plan: quiet morgan polling (401 spam), 5 MB `dev-errors.log` cap + boot rotation, snapshot diff-only captures, `boot.log` rotation + prisma skip-if-unchanged, single-source BuildNotes generation, visibility-gated frontend polling, per-file `typecheck-diff.sh` (untracked files + anchored path matching), inference cheap-model override + 6000-char excerpt + memoized prompt prefix, gzip + weak ETags, additive snapshot delta journal (capped at 100 entries).
- **[Fix]** Shared package barrel TS2308 duplicate-export conflicts resolved (explicit type re-exports; stale duplicate `sso-etc` feature module removed from the barrel) — `@C7NTAX/shared` now compiles clean.
- **[Update]** Sample data restored from snapshots via the defined seed process (235 records; all tables match the snapshot manifest); API layer verified serving data (8 tickets, 4 boards, 6 users, 8 alert services).
- **[Verified]** Boot pipeline green; login HTTP 200; frontend HTTP 200; 304 conditional responses clean; gzip login response byte-identical to the uncompressed response.

## 2026.8.14.004 — SOC2.Compliance Plan
- **[New]** `SOC2.Compliance.md` — SOC 2 Type II readiness plan for C7NTAX deployed to AWS: numbered items (SC-01…OR-04) across Security, Availability, Confidentiality, Processing Integrity, Privacy, and Organizational controls; each item includes why, functional impact, and ⚠️ breakage-risk flags; AWS-specific guidance inline (Secrets Manager, KMS envelope encryption, RDS Multi-AZ + PITR, ALB/ACM/WAF, ECS Fargate hardening, CloudWatch/CloudTrail/GuardDuty/Security Hub/Config); recommended sequencing and open decisions (Type I vs II, desktop app scope, AWS org/SCPs, pen-test vendor).
- **[New]** Top gaps identified: dev secrets in `.env`, permissive rate limit, JWT without rotation, `--accept-data-loss` in the boot pipeline, reseed-able audit trail, hardcoded crypto fallback key.

## 2026.8.14.003 — Audit Log Data Recovery & Snapshot Restoration
- **[Fix]** Missing audit logs recovered: the snapshot reseed (Option 2) had replaced the live audit trail with the older 6-row snapshot, losing several days of `AuditLog` rows. Reconstructed the complete set by unioning all 15 historical git versions of `apps/api/src/snapshots/audit-logs.json` — 63 unique rows spanning 2026-08-06 → 2026-08-14 (ticket updates, kumo password events, board/schedule/service-alert activity).
- **[Fix]** Restored the 63 rows into the live database (deleteMany + createMany with skipDuplicates); `audit-logs.json` now carries the full union, and verify-post-change re-captured `auditLog: 63 records`, so every future boot reseed restores the complete audit trail.
- **[New]** `apps/api/src/restore-audit-logs.ts` — idempotent utility to rebuild the audit trail from the snapshot union.

## 2026.8.14.002 — Snapshot Fixtures Are Now the Seed Source of Truth
- **[Update]** Boot reseed switched from hardcoded seed scripts to snapshot restore: `c7ntax-boot.ps1` now runs `seed-from-snapshots.ts` (full dataset from `apps/api/src/snapshots/`) plus the idempotent `seed-service-alerts.ts` role-permission backfill, instead of `seed-full.ts` + `seed-contacts.ts` + `seed-service-alerts.ts`.
- **[Update]** Restored the 4-service-board snapshot set from git history (commit 9ec9f67: MSP Service Desk, Intelligence Service Desk, Infrastructure Service Desk, NOC Alerts) along with the matching-era tickets/users/companies/agreements; the two HEAD-only cross-era fixtures (ticket-attachments, schedule-entries) were reset to empty so no foreign-key references dangle.
- **[Fix]** Root cause addressed: `seed-full.ts` hardcodes 3 boards and previously ran on every boot, after which verify/snapshot-poller captures overwrote the richer 4-board snapshot with the 3-board state. With snapshots as the source of truth, reseed now preserves the richer dataset and captures mirror it back.
- **[Verified]** Boot run green in 20s: snapshot reseed OK, backfill OK, login HTTP 200, frontend HTTP 200; DB shows 4 boards, 8 tickets, 6 users, 5 companies, 13 contacts, 5 agreements, 0 orphaned board references, 8 alert services; verify-post-change "All checks passed" and re-captured service-boards.json with 4 records.

## 2026.8.14.001 — Full System Audit & Configuration Corrections
- **[Fix]** `apps/api/.env` — `CORS_ORIGIN` corrected from stale `http://localhost:3001` to `http://localhost:3010` (matches `WEB_ORIGIN`/vite port); preflight now returns `Access-Control-Allow-Origin: http://localhost:3010` with credentials.
- **[Fix]** PostgreSQL service logging — `postgresql.conf`: `logging_collector = on`, `log_directory = 'log'`, `log_filename = 'postgresql-%Y-%m-%d.log'`; the Windows service previously wrote no logs, now service-mode PG writes daily logs to `data/log/` for crash diagnosis (0xC0000142/487 recurrence watch).
- **[Update]** `postgresql-c7ntax` service re-registered cleanly (Automatic, LocalSystem); verified against a full boot-script run.
- **[Audit]** Verified healthy: PG service Running/Automatic on 5432 with real backend queries; single API (:4000) + single vite (:3010) processes, no orphans; scheduled task "C7NTAX Boot Startup" (AtStartup+45s, Highest, StartWhenAvailable, 3x restart) LastTaskResult 0; Defender exclusions present for PG data/bin; Prisma schema valid + DB synced; sample data intact (6 users, 8 tickets, 3 boards, 5 companies, 13 contacts, 8 alert services, active alerts legitimate — Azure RSS incident + 2 seeded); all roles carry `servicealert:view`; full boot sequence re-run green in 21s with login HTTP 200; verify-post-change "All checks passed".
- **[Audit]** Known baseline: pre-existing strict-`tsc` errors remain in legacy files (`seed-ticket-tabs`, `seed-full`, `packages/billing`, `shared/features`, `KumoConfigs`, `KumoPasswords`, `Reports`, etc.) — runtime-unaffected (tsx strips types; seeds/API verified working at runtime); intentionally left untouched to avoid scope creep.

## 2026.8.13.004 — Automatic Startup on Reboot (Self-Healing Boot)
- **[New]** `startup/c7ntax-boot.ps1` — self-healing boot script that starts PostgreSQL (prefers the `postgresql-c7ntax` Windows service, ensures Automatic start, console fallback), verifies the DB with a real backend query, restarts PG up to 4x when backends cannot spawn, adds best-effort Defender exclusions for the PG data/bin dirs, syncs Prisma, reseeds sample data (seed-full + seed-contacts + seed-service-alerts) with exit-code checks and one retry, then launches the API (:4000) and frontend (:3010) and verifies login + page HTTP — every blocking call is time-bounded and logged to `startup/boot.log`.
- **[New]** Scheduled task "C7NTAX Boot Startup" (AtStartup + 45s delay, highest privileges, StartWhenAvailable, restarts 3x on failure) — the app is now fully functional automatically after every reboot, including sample-data reseed.
- **[Fix]** Root cause of the loading failure: PostgreSQL was down after reboot (no auto-start) and later entered a recurring failure mode where a backend/autovacuum worker dies with 0xC0000142 and the postmaster then cannot spawn backends (error 487) despite listening on 5432 — fixed by service-mode PostgreSQL, Defender exclusions, and the script's backend-query self-heal.
- **[Fix]** Boot-script portability fixes: pure-ASCII (PS 5.1 UTF-8 BOM), reserved `$args` renamed, Start-Process quoting for spaced paths, cmd /c wrapper for reliable exit codes.

## 2026.8.13.003 — Service Alerts Landing Directly
- **[Update]** Service Alerts is now a single top-level nav item with no children — clicking it opens the Service Alerts Dashboard directly as the section's landing page.
- **[Update]** Active-alert count badge remains on the Service Alerts nav item (expanded + collapsed sidebar).

## 2026.8.13.002 — Service Alerts as Top-Level Nav Section
- **[Update]** Service Alerts is now a top-level parent section placed between Dashboard and Tickets (Dashboard, Service Alerts, Tickets, Service Boards…); it expands to its own Dashboard landing page and is draggable like every other parent section.
- **[Update]** Service Boards restored to a single top-level link (no longer a parent); active-alert badge moved back to the Service Alerts parent section (expanded + collapsed sidebar).
- **[Fix]** Stale persisted nav orders are reconciled so the new top-level Service Alerts section inserts at its default position (after Dashboard) without wiping user customizations.
- **[Update]** Section-landing description moved to the Service Alerts section (Dashboard child); Service Alerts card remains on the Home landing page.

## 2026.8.13.001 — Service Alerts Nested Under Service Boards
- **[Update]** Service Alerts is now nested inside the Service Boards navigation section: Service Boards → (Service Boards, Service Alerts), matching the requested structure; the dedicated top-level Service Alerts parent section was removed.
- **[Fix]** Navigation now reconciles the persisted `c7_nav_order` against the nav tree on load — stale saved orders no longer hide new sections, and the removed top-level "service-alerts" id is dropped safely.
- **[Update]** Service Boards now carries the active-alert count badge (expanded and collapsed sidebar); the Service Alerts child keeps its own badge too.
- **[New]** Service Alerts card added to the Home landing page "Getting Started" grid, linking to the outage dashboard.
- **[Update]** Section landing descriptions added for Service Boards (dashboard + Service Alerts) and the Administration → Service Alerts settings page.

## 2026.8.12.019 — Service Alerts (Outage Monitoring & Alerting)
- **[New]** Draggable "Service Alerts" parent section in the app navigation (below Service Boards) with a live red badge showing the number of active alerts; Administration gains a "Service Alerts" configuration subsection.
- **[New]** Service Alerts dashboard (`/service-alerts`): aggregate outage cards for Microsoft 365, Azure, AWS, GitHub, Google Workspace, Comcast/Xfinity, Verizon, and Spectrum, each with official status-page and DownDetector links plus Outage/Degraded/Operational status badges; summary strip and recently-resolved list; alerts sourced from official status RSS feeds, status pages, and DownDetector.
- **[New]** Global outage banner below the header on every section: red, dismissable (X on the far right), clickable to the Service Alerts dashboard, example text "Possible Service Interruption has been reported for Microsoft 365. Click here for more details." (service name replaced as appropriate), persists across navigation until dismissed or auto-cleared.
- **[New]** Alerting mechanism: background monitor polls configured RSS feeds every 5 minutes, imports/parses RSS (no external deps), auto-creates an alert on outage/degraded keywords, and auto-resolves the alert + banner once a restored/resolved feed item appears. Status-page HTML keyword scraping deliberately avoided (false-positive prone); non-RSS services are monitored manually via the dashboard.
- **[New]** Administration → Service Alerts page (`/admin/service-alerts`): add/edit/delete monitored services, category, RSS/status-page/DownDetector URLs, dashboard visibility + feed-polling toggles, manual alert creation, "Run Monitor Check Now" with live run stats and feed-error log.
- **[New]** Backend: `ServiceAlertService` + `ServiceAlert` Prisma models, `/api/service-alerts` REST routes (status, alerts, services CRUD, manual alert, resolve, refresh, monitor-status), `servicealert:view` / `servicealert:manage` permissions added to shared enums and all default roles, seeded sample services/alerts, snapshot capture/reseed entries, sample-data-toggle wipe entries, and verify-post-change coverage.
- **[Fix]** Removed two false-positive auto-alerts generated during the initial HTML-probe run; monitor reverted to RSS-only detection.

## 2026.8.12.018 — Native Desktop OSS Plan
- **[New]** `native-desktop-oss-plan.md` — open-source edition of the native desktop plan: preserves goals and structure while replacing all proprietary tooling (Visual Studio → VS Code + dotnet CLI, MSIX GUI → msix-packaging CLI, signtool → osslsigncode + self-signed, MSVC AOT linker → LLVM clang/lld, Xcode → VS Code + swift.org toolchain + CLT, GitHub Actions → Forgejo/GitLab CE/Jenkins, commercial monitoring → GlitchTip/OpenTelemetry).
- **[New]** Includes license table per tool, no-purchase signing/distribution strategies (WinGet sideload, Homebrew Cask, Flathub), and a cost-comparison section flagging the only unavoidable costs (Apple hardware for macOS CI; optional paid certs for SmartScreen/notarization).

## 2026.8.12.017 — Native Desktop Clients Plan (Windows / Linux / macOS)
- **[New]** `native-desktop-plan.md` — plan only, no code: three native desktop apps using C#/.NET 8 + WinUI 3 (Windows), Rust + GTK 4/libadwaita (Linux), Swift 6 + SwiftUI/AppKit (macOS); Electron app remains and is updated alongside, not replaced.
- **[New]** Plan covers per-platform toolchains/SDKs/dependencies, installer packaging (MSIX/MSI/EXE, .deb/Flatpak, .pkg/.dmg with notarization), design-token parity with the WebUI, backend reuse (same REST API), security, and CI/CD.

## 2026.8.12.016 — Desktop App Now Replicates WebUI Exactly
- **[Update]** Desktop app rewritten to serve the exact built WebUI via a custom `app://c7ntax` protocol — same interface and session state as the browser; `/api/*` proxied to the API server so the relative API contract works unchanged; SPA fallback for client routing; stable origin keeps localStorage state (login, theme, sidebar) persistent.
- **[Update]** Production packages now bundle the freshly built WebUI (`prebuild` runs `vite build`; `extraResources` copies `web/dist` → `resources/webui`); dev mode loads the Vite dev server with hot reload.
- **[Update]** Window bounds persisted across launches; `npmRebuild` disabled to avoid the pnpm `workspace:` protocol breaking electron-builder; desktop menu navigation wired into the web router via a `DesktopNavBridge` (Settings/New Ticket/New Invoice shortcuts now work).
- **[Fix]** Pre-existing web strict-mode type errors blocking the build pipeline: Changelog date parsing non-null assertions, SectionLanding + HomePage icon types widened, Clients sort state typed as SortState, KumoConfigs state arrays typed; web `vite build` verified green.
- **[Update]** Portable exe rebuilt (144 MB) with the current WebUI and placed in `apps/desktop/dist-electron/`.

## 2026.8.12.015 — Native Mobile Applications Plan
- **[New]** `mobile-native-plan.md` — comprehensive phased plan for native Android (Kotlin + Jetpack Compose) and iOS (Swift + SwiftUI) apps replicating core C7NTAX desktop functionality; no code implemented (planning only).
- **[New]** Plan covers: Phase 0 foundations/tooling (Gradle version catalogs, Xcode, Fastlane, CI), Phase 1 backend enablement (versioned /api/v1 contract, OpenAPI codegen, device sessions, push via FCM/APNs, delta sync + ETags, offline queue), Phases 2–3 app builds (MVVM, Room/SwiftData offline cache, WorkManager/BackgroundTasks, biometrics), Phase 4 security (certificate pinning, Keystore/Keychain, refresh-token rotation, privacy manifests, data safety), and Phase 5 store publishing (Play App Signing, App Store Connect, Fastlane lanes, review guidelines, maintenance).

## 2026.8.12.014 — Add Time Entry Button on Dates & Times Card
- **[Fix]** Restored the time-entry button on the Dates & Times card — previously labeled "Log Time", now labeled "Add Time Entry" to match the Time tab; placed in the card header right of the title.
- **[Update]** Card button keeps the small `text-xs` cyber-styled size (Timer icon, 12px) matching the previous "Log Time" styling; opens the same Add Time Entry dialog used by the Time tab, so time can be added from both locations.
- **[Update]** Notes & Activity inline toggle button renamed "Log Time" → "Add Time Entry" for consistency.
- **[Update]** Time tab functionality unchanged (same dialog, totals, and list).

## 2026.8.12.013 — Tab Dialog Data Fully Connected Across the App
- **[New]** Attachments tab now uses real `TicketAttachment` records — new API endpoints `POST /tickets/:id/attachments` and `DELETE /tickets/:id/attachments/:attId`; ticket detail includes attachments; the dialog accepts a real file (name/size/type stored, content storage placeholder); legacy customFields attachments migrated into real records.
- **[Update]** Configurations tab — linked configurations now carry `kind` + `refId` pointing to real assets and Kumo servers; each row has an Open link (assets → /assets/:id, Kumo servers → /kumo/configs, Kumo assets → /kumo/assets/:id); the link dialog now fetches the correct `/kumo/configs/servers` endpoint.
- **[New]** Links tab shows incoming (reverse) links — tickets that link to the current one are computed and displayed with Open buttons, making links two-way.
- **[Update]** Finance tab now includes a Products total card (5-card summary).
- **[New]** Kumo server records seeded (5 servers linked to Kumo assets) so Kumo → Configurations and the link dialog are populated; snapshot capture and reseed lists now include `ticketAttachment` and `kumoServer` (43 tables).
- **[Update]** `seed-full.ts` creates real attachments, Kumo server records, and links ticket configurations to real asset/Kumo-asset IDs after entity creation; `seed-ticket-tabs.ts` migration re-run; snapshot recaptured (259 records).

## 2026.8.12.012 — Ticket Tab Sample Data Seeded Across All Tickets
- **[New]** Every ticket now shows representative content in all toolbar tabs — seeded per ticket: 2 configurations, 2 products, 2 links, 2 attachments (customFields), 2 expenses (Expense rows), 2 schedule entries (ScheduleEntry rows), 1 History change-log comment, and 2 audit trail entries.
- **[New]** `seed-ticket-tabs.ts` — idempotent seeding script for existing databases; added `scheduleEntry` to snapshot capture and reseed lists so the new data survives the snapshot/reseed cycle (new `schedule-entries.json` fixture, 42 tables total).
- **[Update]** `seed-full.ts` — full reseeds now create the same ticket tab data (cleanup added for expense, scheduleEntry, and auditLog).
- **[Update]** Billing → Time & Expenses now shows an Expenses section — a linked ticket expense created in the ticket tab dialog appears there with ticket number, category, date, and amount; expenses total line included.

## 2026.8.12.011 — Sample Data Toggling
- **[New]** Sample data toggling — `pnpm db:sample-off` (disable) and `pnpm db:sample-on` (enable), backed by `apps/api/src/sample-data-toggle.ts`.
- **[New]** Disable flow — captures a snapshot as usual, wipes all business data (identity and platform config preserved so login/RBAC/settings still work), then sets a marker flag (`.sample-data-disabled`).
- **[New]** While disabled — snapshot captures are locked (auto-snapshot middleware, snapshot poller, and the capture script all skip), so the preserved snapshot is never overwritten and no automatic reseed occurs after changes.
- **[New]** Enable flow — reseeds from the preserved snapshot files via the established `seed-from-snapshots` process, then clears the flag so the snapshot-after-change process resumes.
- **[New]** Command detection rule — "disable sample data"/"turn off sample data" and "enable sample data"/"turn on sample data" only apply as explicit standalone commands; when those phrases appear inside a natural-language sentence they are ignored and treated as a normal prompt.

## 2026.8.12.010 — Ticket Detail Two-Column Layout Restored & Compact Tabs
- **[Fix]** Classification & Details and Client Info cards moved back to their original location — right column beside the General card (restored `lg:grid-cols-3` with the left column spanning 2); both cards' display and edit modes fully functional.
- **[Update]** Toolbar card spans the full width of both columns (General left, Classification & Details right) per the reference screenshot.
- **[Update]** Toolbar tab labels compacted — `text-xs` with `px-2 py-1`, zero gap between tabs — so all 12 tabs fit without horizontal scrolling on desktop widths.

## 2026.8.12.009 — Square Date Cards on All Calendars
- **[Update]** Calendar page and Time Off page day cells changed from `min-h-[60px]` rectangles to true squares via `aspect-square` — cleaner visual style per reference screenshot.
- **[Update]** Calendar cards constrained to `max-w-3xl` so square cells stay small (~100px per cell) and the full month (including 6-week months) fits on a single screen without scrolling.
- **[Update]** All existing behavior preserved: month navigation, jump-to-today, today/selected highlights, event chips with "+N more", click-a-date filtering, and clear-filter rows.

## 2026.8.12.008 — ConnectWise-Style Ticket Detail Toolbar & Tabs
- **[New]** Full-width toolbar card on ticket detail — tabbed interface with 12 tabs (Ticket, Configurations, Products, Activities, Time, Links, Expenses, Schedule, Attachments, History, Finance, Audit Trail); Tasks, Open Tickets, Conversions, Surveys, and RMA excluded per spec.
- **[New]** Icon toolbar below the tabs — Refresh, Add Note, Log Time, and Attach are functional; Email, Print, Follow Up, and More Actions are placeholders with "coming soon" toasts.
- **[Update]** Ticket detail layout — General and Classification & Details cards now each sit on their own full-width row under the toolbar (single-column stack).
- **[New]** Configuration dialogs for every tab — Link Configuration (searches assets + Kumo configurations), Add Product (qty/cost with totals), Link Ticket (search + relation type), Add Expense (backed by /billing/expenses), Schedule Entry (backed by /schedule with ticketId), Attach File (metadata placeholder), and Add Time Entry.
- **[Update]** Lightweight tab data (linked configurations, products, links, attachments) persisted in the ticket's `customFields` JSON — tickets PATCH now accepts `customFields` and excludes it from change-comment logging.
- **[Fix]** Time entry logging now posts to the correct `/tickets/:id/time` endpoint (was `/time-entries`, which does not exist).
- **[New]** Activities tab merges notes and time entries into one chronological feed; History tab shows friendly field-change log; Finance tab shows billable/non-billable totals, expenses, and agreement summary; Audit Trail tab lists ticket-scoped system audit records.

## 2026.8.12.007 — Clear Selected-State Highlight in Navigation
- **[Update]** Sidebar selected/active items now use the same light `bg-surface-lighter` background with white text as the hover state — replacing the previous faint cyber tint that was hard to distinguish.
- **[Update]** Applied consistently across all four nav rendering paths: collapsed-mode icon buttons, collapsed-mode links, expandable parent sections, and leaf/section links; the existing accent indicators (active chevron and collapsed-mode edge bar) remain as secondary cues.

## 2026.8.12.006 — Time Off Monthly Calendar
- **[New]** Monthly calendar added to the Time Off page above the PTO Requests card — same Outlook-style mini-card design used on the Calendar page (subtle cell borders, top-left date numbers, month navigation, today highlight).
- **[New]** PTO requests appear as status-colored chips across their full date span in the calendar (green = approved, red = denied, amber = pending), up to 2 chips per day with "+N more" overflow.
- **[New]** Click-a-date filtering — selecting a calendar date filters the PTO Requests table to requests covering that date, with a clear-filter row.
- **[Update]** PTO Requests card now has a header showing total count or filtered count; request form resets after submission.

## 2026.8.12.005 — Outlook-Style Mini-Card Month Calendar
- **[Update]** Monthly calendar redesigned — smaller, visually cleaner day cells in mini-card style with subtle borders (`border-surface-border`), rounded corners, and consistent `gap-1` spacing.
- **[Update]** Date number moved from center to top-left corner of each day cell; day-of-week headers compacted to uppercase micro-labels.
- **[Update]** Event dots replaced by Outlook-style event chips — up to 2 chips per cell showing time and title in the event's color, with "+N more" overflow text.
- **[Update]** Today highlight (cyber border + tint) and selected-date highlight (stronger cyber border + background) preserved; all existing behavior intact: month navigation, click month/year to jump to today, click-a-date filtering, clear-filter row.

## 2026.8.12.004 — Friendly Notes & Activity Card in Ticket Details
- **[Fix]** Ticket change comments no longer contain raw UUIDs or ISO timestamps — the API now resolves board, assignee, contact, company, and service agreement IDs to friendly names, and formats dates as readable strings when generating change-log comments.
- **[Fix]** Legacy change-log comments with raw values (e.g., "Board: 81f12ded-… → 9e4422d8-…") are now rendered friendly in the Notes & Activity card — UUIDs are resolved to names from loaded lookups and ticket relations, ISO timestamps become readable dates, and snake_case enums become title case.
- **[Update]** Comment badges now distinguish Email (purple), Internal (amber), and Note (blue); email-sourced comments show the sender email as author fallback.
- **[Update]** Author/user fallbacks — comments and time entries without an author display "System" instead of "undefined undefined"; time entries show their entry date.

## 2026.8.12.003 — Audit Log Username + UserID & Default Expanded Entries
- **[Update]** Audit log entries now display both the friendly username and the UserID (8-character prefix) — e.g., "Fiona Ray (a1b2c3d4)"; system entries show only "System".
- **[Update]** Audit Logs page defaults — the top three most recent day groups are expanded on open; all older groups default to collapsed; each group toggles independently.

## 2026.8.12.002 — feature_list.json Renamed to BuildNotes.json
- **[Update]** Data source rename — `apps/api/src/feature_list.json` renamed to `apps/api/src/BuildNotes.json` to match the BuildNotes.md naming convention.
- **[Update]** API resolver renamed — `parseFeatureList()` renamed to `parseBuildNotes()` in `apps/api/src/routes/system.ts`; the `/api/system/changelog` fallback now loads `../BuildNotes.json`.
- **[Update]** Frontend parser renamed — `parseFeatureList()` renamed to `parseBuildNotes()` in `apps/web/src/pages/Changelog.tsx`.
- **[Update]** Historical changelog references — BuildNotes.md (root and public copies) entries that named `feature_list.json` as the What's New data source now reference `BuildNotes.json`.
- **[Fix]** What's New continuity — all three changelog sources (public BuildNotes.md, root BuildNotes.md, BuildNotes.json) remain in sync and are updated after every change.

## 2026.8.12.001 — Calendar, Permissions UX & Human-Readable Audit Logs
- **[New]** Monthly calendar card — Outlook-style month grid above Scheduled Events on the Calendar page with prev/next month navigation, colored event indicators on each date, today highlighting, and click-a-date filtering of the event list below.
- **[New]** Batch action confirmation — the "Modify Selected" ticket menu now shows checkboxes next to each action with an OK button that applies only the checked actions and a Cancel button that dismisses without changes; multiple checked actions run sequentially with per-action success/failure reporting.
- **[New]** Audit log user name resolution — `GET /system/audit-logs` now resolves user IDs to full names ("Stephen Simmons") instead of truncated UUID prefixes.
- **[Update]** Human-readable audit log display — raw JSON and code blocks eliminated from the Audit Logs page; every event renders as a narrative sentence (e.g., "updated ticket #a1b2c3d4 — status to in progress") with friendly entity/field labels, "enabled/disabled" for booleans, "(redacted)" for masked values, and flattened nested objects.
- **[Update]** Modify Selected menu labels — batch action items now display human-readable names ("Set Status → In Progress") instead of raw machine values like `status_in_progress`.
- **[Update]** Schedule events keep their color — the schedule POST endpoint now accepts and stores the `color` field so newly created calendar events render with the chosen color in both the event list and monthly calendar indicators.
- **[Fix]** Permissions tab false yellow highlight — the amber deviation indicator on Manage Users permissions no longer appears when loaded permissions exactly match the user's assigned role; comparison is always against the role's actual permissions and updates live while toggling.
- **[Fix]** Permissions role-template mismatch — the "Apply role defaults" dropdown no longer drives deviation highlighting; it applies presets only, while the highlight always compares against the assigned role.
- **[Fix]** Project Calendar loading — the Calendar page now handles both array and wrapped API response shapes reliably and resets the create form after adding an event so new events display immediately.

## 2026.8.11.001 — CloudConnect, Batch Tickets, Audit Logging & Kumo Fixes
- **[New]** CloudConnect action screen — clicking a connected integration tile opens a modal with user preview, field mapping, company assignment, and sync controls.
- **[New]** DummyConnect simulator — a persistent, always-active integration for exploring any connector's interface without live credentials. Includes a type selector dropdown with all 16 integration types.
- **[New]** Batch ticket operations — checkbox column on every ticket row with Select All; "Modify Selected" dropdown appears when tickets are checked, supporting bulk status and priority changes.
- **[New]** Individual ticket Modify menu — ChevronDown button per row opens a dropdown with Acknowledge, Close, Set Status, and Set Priority actions; excludes predecessor options.
- **[New]** Ticket filter dialog — Filter button opens a modal with Status, Priority, Assigned Technician, and Date Range fields; structured for easy addition of future filter fields.
- **[New]** Comprehensive audit logging — every create, update, and delete operation across the entire application is logged to the AuditLog model with user identity, entity type, change summary, and IP address.
- **[New]** Audit Logs page — now fetches from `GET /system/audit-logs` instead of ad-hoc ticket/invoice queries; displays all operations grouped by date with action type, detail, and user identity.
- **[New]** Auto-incremented IDs in What's New — each BuildNotes entry displays a `#ID` badge for user reference when submitting prompts.
- **[New]** Password generator — "Generate" button with eye toggle added to Kumo Passwords create/edit dialogs and Manage Users create/change-password sections.
- **[New]** Super Admin role — `super_admin` system role with all permissions; sessions never expire due to inactivity.
- **[New]** Editable session timeout — Settings page card with configurable inactivity timeout (5–480 minutes, default 30); stored in SystemConfig; sessionAuth middleware reads dynamically.
- **[New]** Snapshot polling system — background service polls at varying intervals with jitter and adaptive backoff; detects new records from any source and triggers snapshot captures.
- **[Update]** Admin role permissions expanded from 24 to 79 — now includes Kumo, Assets, Projects, KB, Opportunities, Procurement, Schedule, PTO, Inference, and Security permissions.
- **[Update]** Kumo seed data cleanup fix — Kumo tables now properly deleted in reverse FK order before re-seeding, preventing data accumulation.
- **[Update]** FEATURE_LIST.md renamed to BuildNotes.md — all 16 references updated across the codebase including Vite plugin, fetch paths, API resolver, README, and self-references.
- **[Update]** CloudConnect error fix dialog — clickable error banners open a modal with per-field editable inputs, Test buttons, pass/fail results, and "OK — Save All Fixes" when all resolved.
- **[Update]** Credential helpers — `getRequiredCredentials()`, `formatCredLabel()`, `getCredFix()`, `getCredExample()`, `checkCredFormat()` added for all 16 integration kinds.
- **[Update]** Test endpoint enhanced — returns structured `fieldErrors[]` with fix instructions and example values on failure.
- **[Update]** Snapshot capture now includes `auditLog`, `kumoTemplateField`, `kumoAssetFieldValue` tables; 41 tables total.
- **[Update]** Permissions refresh logic — now refreshes on any permission difference (`hasNew || hasLess`), not just count increase.
- **[Fix]** Kumo password reveal "access denied" — decrypt failures now handled gracefully with placeholder fallback text.
- **[Fix]** Kumo password TOTP setup — IV and authTag now stored delimited in `totpSecret` field; decrypt uses correct per-record encryption params.
- **[Fix]** Kumo password edit flow — save now sends only editable fields in payload; password field clears after save; reveal card refreshes with updated "last changed by" after password change.
- **[Fix]** Kumo reveal card stuck on entry switch — `selectPassword()` now clears `revealData` and `showEditPwd` when switching entries.
- **[Fix]** Kumo seed passwords — placeholder `ENC:` values replaced with properly AES-256-GCM-encrypted sample passwords.
- **[Fix]** Kumo PATCH endpoint — `updatedById` now set on every password edit; password change encrypts new value with correct IV/authTag.
- **[Fix]** Manage Roles "Changed" indicator — amber badge now only appears when `editPerms` differs from `originalPerms`; no false positives on initial edit open.
- **[Fix]** Manage Roles user count banner — now always visible; "0 users assigned to this role" is clickable and opens the member management modal.
- **[Fix]** "New Board" button removed from main Service Boards page; board creation now only possible under Administration → Service Boards.
- **[Fix]** Service Boards snapshot — manual data changes now captured; snapshot updated from 3 to 4 boards with correct SLA settings.
- **[Fix]** AutoSnapShot path — `CAPTURE_SCRIPT` corrected from `snapshot-capture.ts` to `../snapshot-capture.ts`, fixing MODULE_NOT_FOUND crash on server start.
- **[Fix]** `Eye`/`EyeOff` imports added to Users.tsx — fixing `ReferenceError: Eye is not defined`.
- **[Fix]** Ticket batch endpoint — `POST /tickets/batch` added to tickets router supporting `updateMany` for status and priority.
- **[Fix]** Retrace.md — expanded from 18 to 37 entries; all prompts standardized with BuildNotes IDs, verbatim text, and detailed change lists.

## 2026.8.10.003 — Header Descriptions & Section Landing Pages
- **[New]** Dynamic section header — every page now displays its section name alongside a brief contextual description rendered on a single line in the top navigation bar, replacing the previous title-only header with a formatted `{Section Name} — {description}` layout that stays on one line and leaves generous spacing before the Search button.
- **[New]** 36 section descriptions — mapped across all application routes (e.g., `/`, `/tickets`, `/kumo`, `/billing`) with intelligent parent-path fallback so nested pages (e.g., `/kumo/assets/abc123`) inherit their parent section's description rather than showing nothing.
- **[New]** Collapsible resizable sidebar — icon-only mode (64 px) with persistent width stored in localStorage; drag-to-resize handle on the right edge of the sidebar; clicking a parent section in collapsed mode navigates to a landing page instead of expanding the sidebar.
- **[New]** Section landing pages — clicking any parent section (Administration, Clients, Assets, Users & Roles, Projects, Kumo, Billing, Reports) while the sidebar is collapsed opens a card-grid landing page listing every subsection with its icon, label, and a brief description of its functionality.
- **[New]** Breadcrumb navigation bar — hierarchical path shown on every page with clickable parent segments; the first segment is always "Home" with a house icon linking to `/home`; all segments including the current page are clickable.
- **[New]** Auto-snapshot capture — the database state is automatically dumped to 38 snapshot fixture files (`src/snapshots/*.json`) after any successful POST, PUT, PATCH, or DELETE operation, with 5-second debouncing to coalesce rapid consecutive writes into a single capture.
- **[New]** Snapshot capture-to-reseed pipeline — the `pnpm db:capture` and `pnpm db:reseed` scripts provide a full round-trip: wipe the database in dependency order (children before parents), re-seed every table from captured JSON fixtures, and output record counts for verification.
- **[New]** Recently Viewed tracking — browsing Kumo assets (`/kumo/assets/:id`), passwords (`selectPassword()`), configurations (`setSelected()`), and documents (`openDoc()`) now automatically records views via `POST /api/kumo/recently-viewed`; the Kumo Dashboard polls `GET /api/kumo/recently-viewed` every 10 seconds for live updates without full page reload.
- **[New]** Header toolbar — Search, Recent (Clock icon), AI (Sparkles icon), Help (HelpCircle icon), Settings (Settings icon), and My Account (UserCircle icon, cyber-accented) placeholder buttons rendered in the top-right of the application header bar, hidden on mobile screens below the `sm` breakpoint.
- **[Update]** CloudConnect rebrand — the "Integrations" navigation item (formerly `admin-integrations`, route `/integrations`, API mount `/api/integrations`, component `IntegrationsPage`, file `Integrations.tsx`) has been renamed to "CloudConnect" (`admin-cloudconnect`, `/cloudconnect`, `/api/cloudconnect`, `CloudConnectPage`, `CloudConnect.tsx`); all 12 cross-reference files updated including Dashboard quick-links, Settings landing page, and the Administration card grid.
- **[Update]** Extended contacts seed — the database seed script (`seed-full.ts`) now creates 13 contacts across 5 companies (up from 5 contacts) with full PSA-standard fields: phone (`+1-555-XXXX`), mobile, title (IT Director, VP Operations, CEO), department, and `isActive` boolean.
- **[Update]** Resequenced version numbering — all 25 entries in BuildNotes.md and 7 entries in BuildNotes.json (the What's New data source) converted from semantic-like versions (`v1.11.001`) to date-based `Year.Month.Day.Build` format (e.g., `2026.8.10.003`); build number starts at `001` each day and increments sequentially for same-day releases.
- **[Update]** Manage Roles rename — "Roles & Permissions" (navigation label, page title `<h2>`, SectionLanding description, BuildNotes.json changelog entries x2, BuildNotes.md sub-item reference) has been renamed to "Manage Roles" across the entire codebase; the parent "Users & Roles" section and `/roles` route path remain unchanged.
- **[Update]** Home breadcrumb — the top-level breadcrumb label changed from "Dashboard" to "Home" with a house icon; a new `/home` route renders a `HomePage` with a welcome message and 12-card Getting Started grid linking to Tickets, Boards, Pipeline, Clients, Billing, Projects, Assets, KB, Kumo, Users, Roles, and Administration; the "Home" nav section sits fixed at the top of the sidebar and is non-draggable.

## 2026.8.10.002 — Recently Viewed on Kumo Dashboard
- **[New]** Recently Viewed card replaces Implementation Status on the Kumo Dashboard
- **[New]** Tracks user access across all Kumo item types: Passwords, Configurations, Flexible Assets, Documents, Domains, Certificates, and Universal Links
- **[New]** New `RecentlyViewedItem` Prisma model with per-user deduplication via `@@unique([userId, entityType, entityId])`
- **[New]** API endpoint `POST /api/kumo/recently-viewed` upserts view records when users access items
- **[New]** API endpoint `GET /api/kumo/recently-viewed` returns last 20 items for the current user, ordered by most recent
- **[New]** Real-time 10-second polling keeps the Recently Viewed list current without manual refresh
- **[New]** Items display with color-coded type indicators (amber=passwords, green=configs, cyber=assets, purple=docs, blue=domains, yellow=certs)
- **[New]** Each entry shows the item name, type label, and relative timestamp ("just now", "5m ago", "2h ago", "3d ago")
- **[New]** Clicking an item navigates to its detail page (assets link to specific asset, others link to their list pages)
- **[Update]** Preserved C7NTAX dark navy/cyber theme across all new components
- **[Update]** Renamed Integrations navigation → CloudConnect; moved What's New below CloudConnect in Administration menu
- **[Update]** Route /integrations → /cloudconnect; API /api/integrations → /api/cloudconnect; frontend page Integrations.tsx → CloudConnect.tsx

## 2026.8.9.003 — Comprehensive Reporting Suite
- **[New]** Reporting section added to navigation tree with Dashboards, Standard Reports, Analytics sub-items
- **[New]** Dashboard tab: KPI cards (total tickets, SLA response%, revenue, outstanding), ticket status/pie chart, priority distribution, SLA compliance gauges, technician utilization table, monthly revenue bars
- **[New]** Standard Reports tab: 6 pre-built report cards (Ticket Volume, SLA Performance, Revenue Summary, Technician Utilization, Aging Report, Board Summary) with live preview and run capability
- **[New]** Analytics tab: ticket volume by status/priority/board visual bars, SLA met/breached gauges, technician billable hours ranking, monthly revenue history chart
- **[New]** 4 new API endpoints: GET /reports/data/ticket-volume, /sla-compliance, /technician-utilization, /revenue-summary
- **[New]** Visual bar charts implemented with pure CSS + JS (no chart library dependency)
- **[Update]** Report data refreshes on tab switch
- **[Update]** Consistent card-based layout matching all other application pages

## 2026.8.9.002 — Comprehensive Billing Suite
- **[New]** Tabbed billing interface: Invoices, Agreements, Payments, Time & Expenses, Reports
- **[New]** Invoices tab: list with status + date filtering, generate from unbilled time, send, PDF, record payment
- **[New]** Agreements tab: service agreement management with billing period, amount, auto-invoice toggles
- **[New]** Payments tab: full payment history with method, reference, linked invoice, client
- **[New]** Time & Expenses tab: billable/non-billable time entries with invoice status, total tracked
- **[New]** Reports tab: revenue summary (total invoiced, collected, overdue), aging summary, quick actions
- **[New]** New API endpoints: GET /billing/payments, GET /billing/reports/revenue
- **[New]** Invoice status badges: Draft, Sent, Partial, Paid, Overdue, Void
- **[New]** Payment method tracking: credit_card, ach, check, wire, flexpoint, other
- **[Update]** All pages maintain consistent dark theme design patterns

## 2026.8.9.001 — Past Due Tasks Auto-Update
- **[New]** Added `isOverdue` boolean field to Ticket model in Prisma schema
- **[New]** Worker job `processPastDueTickets` runs every 15 minutes:
  - Finds tickets where `dueDate < NOW()` and status is not resolved/closed/cancelled
  - Sets `isOverdue = true` and notifies assigned technician
- **[New]** "OVERDUE" badge displayed on ticket list rows (red background, next to status)
- **[New]** "OVERDUE" badge displayed on ticket detail view near the due date
- **[Update]** Updated shared Ticket TypeScript interface with `isOverdue: boolean`
- **[Update]** Prisma db push syncs the new column to PostgreSQL

## 2026.8.8.002 — Bug Fixes & Audit
- **[Fix]** Fixed user creation: API now looks up Role by systemRole name, uses roleId FK
- **[Fix]** Fixed user list display: role field now returned as flat string from API
- **[Fix]** Fixed auth route: user.active → user.isActive (2 instances causing login failures)
- **[Fix]** Fixed users GET endpoint: properly maps role systemRole + company name
- **[Fix]** Fixed dashboard resolvedToday: now fetches resolved tickets count directly
- **[Update]** Full frontend audit: Dashboard, Settings, Opportunities, Projects, Clients, Integrations, Knowledge Base, Inference — all verified no additional bugs

## 2026.8.8.001 — Collapsible Tree Navigation & Section Expansion
- **[New]** Sidebar restructured as collapsible tree with parent sections
- **[New]** Sections: Administration, Clients, Assets, Users & Roles, Projects
- **[New]** Expand/collapse state persisted to localStorage
- **[New]** Administration expanded with: General Settings, Service Boards, Audit Logs, Integrations
- **[New]** New AdminServiceBoardsPage: board list with inline SLA/auto-close/follow-up settings
- **[Update]** "New Board" button moved to Administration → Service Boards page
- **[Update]** Board settings: SLA response/resolution times, auto-close toggle/days, follow-up toggle/intervals
- **[Update]** Clients section with Client List sub-item
- **[Update]** Assets section with Asset Inventory and Procurement sub-items
- **[Update]** Users & Roles section with Manage Users and Manage Roles sub-items
- **[Update]** Projects section with Project List sub-item
- **[New]** New Procurement placeholder page created
- **[New]** Administration landing page shows card grid linking to all admin sub-sections
- **[Update]** Ticket list header button renamed from "New Ticket" to "Create"

## 2026.8.7.004 — Service Boards Dashboard & Ticket Board Filtering
- **[New]** Boards page redesigned: each board is a metric card with 10+ live KPIs
- **[New]** Metric cards show: open, workable, new, on hold, waiting, escalated, avg age
- **[New]** Stale ticket tracking: >3d, >7d, >30d with color-coded severity
- **[New]** Most active client per board (last 30 days)
- **[New]** Real-time polling: metrics refresh every 10 seconds while page is open
- **[New]** Cards are clickable — navigates to tickets filtered by that board
- **[New]** `GET /boards/metrics` API endpoint with all computed stats
- **[New]** Ticket list: added Service Board column
- **[New]** Ticket list: board filter dropdown to switch between boards
- **[New]** Breadcrumb navigation when viewing board-filtered tickets
- **[Update]** Sidebar C7 branding updated to red #C42D4B

## 2026.8.7.003 — Invoice PDF & Auth Token in Query
- **[New]** Double-click any invoice row to open styled PDF invoice in new tab
- **[New]** PDF button in invoice table actions and detail modal
- **[New]** `GET /billing/invoices/:id/pdf` returns dark-themed styled HTML invoice
- **[New]** Invoice PDF shows: C7NTAX branding, bill-to/from, line items, totals, payments, balance
- **[New]** Authenticate middleware now accepts `?token=` query param (for new-tab PDF links)
- **[Fix]** seed-full.ts restored (was corrupted by cache hygiene)
- **[Update]** Full database reseeded with 6 users, 5 companies, 8 tickets, etc.

## 2026.8.7.002 — Layout Restructure & Client Type
- **[Update]** Merged Classification and Details cards into single right-column card
- **[Update]** Left column now: General, Dates & Times only (cleaner layout)
- **[New]** Client Type badge displayed under company name (MSP/INT/INF from DB)
- **[Update]** Logged Time entries now show "Time Entry" activity badge instead of raw date string
- **[Update]** Time entry author names include both firstName and lastName
- **[Update]** Created/Updated dates moved to bottom of combined card with separator

## 2026.8.7.001 — Notes & Activity Unified Feed
- **[New]** Combined comments and time entries into single sorted activity feed
- **[New]** Activity type badges: Note (blue), Internal Note (amber), Email Note (purple), Time Entry (green)
- **[Update]** Author names now show firstName + lastName (was previously only firstName)
- **[Update]** Email-sourced notes show fromEmail as author fallback
- **[Fix]** API ticket detail now includes contact relation (was missing)

## 2026.8.6.004 — Sidebar Reorganization & Drag-and-Drop
- **[New]** BuildNotes.md created with full versioning scheme
- **[Update]** Administration moved below Integrations in sidebar nav
- **[New]** Sidebar navigation sections reorderable via drag-and-drop (GripVertical handle)
- **[New]** Nav order persisted to localStorage across sessions

## 2026.8.6.003 — Rebrand to C7NTAX
- **[Update]** All source code, configs, package names rebranded
- **[Update]** Logo updated
- **[Update]** Sidebar branding: NT/NTAX
- **[Update]** Folder renamed from c7-overwatch to C7NTAX
- **[Update]** GitHub repo published at github.com/C7-IMI/c7-overwatch
- **[New]** Windows desktop app compiled (portable .exe + zip)
- **[Fix]** Electron 33.2.1 binary download issue resolved

## 2026.8.6.002 — Dashboard & Navigation
- **[Update]** Dashboard stat cards made clickable with pre-applied filters
- **[New]** 9 quick-link modules on dashboard
- **[Update]** Cards made clickable on Projects, KB, Clients pages
- **[Fix]** Unused imports removed from Billing, Users, Projects, Assets, KB

## 2026.8.6.001 — Bug Fixes
- **[Fix]** Fixed prisma.ticketNote → prisma.ticketComment (model name mismatch)
- **[Fix]** Fixed prisma.integrationConfig → prisma.integration
- **[Fix]** Fixed comment content → body field name
- **[Fix]** Fixed worker.ts enabled → isActive
- **[Fix]** Fixed ticket comments → notes field name in frontend
- **[Fix]** Fixed boardId not recognized by stale Prisma client (regenerated)

## 2026.8.5.005 — Administration Section
- **[New]** Administration nav item with Shield icon
- **[New]** Logs sub-section: cumulative change log grouped by day
- **[New]** Client IDs (4-digit) and Client Types (MSP, INT, INF) in database

## 2026.8.5.004 — Billing Overhaul
- **[Fix]** Billing/invoice API fixes: billingAmount, minutes field names
- **[New]** Invoice view modal with line items
- **[New]** Record payment modal with method selector
- **[New]** Send invoice functionality
- **[New]** Company dropdown in generate invoice form

## 2026.8.5.003 — Ticket Detail Overhaul
- **[New]** Fully editable ticket detail screen with Audit Trail
- **[New]** Inline toggle between view/edit modes
- **[New]** Start time and end time fields
- **[New]** ClientType selector (MSP, INT, INF)
- **[New]** Service agreement auto-display when company selected
- **[New]** Contact dropdown filtered by company
- **[New]** Cumulative time spent display
- **[New]** Log Time modal with start/end time auto-calculation
- **[New]** Inline note posting (Enter to submit)
- **[New]** Ticket numbering scheme: ClientType-ClientID-Sequential

## 2026.8.5.002 — Database & Infrastructure
- **[New]** PostgreSQL 18 installed via Scoop
- **[New]** Database c7_overwatch created and schema pushed
- **[New]** Sample data populated: 6 users, 5 companies, 5 contacts, 3 boards, 8 tickets, 3 agreements, 4 invoices, 3 projects, 5 assets, 4 KB articles, 3 opportunities
- **[New]** Dev error logger with timestamps, rotation, git commit tracking
- **[Update]** Configurable default landing page (/settings)

## 2026.8.5.001 — Auth Fixes
- **[Fix]** Fixed login: user.active → user.isActive (field name mismatch)
- **[Fix]** Fixed login: added include: { role: true } for proper relation loading
- **[Fix]** Fixed login: user.role.systemRole instead of user.role as cast
- **[New]** Added email + username dual login support
- **[New]** Bypass login link on login page

## 2026.8.4.004 — Bug Fixes: Blank Page, Build Errors
- **[Fix]** Fixed @c7-overwatch/shared workspace resolution in Vite
- **[New]** Added ErrorBoundary to main.tsx
- **[Fix]** Fixed 401 interceptor redirect loop on login page
- **[Fix]** Fixed useAuth User type import (inlined locally)
- **[New]** Added noscript fallback and critical CSS to index.html
- **[Fix]** Fixed missing TestTube import in InferenceSettings
- **[New]** Created pnpm-workspace.yaml for proper monorepo resolution
- **[Fix]** Fixed Prisma schema validation errors (ambiguous relations, SQLite incompatibilities)
- **[Update]** Port changed from 5173 → 3001 → 3003
- **[New]** Environment config (.env) created

## 2026.8.4.003 — AI Inference Engine
- **[New]** Pluggable AI provider system (OpenAI, Anthropic, Azure, local keyword search)
- **[New]** Ticket solution suggestions from resolved ticket history
- **[New]** Pattern detection: recurring issues, SLA risks, knowledge gaps
- **[New]** InferencePanel component embedded in ticket detail screen
- **[New]** Admin UI for AI provider configuration (/settings/ai)

## 2026.8.4.002 — CRM, Projects, Inventory, Procurement, PTO, Surveys, KB, Chat, Workflows, Reports, SSO, I18N, Currency, Retention, Calendar, Bulk Ops
- **[New]** 40+ new Prisma models covering all PSA feature areas
- **[New]** Full API routes for all new modules
- **[New]** Frontend pages: Opportunities (CRM pipeline), Projects, Asset Inventory, Knowledge Base
- **[New]** PWA manifest and service worker for mobile/offline support

## 2026.8.4.001 — Core Platform Scaffold
- **[New]** Monorepo with Turborepo (apps/api, apps/web, apps/desktop, packages/shared, packages/email, packages/billing, packages/integrations)
- **[New]** Express + TypeScript REST API with PostgreSQL via Prisma ORM
- **[New]** React + Vite + Tailwind CSS frontend with dark theme (navy/cyber palette)
- **[New]** Shared Zod schemas and TypeScript types across frontend/backend
- **[New]** JWT authentication with MFA (TOTP authenticator + email codes)
- **[New]** RBAC with 8 roles and 25 granular permissions
- **[New]** Client-scoped data access (company-based isolation)
- **[New]** Ticket management: CRUD, status workflow, auto-follow-up, auto-close
- **[New]** Service boards with email connectors (IMAP ticket ingestion)
- **[New]** Billing engine: service agreements, invoicing, payments, PDF generation
- **[New]** 10 third-party integration adapters (Flexpoint, QuickBooks, Pax8, Avanan, Proofpoint, SentinelOne, ITGlue, Microsoft 365, Azure, AWS)
- **[New]** Electron desktop wrapper for Windows
- **[New]** OpenAPI 3.1 specification
