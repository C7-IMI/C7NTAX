> **Plan ID:** PLAN-015
> **Title:** C7NTAX Feature Backlog — UI, Billing, Kumo, Integrations & Infrastructure
> **Source:** `PLAN-C7NTAX-Feature-Backlog-UI-Billing-Kumo-Integrations.md` (original remains in place)
> **Indexed:** 2026-08-18 | **Revised:** 2026-08-18 (strict dependency-order renumbering; re-copied from source)

# C7NTAX Feature Backlog — UI, Billing, Kumo, Integrations & Infrastructure (PLAN-015)

> **Sequence:** Wave 2 · position 4 of 12 (re-sequenced 2026-10-06) · **Status:** 🟢 Phase A complete (agreements, time engine, expenses, batch invoicing); Phase B remainder open
> **Implemented:** **Phase A #1** — `ServiceAgreement` carries the agreement type (`service`/`block`/`cyberCare`/`spot`), hourly rate, spot-rate tier, included and used block hours, and the overtime policy; `services/timeRules.ts` computes overtime weighting, the midnight split (`splitFrom`) and the 1.5:1 block deduction, applied by `POST /tickets/:id/time` behind `TIME_RULES_ENABLED` (default off). **Phase A #2** — expenses filed by whoever spent the money (`TicketEdit`), client taken from the ticket, categories/vendor/miles, an approval workflow (`submitted` → `approved`/`rejected`), a ticket-scoped list, and a push to accounting (`services/accountingSync.ts`). **Phase A #3** — `BillingBatch` + `Invoice.batchId` + `Company.billThroughDate`; `/billing/batches/preview|create|approve|reject` behind `INVOICE_BATCH_ENABLED` (default off); preview is read-only, drafts claim their time and expenses so nothing bills twice, approval issues and pushes, and the Billing → Invoices **Bill through…** dialog drives it. Plus bulk ticket operations, Kumo file manager, QuickBooks Online adapter, CloudConnect per-field fix/re-test, Service Alerts severity + RSS/Statuspage/DownDetector (+ website/SSL/DNS monitors), M365 user sync, and the checklists/rich-text-editor surfaces built from the same backlog.
> **Outstanding — recorded limitation:** the plan's "approve batch → email (existing path)" assumed an invoice email that does not exist in the application (the send endpoint flips the status only), so approval issues and syncs without claiming to have emailed anyone. A customer invoice email — the PDF renderer already exists — is a deliberate follow-up.
> **Outstanding — Phase B remainder:** SMS validation (provider decision), QR-screenshot MFA decode, M365 inactivity reports + auto-offboarding.
> **Done — Phase B:** #4 per-user dashboard (2026.10.7.008); #5 board tile arrangement + pin-to-top (2026.10.7.009); #6 Kumo audit trail (2026.10.7.007); #8 Outage Board + social (X) source behind env config (2026.10.7.010); #9 CloudConnect live statuses + inline fix (2026.10.7.011); #10 report writer fix + Client Value Report (2026.10.7.006); #11 AI KB auto-generation (2026.10.7.012).
> **Depends on:** Phase A is complete; Phase B items are independent; the AWS/Azure packaging items move with PLAN-016.
> **Next action:** Phase B remainder, in the plan's order: M365 inactivity reports + offboarding, then SMS (provider decision), then the MFA QR screenshot decode.

**Plan ID:** PLAN-015 | **Status:** 🟡 Phase A #1 shipped (agreements + time engine), #2/#3 open, Phase B landed piecemeal (see the sequence block below) | **Date:** 2026-08-18 | **Revised:** 2026-10-07
**References:** PLAN-001…014 (`PlanDocs/`), `PLAN-C7NTAX-Competitive-Review-and-Modernization.md` (PLAN-013), `PLAN-C7NTAX-Now-Deployable-Backlog.md`, C7NTRL-001 (`C7-IMI/C7NTRL`).

Legend: ✅ implemented · ⚠️ similar exists (upgrade) · 📋 planned in existing docs · ❌ new in this plan.

## 1. Status mapping (verified against the codebase)

| Requested feature | Status | Evidence / reference |
|---|---|---|
| Customizable dashboard per user profile | ✅ | `UserDashboardConfig` + `services/dashboardLayout.ts` (server-side widget catalogue, reconciled layouts) + `GET|PUT|DELETE /dashboard/layout`; `Dashboard.tsx` arranges by drag/arrows, S/M/L widths, show/hide, reset (2026.10.7.008). |
| Service board drag-and-drop layout, move preferred elements to top | ✅ | `BoardLayout` + `services/boardLayout.ts` (six-tile catalogue, pinned-first reconciliation); `GET /boards/:id/layout` (view) and `PUT|DELETE` (manage); tiles ride on `/boards/metrics`; `Boards.tsx` drag/arrows, pin-to-front, save/reset (2026.10.7.009). |
| Ticket-list checkboxes + batch ops (ack/close multiple) | ✅ | `apps/web/src/pages/Tickets.tsx` has batch selection + checked actions; `apps/api/src/routes/bulk.ts` + `BulkOperation` model exist. |
| SMS validation button in ticket view | ❌ | No SMS routes/provider anywhere. |
| Overtime after 6:00 PM at time-and-a-half | ❌ | `timeEntry` create/update (`apps/api/src/routes/tickets/index.ts:237`) has no overtime/midnight logic. |
| Block-hour agreements deduct 1.5 h per 1 h overtime | ❌ | `Contract` model has only `type`, `value`, dates (`apps/api/src/routes/contracts.ts:30`). |
| Auto-split time entries crossing midnight | ❌ | Same evidence as overtime. |
| Tabbed expense entry (parking, hardware) with approval + QB/FlexPoint sync | ⚠️ | Procurement module exists (vendors/orders only, `apps/api/src/routes/procurement.ts`); expense items/approval/sync missing. |
| Agreement types: block hours / all-you-can-eat (Cyber Care) / variable hourly spot ($100/$250/$275/$400) | ❌ | Contract `type` is free-form; no rate structure or enforcement. |
| Bill-through date + batch-generate invoices for recurring + spot hours | ⚠️ | Single-invoice `POST /billing/invoices/generate` exists (`billing.ts:65`); no bill-through date, batch, or preview/approve queue. |
| Invoice preview/approve batch before email + QB/FlexPoint sync | ❌ | No preview/approve stage; generate → immediate. |
| Fix custom report writer + client value report template | ⚠️ | `apps/api/src/routes/reports.ts` custom report create with `config` JSON exists; writer is broken/limited (per request) and no value-report template. |
| Kumo password/doc audit log (last modified + user) | ✅ | `KumoAuditLog` + `services/kumoAudit.ts`; writes on password create/update/deactivate/**reveal** and document create/update; `GET /kumo/audit/:itemType/:itemId`; trail panel in the credential and document viewers (2026.10.7.007). Assets/configs/links accept entries but are not written to yet. |
| MFA setup: upload screenshot/JPEG of QR → extract base32 secret | ❌ | `auth.ts` generates QR (qrcode) + verifies base32; no image decode path. |
| File manager for documents/PDFs | ✅ | `kumo.ts` `/files` + `/files/upload` + `KumoFile` model exist (upload/list/storage). |
| Dynamic "Outage Board" tab (Down Detector, Twitter, real-time) | ✅ | Outage Board tab on the Service Alerts page (one row per service: status, last incident, per-source verdicts, unreadable count; problems first) + a social (X) source in `alertMonitor.ts` behind `X_BEARER_TOKEN` (absent when unconfigured, capped at informational, `social` verdicts on the existing endpoints) — 2026.10.7.010. |
| API connection testing: live statuses + inline fix/re-test without navigating away | ✅ | `GET /cloudconnect/status` (server-side throttled verification, `CLOUDCONNECT_VERIFY_INTERVAL_SEC`) + `services/integrationHealth.ts`; per-connection chip (Verified / Not answering / Incomplete / Off, with age and a **Fix** link into the credential dialog); missing credentials never called; the dialog now lists every configured field when the server names none (2026.10.7.011). |
| QuickBooks Online via Realm ID + access tokens | ✅ | `cloudconnect.ts:79` required fields: `["clientId","clientSecret","realmId","accessToken"]`; adapter + test connection exist. |
| AI inference auto-generates Kumo KB articles from resolved tickets | ✅ | `KnowledgeBaseArticle.aiGenerated` + `sourceTicketId` + `reviewNote`; `services/kbAutogen.ts` (capped prompt from description/notes/work, draft only, one per ticket); background draft on resolve/close, `POST /kb/autogen/:ticketId`, `GET /kb/drafts`, draft-only `DELETE /kb/:id`; KB page review queue + AI banner with Publish/Discard (2026.10.7.012). Remaining: duplicate detection against existing articles. |
| M365 sync: 30/60/90-day inactive-user reports + auto offboarding checklists | ⚠️ | M365 adapter syncs users (`m365User` mapping); no inactivity reports or offboarding trigger. `workflows.ts` exists (checklists can reuse it). |
| Track remote sessions → auto ticket notes of technician actions | 📋 | C7NTRL-001 phase 7 (remote tools) owns session data; PSA-side note automation listed in PLAN-014 §3. New only on the PSA contract side. |
| Pre-architected client portal (Project ID: FI0042) after core auth/MFA | 📋 | Planned as Customer Portal in PLAN-013 §4 #3; deferred in Now-Deployable Backlog (gated on PLAN-003 tenant scoping). "FI0042" string is not present in the current repo docs — noted as external project ID to re-key. |
| Serverless AWS packaging | 📋 | Append to PLAN-010 (AWS Dev/Prod Split & Sync). |
| OpenTofu CI/CD pipeline | 📋 | Append to PLAN-010. |
| Dev environment identical to production | 📋 | Append to PLAN-010 (dev/prod split is its core). |

## 2. Implementation plan (strict dependency order — prerequisites first)

Ordering rule applied in this revision: every item whose prerequisites are already satisfied (existing code) or unresolved-external is grouped strictly — Phase A is the billing chain (#1 → #2 → #3), Phase B contains all items with no unresolved prerequisites (parallel-safe), Phase C contains items gated on external plans. Within each group, original relative order is preserved.

**Phase A — agreements & billing chain (sequential)**

| # | Item | Depends on | Risk if skipped |
|---|---|---|---|
| 1 | **Agreements & time engine (foundation):** extend `Contract` with agreement type (`block` / `cyberCare` / `spot`), rate tables (`{100,250,275,400}`/hr spot), block-hour balance; overtime rule (entries ending after 18:00 local → ×1.5); midnight split (split `timeEntry` at 00:00 into two entries, original IDs preserved in `splitFrom`); block-hour deduction 1.5:1 on overtime applied to block balances. All behind `TIME_RULES_ENABLED` (default off) until QAd. | — (foundation) | Phases 2 and 3 have nothing to compute against; billing remains manual and wrong for block / Cyber Care / spot agreement types; overtime, midnight splits, and block-hour deductions all stay manual. |
| 2 | **Expense module:** `Expense` model (type: parking/hardware/mileage/other, vendor, amount, receipt), tabbed interface on the ticket time/expense area, approval status flow, sync push to QuickBooks/FlexPoint via existing CloudConnect adapters (reuse `/cloudconnect/:id/test` auth). | #1 (billing linkage), CloudConnect adapters (exist) | Technician out-of-pocket costs untracked; no path to bill or reimburse; #3 batch invoices would miss expense line items. |
| 3 | **Bill-through batch invoicing + preview/approve:** add `billThroughDate` + batch generator over recurring agreements and spot hours (reuse `POST /billing/invoices/generate` internals); generate to **Draft** status; preview dialog listing invoices per client; approve batch → email (existing path) + QB/FlexPoint sync. `INVOICE_BATCH_ENABLED` flag. | #1, #2 | Batch billing stays manual; preview/approve requirement unmet; risk of wrong invoices emailed and synced without review. |

**Phase B — independent upgrades (no unresolved prerequisites; may run in parallel)**

| # | Item | Depends on | Risk if skipped |
|---|---|---|---|
| 4 | **Per-user customizable dashboard — DONE 2026.10.7.008:** `UserDashboardConfig` (userId unique, widgets JSON) + server-side widget catalogue (`services/dashboardLayout.ts`) with permission-filtered widgets and reconciled layouts; `GET|PUT|DELETE /dashboard/layout`; dashboard renders drag-to-reorder, S/M/L width, show/hide, save, reset. Remaining: a true "pin to top" field if it is ever wanted beyond ordering. | — (parallel) | ✅ Closed — dashboards are per-profile, and a new widget reaches existing layouts automatically. |
| 5 | **Service board drag-and-drop — DONE 2026.10.7.009:** `BoardLayout` (boardId unique, tiles JSON, updatedById) + `services/boardLayout.ts`; `GET /boards/:id/layout` (board:view) / `PUT|DELETE` (board:manage); `/boards/metrics` carries each board's arrangement in one query; tiles drag or arrow-move and **pin to the front**. Shared per board by design — per-user board tiles would be a second table keyed by user *and* board. | — (parallel); batch ops already exist ✅ | ✅ Closed — a board leads with the tile its desk cares about, and the arrangement survives the session. |
| 6 | **Kumo audit log — DONE 2026.10.7.007:** `KumoAuditLog` (itemType, itemId, action, userId, summary, details, at) with indexes; writes on password create/update/deactivate/**reveal** and document create/update; `GET /kumo/audit/:itemType/:itemId` (Kumo view permission, 404 for unknown item or type, limit clamped); the field names are recorded but **never the values**; audit-log expander in the credential detail panel and the document viewer. Remaining: asset/config/link entries, and a retention policy. | Kumo models (exist; file manager already implemented ✅) | ✅ Closed — "Last changed by" no longer has to stand in for accountability on shared credentials and documents. |
| 7 | **MFA QR screenshot upload:** accept JPEG/PNG on `MFASetup.tsx`; server-side QR-decode (e.g. `jsqr` + image decode) → extract `otpauth://` URI → base32 secret → complete existing setup flow. | Existing MFA flow (`auth.ts` speakeasy) | Users with QR-only provisioning (screenshot workflows) can't enroll MFA; enrollment blocked in screenshot-only environments. |
| 8 | **Outage Board tab — DONE 2026.10.7.010:** the Service Alerts page gained a board of one row per service (status, last incident active *or* resolved with a source link, per-source verdict chips, and an unreadable count) plus a **social (X) source** in `alertMonitor.ts` behind `X_BEARER_TOKEN` / `X_API_BASE_URL` / `SERVICE_ALERTS_SOCIAL_ENABLED` — absent when unconfigured, capped at **informational** severity, and every credential failure reported as unknown with its reason. Remaining: a per-service X query column (the query is derived from the service name today, which a very common name can muddy). | serviceAlerts (exist; per-service RSS/DownDetector already implemented) | ✅ Closed — the MSP-wide picture is one screen, and a social source can inform it without being able to raise an outage on its own. |
| 9 | **CloudConnect live statuses + inline fix — DONE 2026.10.7.011:** `GET /cloudconnect/status` verifies due connections server-side on `CLOUDCONNECT_VERIFY_INTERVAL_SEC` (default 300) via `services/integrationHealth.ts`; per-connection chip in `CloudConnect.tsx` (Verified / Not answering / Incomplete / Off + age + **Fix** into the credential dialog); a connection missing credentials is never called; the answer is written back to the row so badge and chip agree. Remaining: move the in-process health memory into the database before running multiple replicas. | CloudConnect UI (exists; fix + retest dialog already present) | ✅ Closed — a broken connection is discovered by the platform, not by a customer. |
| 10 | **Report writer fix + client value report:** repair the custom report writer (config JSON → runnable query spec + rendering); ship a "Client Value Report" template (ticket counts, active user lists, resolved-vs-open, response SLA) per client. | `reports.ts` (exists; custom config-JSON reports already present) | Client value reporting stays manual; broken writer remains unusable; value-report template unmet. |
| 11 | **AI KB auto-generation — DONE 2026.10.7.012:** `KnowledgeBaseArticle.aiGenerated` / `sourceTicketId` / `reviewNote`; `services/kbAutogen.ts` drafts from the ticket (description, notes, logged work, capped on a word boundary) as a **draft only**, one per ticket, refusing tickets with too little recorded and answers that are not JSON; resolve/close drafts in the background without blocking the status change; `POST /kb/autogen/:ticketId`, `GET /kb/drafts`, draft-only `DELETE /kb/:id`; KB page review queue and an AI banner with Publish/Discard/Source ticket. Remaining: duplicate detection against existing articles. | inference (exists), KB (exists) | ✅ Closed — solved work reaches the knowledge base as a reviewable draft instead of leaving with the technician. |
| 12 | **M365 inactive-user reports + offboarding:** query synced M365 users for last-login (30/60/90-day buckets) → report per client; trigger offboarding checklist via `workflows.ts`; `M365_OFFBOARD_ENABLED` flag. | M365 adapter (exists), workflows (exists) | Orphaned licenses/accounts persist; offboarding manual and inconsistent; 30/60/90-day report requirement unmet. |
| 13 | **SMS verification button:** env-configured SMS provider (open decision) → `POST /api/tickets/:id/sms-verify` sends code to contact's phone; verify code → ticket activity note. | Ticket detail UI (exists); SMS provider decision (open) | No out-of-band verification for Service Desk callers; verification requirement unmet. |

**Phase C — externally gated (order preserved; each blocked on a dependency outside this plan)**

| # | Item | Depends on | Risk if skipped |
|---|---|---|---|
| 14 | **Remote-session ticket notes (PSA side):** contract addition (PLAN-014 §3): C7NTRL posts session summaries → `POST /api/rmm/session-notes` → append ticket note (technician actions). RMM side is C7NTRL-001 phase 7. | C7NTRL phase 7 | Session history invisible in PSA tickets; technician actions undocumented until C7NTRL ships remote tools. |
| 15 | **Client portal (FI0042):** implement per PLAN-013 §4 #3 after PLAN-003 tenant scoping Step 2 and PLAN-002 passkey land; re-key the external "FI0042" project ID into this plan. | PLAN-003 Step 2, PLAN-002, PLAN-001 (done) | Portal could leak cross-company data without tenant scoping; auth/MFA requirement unmet if shipped early. |
| 16 | **Infrastructure (serverless + OpenTofu + dev=prod):** appended to **PLAN-010** — serverless packaging (Lambda/API Gateway or container service), OpenTofu modules for CI/CD, identical dev/prod environments. Not implemented in this plan. | PLAN-010 approval | Shipping without parity environments risks prod-only failures; CI/CD stays manual; serverless requirement unmet. |

**Renumbering notes (this revision):**
- **SMS verification** moved from #14 to #13: it has no unresolved prerequisites (ticket UI exists), while remote-session notes are gated on C7NTRL phase 7 (external), so the ungated item precedes the gated one.
- All other items keep their original relative order; Phase A/B/C grouping is added to make the dependency chain explicit.
- No items added or removed; names, paths, and concrete details preserved.

## 3. Moved / split / appended notes (explicit)

- **Remote-session notes** → **appended to PLAN-014 / C7NTRL-001 phase 7** (RMM owns session data); only the PSA contract endpoint + note writer are implemented here (#14).
- **Client portal (FI0042)** → **appended to PLAN-013 §4 #3**; scheduled here as #15 with hard dependencies on PLAN-003 Step 2 and PLAN-002.
- **Serverless AWS packaging, OpenTofu CI/CD, dev=prod environment** → **appended to PLAN-010** (AWS Dev/Prod Split & Sync); not duplicated here.
- **Batch ticket operations, QuickBooks Online (Realm ID), Kumo file manager** → **already implemented** (✅ table above); no work items created. File manager gets only audit coverage via #6.
- **API connection testing** → partial implementation exists (fix + retest dialog); #9 upgrades it to live statuses rather than rebuilding.

## 4. Frontend items (all affected surfaces)

- New: **Dashboard** widget palette + per-user layout editor (drag, pin, resize); **Boards** drag-and-drop handles + "pin to top" affordance; **Expenses** tab on ticket detail (parking/hardware forms, approval list); **Billing** → "Bill-through date" field, "Batch generate" button, invoice **preview/approve dialog** (per-client list, approve/reject); **Reports** → Client Value Report template + repaired writer UI; **Kumo** item detail audit-log panel; **MFASetup** QR upload dropzone; **Service Alerts** → new **Outage Board** tab; **CloudConnect** live status chips + inline credential fix; **Tickets** → SMS verify button (activity note on send/verify); **KB** → AI-generated draft banner (approve/discard).
- Modified: `Tickets.tsx` (batch bar already exists — extend only for SMS), `Billing.tsx`, `Kumo*.tsx`, `Settings.tsx` (TIME_RULES/INVOICE_BATCH/KB_AUTOGEN/M365_OFFBOARD flags).

## 5. Rollback plan

- All items additive or flag-gated (`TIME_RULES_ENABLED`, `INVOICE_BATCH_ENABLED`, `KB_AUTOGEN_ENABLED`, `M365_OFFBOARD_ENABLED`, `SMS_ENABLED`). Disable flag → prior behavior; drop new tables for full revert.
- #1 time rules compute only on new/edited entries when enabled; existing entries untouched.
- #3 invoices generate to Draft — nothing emails/syncs until approved, so a broken batch is recoverable without client impact.

## 6. Verification plan

- Boot pipeline + typecheck baselines (api 176 / web 17) stay green; `verify-post-change` after each item.
- E2E: block-hour deduction math on a 2h post-18:00 entry (1.5:1 → 3h); midnight entry splits into two with `splitFrom` linked; batch invoice → draft → preview → approve → email/sync; QR screenshot enrolls MFA; outage board reflects seeded service; M365 90-day report lists expected users; AI KB draft requires approval before publish.
- Unit tests for rate/agreement math and split logic.

## 7. Open decisions

1. SMS provider (Twilio vs other) and cost approval.
2. Spot-rate values confirmation: $100/$250/$275/$400 per hour tiers.
3. Twitter/X data source policy for the Outage Board (API key vs RSS alternatives).
4. "FI0042" project ID origin — confirm the pre-architected portal spec to re-key it here.
5. Overtime rule precision: after 18:00 local per technician timezone vs company timezone.
6. QB/FlexPoint expense sync direction (invoice line vs separate bill) — confirm with accounting.
7. Serverless target for PLAN-010: Lambda vs container service — decided in PLAN-010, not here.
