> **Plan ID:** PLAN-015
> **Title:** C7NTAX Feature Backlog — UI, Billing, Kumo, Integrations & Infrastructure
> **Source:** `PLAN-C7NTAX-Feature-Backlog-UI-Billing-Kumo-Integrations.md` (original remains in place)
> **Indexed:** 2026-08-18 | **Revised:** 2026-08-18 (strict dependency-order renumbering; re-copied from source)

# C7NTAX Feature Backlog — UI, Billing, Kumo, Integrations & Infrastructure (PLAN-015)

**Plan ID:** PLAN-015 | **Status:** Proposed (plan only — no implementation yet) | **Date:** 2026-08-18 | **Revised:** 2026-08-18 (strict dependency-order renumbering)
**References:** PLAN-001…014 (`PlanDocs/`), `PLAN-C7NTAX-Competitive-Review-and-Modernization.md` (PLAN-013), `PLAN-C7NTAX-Now-Deployable-Backlog.md`, C7NTRL-001 (`C7-IMI/C7NTRL`).

Legend: ✅ implemented · ⚠️ similar exists (upgrade) · 📋 planned in existing docs · ❌ new in this plan.

## 1. Status mapping (verified against the codebase)

| Requested feature | Status | Evidence / reference |
|---|---|---|
| Customizable dashboard per user profile | ❌ | `apps/web/src/pages/Dashboard.tsx` is static (no widget/layout/config); FinanceDashboard read-only. |
| Service board drag-and-drop layout, move preferred elements to top | ❌ | `apps/api/src/routes/boards.ts` has only fixed `orderBy`; no layout model. |
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
| Kumo password/doc audit log (last modified + user) | ⚠️ | Kumo items have timestamps; no modifiedBy/audit trail in `kumo.ts`. |
| MFA setup: upload screenshot/JPEG of QR → extract base32 secret | ❌ | `auth.ts` generates QR (qrcode) + verifies base32; no image decode path. |
| File manager for documents/PDFs | ✅ | `kumo.ts` `/files` + `/files/upload` + `KumoFile` model exist (upload/list/storage). |
| Dynamic "Outage Board" tab (Down Detector, Twitter, real-time) | ⚠️ | `serviceAlerts.ts` per-service RSS/DownDetector + severity exists; no aggregated board or Twitter source. |
| API connection testing: live statuses + inline fix/re-test without navigating away | ⚠️ | `CloudConnect.tsx` already has per-field fix + retest dialog (`fixTestResults`); add live/polled statuses + inline password fix. |
| QuickBooks Online via Realm ID + access tokens | ✅ | `cloudconnect.ts:79` required fields: `["clientId","clientSecret","realmId","accessToken"]`; adapter + test connection exist. |
| AI inference auto-generates Kumo KB articles from resolved tickets | ❌ | `inference.ts` has no KB generation; KB is manual. |
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
| 4 | **Per-user customizable dashboard:** `UserDashboardConfig` model (widget order, visibility, size per user); widget palette reusing existing KPI cards (Finance, tickets, alerts, PTO); drag-to-reorder + save per profile. | — (parallel) | Dashboards stay one-size-fits-all; individual user workflows unsupported; no per-profile widget ordering. |
| 5 | **Service board drag-and-drop:** `BoardLayout` model (boardId → section/tile order + pinned-to-top); dnd UI on `Boards.tsx`; respect saved order in `boards.ts` reads. | — (parallel); batch ops already exist ✅ | Boards remain fixed-layout; users cannot prioritize their preferred tiles; layout preferences lost across sessions. |
| 6 | **Kumo audit log:** `KumoAuditLog` table (itemType, itemId, userId, action, at) + `modifiedById` on KumoPassword/KumoDocument; write on create/update/delete; audit-log panel in item detail showing last modified date + user. | Kumo models (exist; file manager already implemented ✅) | No accountability on shared credential/doc changes; SOC 2 gap (PLAN-007); Kumo audit requirement unmet. |
| 7 | **MFA QR screenshot upload:** accept JPEG/PNG on `MFASetup.tsx`; server-side QR-decode (e.g. `jsqr` + image decode) → extract `otpauth://` URI → base32 secret → complete existing setup flow. | Existing MFA flow (`auth.ts` speakeasy) | Users with QR-only provisioning (screenshot workflows) can't enroll MFA; enrollment blocked in screenshot-only environments. |
| 8 | **Outage Board tab:** aggregated view across `ServiceAlertService` rows (status, severity, last incident) + web sources: existing DownDetector URLs per service and a Twitter/X source behind env config; auto-refresh via existing visibility-gated polling hook. | serviceAlerts (exist; per-service RSS/DownDetector already implemented) | Outage visibility stays per-service; MSP-wide status unclear; Twitter-source requirement unmet. |
| 9 | **CloudConnect live statuses + inline fix:** polled/SSE live connection status chip per integration (reuse existing test endpoint, throttled); inline password/secret fix + re-test in place (UI partially exists — upgrade). | CloudConnect UI (exists; fix + retest dialog already present) | Broken integrations discovered only on manual test; techs navigate away to fix credentials; live-status requirement unmet. |
| 10 | **Report writer fix + client value report:** repair the custom report writer (config JSON → runnable query spec + rendering); ship a "Client Value Report" template (ticket counts, active user lists, resolved-vs-open, response SLA) per client. | `reports.ts` (exists; custom config-JSON reports already present) | Client value reporting stays manual; broken writer remains unusable; value-report template unmet. |
| 11 | **AI KB auto-generation:** on ticket resolution (or batch), inference drafts a Kumo KB article from ticket content (reuse cheap-model config + 6000-char excerpt from PLAN-008); draft → human approve before publish; `KB_AUTOGEN_ENABLED` flag. | inference (exists), KB (exists) | Knowledge stays tribal; resolved-ticket learnings lost; KB growth depends entirely on manual writing. |
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
