> **Plan ID:** PLAN-012
> **Title:** Outlook Add-in Email-to-Ticket Generator Plan
> **Source:** `PLAN-Outlook-Addin-Email-to-Ticket.md` (original remains in place)
> **Indexed:** 2026-08-18

# Outlook Add-in: Email-to-Ticket Generator — Implementation Plan

**Plan Label:** Outlook Add-in Email-to-Ticket Generator Plan
**Status:** Proposed (plan only — no implementation yet)
**Date:** 2026-08-18

---

## 1. Goal

Build an Outlook plugin/extension that creates a C7NTAX service ticket from an
email with one click — mirroring the monitored-mailbox feature (PLAN-009) for
interactive, technician-driven ticket creation inside Outlook.

Selection behavior (explicit requirement):
- **Multiple emails selected** on the main Outlook screen → create **one
  service ticket per selected email**.
- **Single message open/previewed/active** → create a ticket for that message.

## 2. Recommended add-in type: Office Web Add-in (Mail Read command surface)

- **Type:** an **Office (Outlook) web add-in** using the **MessageReadCommandSurface**
  extension point with an `ExecuteFunction` ribbon button + taskpane for
  board/priority choices and results.
- **Why appropriate:**
  - Cross-platform: Windows desktop, Mac desktop, Outlook on the web, and
    Outlook mobile from one JavaScript codebase (vs COM/VSTO which is
    Windows-desktop-only and deprecated for new work).
  - Matches the C7NTAX stack (TypeScript/React) — no new toolchain; the
    existing design system and API client patterns carry over.
  - Centralized deployment and updates via the Microsoft 365 admin center
    (Integrated Apps / AppSource) — no per-machine installers.
  - **Multi-select support is native to this surface:** `Office.context.mailbox.getSelectedItemsAsync()`
    returns all selected messages when invoked from the reading pane (the
    manifest's MessageReadCommandSurface supports multi-select actions),
    which is exactly the required selection behavior.
  - Sandboxed security model (no direct OS/registry access) and Microsoft
    review process reduce client risk.

## 3. C7NTAX API / integration flow (mirrors PLAN-009 monitored mailbox)

```
Outlook add-in button (ribbon)
  ├─ getSelectedItemsAsync() → item[]          (multi-select on main screen)
  │     └─ fallback: Office.context.mailbox.item (single open/previewed message)
  ├─ taskpane opens: board selector (/api/boards) + "Create ticket(s)" 
  ├─ for each item: Office.js item.loadCustomPropertiesAsync? → fetch
  │    subject, body (getAsync coerced to text), from, to, cc,
  │    internetMessageId (via callback token / EWS GetItem if needed)
  └─ POST /api/outlook-addin/tickets   (batch: { boardId, messages: [...] })
        → reuses services/emailToTicket.ts createTicketFromEmail()
        → response: [{ emailKey, ticketId, ticketNumber }]
        → UI shows success links (ticket URL) per email
```

- **New endpoint** `POST /api/outlook-addin/tickets` (authenticated,
  `Permission.TicketCreate`): validates boardId, calls
  `createTicketFromEmail(boardId, parsedEmail)` per message (same deduction
  pipeline as the monitored mailbox — subject/name/contact/company/
  description/priority), dedupes by `internetMessageId` via the same
  SystemConfig cursor pattern (`outlook_addin:seen`), returns per-message
  results. The `EmailConnector` runtime is NOT involved (no polling).
- **Reuse:** `services/emailToTicket.ts`, `services/ticketNumber.ts`,
  `packages/email/src/fieldDeduction.ts` — the add-in only converts Office.js
  message objects into the existing `ParsedEmail` shape.

## 4. Email → ticket field mapping

| Ticket field | Source in Outlook item | Notes |
|---|---|---|
| Title | `subject` → `stripSubjectPrefixes()` | strips Re:/FW:/[C7-…] tags; fallback "Email from <sender>" |
| Description | `body` (text) → `stripQuotedReply()` | cap 20k chars, same as connector |
| Contact | `from.emailAddress` → lookup by email (case-insensitive) | creates contact if missing (existing behavior) |
| Company | contact's company → sender-domain match → default company | existing `resolveSender()` chain |
| Name | `from.displayName` → `deduceName()` | fallback email local part |
| Priority | `subject` + `body` keywords → `deducePriority()` | |
| Source | `"email"` | matches connector tickets |
| Status | `new` | |
| Board | chosen in the taskpane | default = first board or last-used (RoamingSettings) |
| Dedup key | `internetMessageId` (preferred) else hash of subject+from+received time | prevents double-ticket on repeat clicks |
| Audit metadata | `customFields.email = { messageId, from, to, cc, date }` | same as connector |

## 5. Authentication approach

- **Primary: Office SSO (recommended)** — `OfficeRuntime.auth.getAccessToken({ allowSignInPrompt: true, forMSGraphAccess: false })`
  using an Azure AD app registration scoped to the C7NTAX API
  (custom `access_as_user` scope). The C7NTAX API adds
  `POST /api/auth/office-sso` which validates the Microsoft identity token
  (issuer/audience/tenant), matches the user by email, and returns a standard
  12h C7NTAX JWT.
- **Fallback: manual login** in the taskpane (existing `/api/auth/login`),
  token stored via `Office.context.roamingSettings` (roams across devices,
  encrypted in transit; clear on logout).
- Token refresh on 401 → silent re-auth or re-login prompt; no secrets stored
  in the manifest or bundle.

## 6. Button/icon implementation (C7 icon from the Composite asset sheet)

- Add-in command button "Create Ticket" on the **Message Read ribbon surface**;
  optional item-context-menu entry (single-message path).
- **Icon:** derive the C7 icon from the **Composite asset sheet** (the project
  asset source of truth) at the required Office sizes: **16×16, 32×32, 80×80**
  PNG (plus SVG master). Envelope+ticket glyph on the C7 cyber-blue, per the
  project design tokens (`DESIGN.md`), with `prefers-reduced-motion`/contrast
  pass. Manifest `<Icon>` entries for both the ribbon button and the taskpane
  app icon; high-DPI 80px required for the ribbon.
- Tooltip + screentip: "Create service ticket from this email"; disabled state
  with explanation when the API is unreachable.

## 7. Implementation phases (dependency-ordered — prerequisites first)

| # | Item | Depends on | Risk if prerequisite is skipped |
|---|---|---|---|
| 1 | **Backend endpoint:** `POST /api/outlook-addin/tickets` (batch create via `createTicketFromEmail`, dedup by internetMessageId, board validation) + `POST /api/auth/office-sso` (validate MS identity token, exchange for C7NTAX JWT) | PLAN-009 phases 1–4 (already implemented: deduction + ticket creation + board routes) | The add-in has no API to call — button would fail at runtime; SSO exchange without backend validation would let anyone mint C7NTAX tokens. |
| 2 | **Add-in scaffold & manifest:** Office add-in project (yo office / Teams toolkit) with `MessageReadCommandSurface` + ExecuteFunction action + taskpane; `SupportsMultiSelect` verified against Microsoft docs; sideload.xml | #1 (endpoint URLs for taskpane + validation) | No button appears in Outlook; multi-select behavior untestable without the surface. |
| 3 | **Selection logic:** `getSelectedItemsAsync()` handling — array of N items → N tickets; single/active item fallback; per-item internetMessageId capture (callback token → REST/EWS `GetItem` when Office.js doesn't expose it) | #2 | Wrong selection handling breaks the core requirement (multiple selected emails must each produce a ticket). |
| 4 | **Taskpane UI:** board selector (from `/api/boards`), last-used board via RoamingSettings, create button, per-email progress/results with ticket links, error states | #2, #3 | No board choice → tickets land on the wrong board; no feedback when creation fails. |
| 5 | **Auth wiring:** SSO flow + fallback manual login + roamingSettings token storage + 401 refresh | #1 | Without auth the taskpane can't call protected endpoints; SSO failure path must degrade to manual login. |
| 6 | **Icon & polish:** C7 icon set from the Composite asset sheet at 16/32/80 px, manifest icons, tooltips, disabled states | #2 (manifest exists) | Icons are required by the manifest schema — a missing 80px icon blocks sideloading/deployment. |
| 7 | **Testing & deployment:** unit tests (mapping + selection), E2E in Outlook desktop + web (single, multi-select, dedup repeat-click), sideload validation, Microsoft 365 admin center Integrated Apps / AppSource submission, versioning + rollback runbook | #1–#6 | Untested multi-select ships to technicians; no rollback path for a bad release. |

## 8. Testing plan

- **Unit:** Office.js message → `ParsedEmail` mapping; `stripSubjectPrefixes`
  edge cases; batch API request/response shapes.
- **E2E (Outlook desktop + web):** (a) single open message → one ticket;
  (b) multi-select 3 emails → 3 tickets with correct per-email titles/contacts;
  (c) repeat click on same message → no duplicate (dedup); (d) reply chains →
  title stripped, no `[C7-…]` tag leakage; (e) SSO and manual login paths;
  (f) API-down → clear error, no partial ticket.
- **Regression:** existing connector/ticket/KB flows untouched; boot pipeline
  and typecheck baselines unchanged.

## 9. Rollback plan

- **Instant stop:** remove the add-in from users via the admin center
  (Integrated Apps) — button disappears; the backend endpoint stays harmless
  (authenticated, additive).
- **Endpoint rollback:** revert the two route additions — no other code path
  depends on them.
- **Data:** tickets created by the add-in are normal tickets (deletable via
  existing flows); no schema changes.

## 10. Open decisions to confirm before implementation

1. SSO scope: accept only specific tenant(s) or any Microsoft account
   (matches C7NTAX user email).
2. `internetMessageId` retrieval path (Office.js callback token → EWS) vs
   subject+from hash dedup.
3. Default board source: last-used (RoamingSettings) vs connector-agnostic
   first board.
4. Distribution: sideload-only for staff vs Microsoft AppSource submission.
5. Icon variants (light/dark ribbon themes) from the Composite asset sheet.
