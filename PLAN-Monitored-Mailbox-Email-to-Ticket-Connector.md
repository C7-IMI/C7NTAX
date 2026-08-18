# Monitored Mailbox Email-to-Ticket Connector Plan

**Plan Label:** Monitored Mailbox Email-to-Ticket Connector Plan
**Status:** Proposed (no implementation yet)
**Date:** 2026-08-18
**Scope:** Plan only - no code changes in this document's turn.

---

## 1. Goal

Add an email connector that monitors a specific mailbox (IMAP) and automatically
creates a new service ticket when an email arrives. The connector deduces ticket
fields from the email — **name, company, contact, subject, description** — and
auto-populates the new ticket. Replies to existing tickets (subject tag /
in-reply-to threading) append a ticket note instead of creating a duplicate.

The connector configuration supports **Microsoft 365 Exchange mailboxes** in
addition to plain IMAP: both **legacy authentication** (Basic Auth over IMAP/EWS,
with deprecation warnings) and **modern authentication** (OAuth 2.0 + Microsoft
Graph), including shared/delegate mailboxes. See §3.8.

Reference behavior is drawn from PSA documentation: **AutoTask** (Incoming
Email Processing / Email Connector: per-mailbox board mapping, Message-ID
dedup, "process first, mark read/delete only after success"), **ConnectWise
Manage** (Email Connector setup tables: mailbox → board/status/priority
defaults, tag-based threading like `[T#1234]`, POP/IMAP/Exchange support), and
**ConnectWise Asio** (inbox triage: contact/company matching by sender email,
structured field mapping). Our implementation adapts these concepts to the
existing C7NTAX theme and codebase.

## 2. Current state (verified)

| Area | What exists today |
|---|---|
| `packages/email/src/EmailConnector.ts` | `EmailConnectorManager` class: `addConnector/startConnector/stopConnector` (setInterval polling), `onNewTicket`/`onUpdateTicket` callbacks, `processEmail` (match → create/update), `matchEmailToTicket` (subject ticket-number tags, in-reply-to, references), `extractPriority` (keyword list), `EmailConnectorConfig { id, boardId, host, port, secure, user, password, folder?, pollIntervalSeconds, enabled }`, `ParsedEmail`, `TicketMatchResult`. |
| Gap | `pollMailbox()` is a **stub** (commented-out IMAP code + console.log). The manager is **not wired into `apps/api` at all** (zero references). |
| Ticket creation | `POST /api/tickets` in `apps/api/src/routes/tickets/index.ts:78` - requires `title` + `boardId`; `companyId` falls back to the session user's company; ticket number = `ClientType-ClientID-Seq` (e.g. `MSP-1001-1003`); priority auto-extracted from title/description; `source` defaults to `"portal"`; `createdById` = session user. |
| Ticket model | `title` required; `description?`; `status` default `"new"`; `priority` default `"medium"`; `source` default `"portal"`; `boardId` required; **`companyId` required**; `contactId?`; `createdById` required; `ticketNumber` unique; `customFields Json`; `attachments`/`comments` relations. |
| Contact model | `firstName/lastName/email` required, `companyId` required, `isPrimary`, `isActive`. **`email` is not unique in the schema** - lookup-first needed (or a later unique index). |
| Company model | `name` required; `clientId`/`clientType` drive ticket numbering. |
| Config storage | `Integration` model: `kind, name, enabled, credentials Json, settings Json, status, errorMessage, lastSyncAt`. `SystemConfig`: `key/value Json`. |
| Integration framework | `packages/integrations` `IntegrationHub` + adapters (Microsoft365, Pax8, ITGlue, Proofpoint, Avanan, SentinelOne, QuickBooks, Flexpoint); `apps/api/src/routes/cloudconnect.ts` exposes CRUD/test endpoints. |
| Background jobs | Precedent in `apps/api/src/services/poller.ts` (SelfHeal) and `snapshotPoller.ts` - single instance, error-contained, no crash on failure. |
| UI | `apps/web/src/pages/CloudConnect.tsx` (`/cloudconnect`, listed under Admin nav as "CloudConnect"): integration list, add form, credential form, test-connection with field errors, sync logs, action panel. `App.tsx` routes; `Layout.tsx` nav items. |
| Crypto | Credentials are documented as encrypted (`Integration.credentials Json // encrypted creds`); SOC2 notes flag a "hardcoded crypto fallback key" - reuse the existing credential encryption helper if present, otherwise encrypt with the same mechanism used by CloudConnect adapters (do not introduce a new key). |

## 3. Design (PSA-informed)

### 3.1 Connector model

Reuse the **`Integration` table** with `kind = "email_connector"` (no schema
migration required):

- `credentials` (encrypted, existing mechanism), by `authType`:
  - `basic`: `host`, `port`, `secure`, `user`, `password` (IMAP/EWS legacy).
  - `oauth2`: `clientId`, `clientSecret`, `tenantId`, `refreshToken`,
    `accessToken` (rotated), `mailboxAddress` (M365 only).
- `settings` (plain): `boardId`, `connectionType` (`imap` | `ews` |
  `microsoftGraph`), `authType` (`basic` | `oauth2`), `mailboxAddress`
  (required for shared/delegate mailboxes; defaults to the authenticated
  user's mailbox), `folder` (default `INBOX`; Graph well-known folder name
  when `connectionType=microsoftGraph`), `pollIntervalSeconds` (min 30),
  `defaultCompanyId` (fallback when no match), `autoCreateContact` (bool),
  `autoCreateCompany` (bool), `markSeenOnSuccess` (bool, default true),
  `ignoreAutoReplies` (bool, default true), `priorityKeywords` (array, merge
  with built-ins), `maxAttachmentBytes`.
- `status` / `errorMessage` / `lastSyncAt` already exist and are reused for the
  status badge in the UI.

### 3.2 Polling & dedup (AutoTask model)

- `pollMailbox` becomes real, **per transport**:
  - `imap`/`ews` (basic auth): connect + fetch `UNSEEN` (UID ≥ stored `lastUid`)
    and parse into `ParsedEmail`.
  - `microsoftGraph` (modern auth): `GET /users/{mailbox}/mailFolders/{folder}/messages`
    with `$filter=receivedDateTime gt <cursor>` and `$select` for the fields we
    need; fetch MIME via `$value` when attachments/headers are required. Cursor
    = last `receivedDateTime` (plus a tie-break by `id`) persisted per connector.
- **Dedup:** persist the cursor (`lastUid` for IMAP/EWS, `lastReceivedAt`+`lastId`
  for Graph) in `SystemConfig` key `email_connector:<id>:cursor` (or `settings`).
  Skip messages already seen.
- **Process-then-mark:** a message is marked seen (or moved to a "Processed"
  folder when configured) **only after successful processing** - failures are
  retried on the next poll (AutoTask behavior). Hard failures (unparseable,
  permanent bounce) are logged with the reason so they don't retry forever
  (after N attempts, mark seen + record `errorMessage`).

### 3.3 Field deduction (ConnectWise Asio-style matching)

Pure, testable functions in `packages/email/src/fieldDeduction.ts`:

| Ticket field | Deduction rule |
|---|---|
| **Subject → title** | Strip `Re:/FW:` prefixes and existing `[C7-XXXXX]` / `[TKT-...]` tags. If subject empty after stripping → `"Email from <sender>"`. |
| **Name** | Sender display name ("John Smith <j@acme.com>") → split first/last. No display name → derive from email local part, capitalized. |
| **Contact** | Look up `Contact` by **case-insensitive email** (normalize: trim, lowercase). If missing and `autoCreateContact` → create with deduced first/last name under the resolved company. |
| **Company** | 1) matched contact's `companyId`; 2) sender **email domain** matched against `Company.website`/`Company.email` domains (extract registrable domain, compare case-insensitively); 3) `defaultCompanyId` from connector settings; 4) if `autoCreateCompany` → create company named after the domain (e.g. "acme.com"), else use the configured default (ticket's `companyId` is required, so a default must exist - enforce at save time). |
| **Description** | `bodyText`; strip quoted-reply trailers (`On <date>, <x> wrote:` and leading `>` lines) and 30+ char signature lines; collapse excessive whitespace; cap length (e.g. 20k chars). |
| **Priority** | Existing `extractPriority` keyword list + connector `priorityKeywords`; subject keywords (urgent/asap/critical/down) → high; default medium. |
| **Source / status** | `source: "email"`, `status: "new"`. |
| **Board** | The connector's configured `boardId` (per-mailbox board mapping - ConnectWise Manage model). |
| **Threading** | `matchEmailToTicket` already detects subject tags and `In-Reply-To`/`References` headers: match → **append TicketComment** (with email metadata note) instead of creating. Strip known auto-responders (`Auto-Submitted: auto-replied`, `X-Auto-Response-Suppress`, empty body + "out of office") when `ignoreAutoReplies`. |

### 3.4 Ticket creation service

New `apps/api/src/services/emailToTicket.ts` (not a route - used by the
connector, avoiding session-user coupling):

- `resolveSystemActor()` - a dedicated **"Email Connector" system user**,
  created idempotently at boot (seeded like `seed-service-alerts.ts`), used as
  `createdById` (the ticket requires it; avoids using the admin user).
- Reuse the **same ticket-number generation** as `POST /api/tickets`
  (`ClientType-ClientID-Seq`) - extract that logic into
  `services/ticketNumber.ts` and call it from both places (behavior-identical,
  non-breaking).
- Create ticket with `source: "email"`, `customFields.email = { messageId,
  from, to, cc, date }` (auditability), then create `TicketComment` containing
  the original email metadata, and attachments (size-capped).
- All operations in one Prisma `$transaction`.

### 3.5 API surface (additive only)

New `apps/api/src/routes/email-connectors.ts` mounted at
`/api/email-connectors` behind the existing integration permission used by
`cloudconnect` (`requirePermission(...)`; confirm exact `Permission` member,
else `IntegrationManage`):

- `GET /` — list connectors (credentials redacted: return only
  `hasCredentials: true`, plus `authType`/`connectionType` metadata).
- `POST /` — create (validate per `connectionType`/`authType`: for `imap`/`ews`
  + `basic` require host/port/user; for `microsoftGraph` require `tenantId`,
  `clientId`; always require `boardId` and a satisfiable default-company rule).
- `PATCH /:id` — update settings/credentials (partial).
- `DELETE /:id` — remove + stop polling.
- `POST /:id/test` — real connection test per transport: IMAP/EWS connect +
  login + folder select; Graph: acquire/refresh token + list the configured
  folder. Returns structured field errors (mirror CloudConnect's test UX).
- `POST /:id/poll` — manual poll now (admin/debug).
- `GET /:id/status` — last poll time, processed count, last error (from
  `Integration.status/errorMessage/lastSyncAt` + in-memory stats).
- **M365 OAuth endpoints:** `POST /:id/oauth/authorize` (builds the
  authorization URL with PKCE/state and returns it; delegated flow),
  `GET /api/email-connectors/oauth/callback` (unauthenticated, state-validated:
  exchanges the code for tokens, stores encrypted `refreshToken`/`accessToken`,
  then redirects to the CloudConnect page), `POST /:id/oauth/refresh`
  (admin-forced refresh; also used internally on 401 from Graph).

### 3.6 Bootstrap wiring (index.ts, guarded)

After server listen (next to `startSnapshotPoller`):

- Load enabled `email_connector` integrations, hydrate `EmailConnectorManager`,
  register `onNewTicket`/`onUpdateTicket` handlers that call the
  `emailToTicket` service, start polling.
- Gate behind `EMAIL_CONNECTORS_ENABLED !== "false"` env (default on) so a bad
  mailbox config can't take the app down: every poll/parse error is caught,
  logged via the existing logger, and reflected in `Integration.errorMessage`.
  No connector configured → nothing happens (zero impact on existing flows).

### 3.7 Frontend (CloudConnect extension)

- New **"Email Connectors" tab/section inside `CloudConnect.tsx`** (non-breaking
  addition to the existing page; no new nav entry needed initially):
  - List: mailbox/board, enabled toggle, status (last poll, error).
  - Form: host, port, secure, user, password, folder, poll interval,
    board selector (from `/api/boards`), default company selector, toggles for
    auto-create contact/company, ignore auto-replies.
  - **Test Connection** button (uses `POST /:id/test`), **Poll now** button.
  - "Recent processed" list linking to the created ticket (via
    `GET /api/email-connectors/:id/status` stats + `GET /api/tickets?search=`).
- No changes to existing pages/components; only additive state + sections.

### 3.8 Microsoft 365 Exchange mailbox support (legacy + modern auth)

Microsoft 365 Exchange is supported as a first-class mailbox source. The
connector form gains a **mailbox type selector**: *IMAP/EWS (legacy)* vs
*Microsoft 365 (Exchange Online)*, and for M365 an **auth type selector**:
*Legacy (Basic Auth)* vs *Modern (OAuth 2.0)* — matching ConnectWise Manage's
Email Connector setup table (which offers Exchange/O365 as a mailbox type with
separate auth configuration) and ConnectWise Asio's native OAuth-based M365
integration.

| Option | Legacy authentication | Modern authentication |
|---|---|---|
| Transport | IMAP (`outlook.office365.com:993`) or EWS (`https://outlook.office365.com/EWS/Exchange.asmx`) | Microsoft Graph (`graph.microsoft.com/v1.0`) |
| Credentials | Username + password (Basic) | OAuth 2.0 app registration: `tenantId`, `clientId`, `clientSecret` (server-only), tokens |
| OAuth flow | — | Delegated (authorization code + PKCE, user consents `Mail.ReadWrite` — supports shared mailboxes via delegate) **or** Application (client credentials, tenant-admin consents `Mail.ReadWrite` app permission — mailbox-wide access, preferred for unattended connectors) |
| Token lifecycle | n/a | `accessToken` (short-lived) + `refreshToken` (rotated, stored encrypted); auto-refresh on 401; refresh-token expiry surfaced as a status error prompting re-consent |
| Deprecation | Microsoft has disabled Basic Auth for Exchange Online (and IMAP/POP/SMTP AUTH for new tenants since Oct 2022) — UI shows a deprecation banner; option retained for tenants that explicitly re-enable SMTP/IMAP AUTH | Not applicable |
| Library | `imapflow` (or `ews-javascript-api` for EWS) | `@microsoft/microsoft-graph-client` + `@azure/identity` (confidential client) |

**Configuration options added to the connector form (M365):**

- `connectionType`: `microsoftGraph` (modern) or `ews` (legacy).
- `authType`: `oauth2` or `basic`.
- `tenantId` — Azure AD tenant (`common`, `organizations`, or the tenant GUID).
- `clientId` / `clientSecret` — from the app registration (client secret never
  returned by any API; stored encrypted).
- `mailboxAddress` — the mailbox to monitor (own mailbox or shared/delegate
  mailbox; for application-permission flows this is the target user's UPN).
- `folder` — well-known folder name (`Inbox`, `Inbox/Subfolder`) or folder id.
- OAuth flow fields surfaced as state, not free-text: **"Connect to Microsoft"**
  button → consent → token status (`authorized`, `refresh needed`, `expired`).

**Polling behavior (Graph):** same process-then-mark contract as §3.2, but
instead of IMAP flags: fetch messages newer than the persisted cursor, process
successfully → advance cursor, optionally move the message to a "Processed"
folder via Graph `move` (only after success). `receivedDateTime` ordering + id
tie-break prevents skips/duplicates; Graph throttling (HTTP 429) triggers
backoff and a `status` update, never a crash.

**UI changes (CloudConnect "Email Connectors" tab):** mailbox type selector;
when M365 + OAuth2 is selected the host/port/user/password fields are replaced
by tenantId/clientId/clientSecret (server-side) + a **Connect to Microsoft**
button and token status badge; when M365 + Basic is selected the form keeps
user/password and shows the deprecation banner.

**Security & operations:** client secret and tokens live only in
`Integration.credentials` (encrypted with the existing mechanism); the OAuth
callback is state/PKCE-validated; token refresh failures mark the connector
`error` (no crash, no retry storm — exponential backoff); no changes to other
integration flows.

## 4. Implementation phases (incremental, each independently shippable)

Phases below are listed in **dependency order** (prerequisites first). Each
phase is independently shippable only if its listed prerequisites are live.

1. **Phase 1 — Package only (no runtime impact).** Implement real IMAP polling
   in `packages/email` (`imapflow` or `node-imap` + `mailparser`), complete
   `ParsedEmail` building, and `fieldDeduction.ts` pure functions + unit tests.
   Nothing in `apps/api` references it yet.
   - **Depends on:** nothing (self-contained).
2. **Phase 2 — Storage & routes (default off).** Reuse `Integration` rows
   (`kind: "email_connector"`); add `routes/email-connectors.ts` CRUD + test;
   wire router in `index.ts`. No polling started yet.
   - **Depends on:** Phase 1 (`ParsedEmail`/`EmailConnectorConfig` types and the
     transport code the test endpoint exercises).
   - **Risk if Phase 1 is skipped:** the test endpoint has no real transport to
     exercise and the config type is untyped; connectors can be stored but
     never validated, hiding misconfiguration until Phase 3 polling.
3. **Phase 3 — Processing.** `services/ticketNumber.ts` extraction,
   `services/emailToTicket.ts` (system user, contact/company resolution,
   threading → comments, attachments, dedup cursor), bootstrap hydration +
   guarded polling. Connectors only run when explicitly enabled in config.
   - **Depends on:** Phase 1 (polling + deduction), Phase 2 (stored configs to
     hydrate; CRUD to create rows). Also depends on the dedicated "Email
     Connector" system user being seedable (§3.4).
   - **Risk if Phase 2 is skipped:** nothing to hydrate at boot — polling never
     starts, so the feature appears dead; if Phase 1 is skipped there is no
     mailbox fetch and dedup cursor logic has no source of messages.
4. **Phase 4 — UI.** CloudConnect "Email Connectors" tab (list/form/test/poll
   now/status).
   - **Depends on:** Phases 2–3 (endpoints in §3.5 must exist; status data is
     produced by the running poller).
   - **Risk if Phases 2–3 are skipped:** the tab renders against missing
     endpoints (404s), test buttons fail with network errors, and status shows
     nothing useful.
5. **Phase 5 — Microsoft 365 modern auth.** Graph transport + OAuth 2.0
   (authorize/callback/refresh endpoints, token storage, Graph polling with
   cursor, shared-mailbox `mailboxAddress`), plus the M365 form variants and
   token status in the UI. `@microsoft/microsoft-graph-client` +
   `@azure/identity` pinned. Legacy IMAP connectors unaffected.
   - **Depends on:** Phase 2 (credentials storage + validation surface),
     Phase 3 (bootstrap hydration + `onNewTicket`/`onUpdateTicket` wiring the
     Graph transport feeds), Phase 4 (UI variants for the M365 form).
   - **Risk if Phases 2–4 are skipped:** OAuth tokens have no encrypted home
     (§3.1), the callback route has no connector row to bind to, and the
     polling loop is never started — M365 connectors can be authorized but
     never process mail.
6. **Phase 6 — Microsoft 365 legacy auth.** EWS (`ews-javascript-api`) and/or
   IMAP Basic Auth transport selection, deprecation banner, and test-connection
   per transport. Disabled-by-default behind the same `enabled` flag.
   - **Depends on:** Phase 5's transport-selection abstraction in the form and
     per-transport test endpoint (§3.5), plus Phase 3's poller (IMAP path).
   - **Risk if Phase 5 is skipped:** the transport selector has no shared
     plumbing, so legacy and modern flows diverge into two code paths and the
     deprecation-banner gating logic has no hook to attach to.
7. **Phase 7 — Hardening (optional, same release).** Attachment size caps,
   TLS enforcement (`secure: true` required with a confirm override), backoff
   on repeated auth failures (incl. Graph 429), auto-reply suppression rules,
   outbound acknowledgment email via existing `EmailService` (off by default).
   - **Depends on:** Phases 3–6 (the running poller and transports the caps,
     backoff, and suppression rules instrument).
   - **Risk if Phases 3–6 are skipped:** hardening has no code path to guard;
     attachment caps/backoff would need to be retrofitted into transports that
     don't exist yet.

Cross-phase dependency summary: §3.4 (`emailToTicket.ts`) depends on §3.3
(field deduction); §3.7 (UI) depends on §3.5 (API surface); §3.8 (M365)
depends on §3.1–§3.2 (config model + per-transport cursors).

## 5. Rollback plan

- **Instant stop:** set `enabled=false` on every `email_connector` Integration
  row (UI toggle or DB update) - polling stops; no new tickets are created;
  existing tickets/boards/contacts remain untouched.
- **App-level kill switch:** set `EMAIL_CONNECTORS_ENABLED=false` in
  `apps/api/.env` and restart - the bootstrap skips hydration entirely even if
  rows exist.
- **Code rollback:** revert the feature commit(s). Everything is additive:
  - `apps/api`: one new route file, one new service file, small `index.ts`
    additions (router mount + guarded bootstrap) - removing them restores the
    previous build.
  - `packages/email`: new functions/file - no existing callers changed.
  - `apps/web`: additions inside `CloudConnect.tsx` only - revert to restore.
  - **No Prisma schema change** (connector config lives in the existing
    `Integration` table) → no migration, no `db push`, no data loss risk.
  - Leftover `Integration` rows with `kind="email_connector"` are inert once
    the code is reverted; delete them with one SQL/UI action if desired.
- **Data safety:** email processing never mutates existing tickets except
  appending comments (threaded replies); ticket creation is a single
  `$transaction`; the dedup cursor is updated only after success, so a
  rollback/restart reprocesses at worst one email once (idempotency by
  Message-ID check before create).

## 6. Verification plan

- **Unit:** field-deduction functions (subject stripping, name split, domain
  match, priority keywords, quote stripping) - table-driven tests.
- **API:** CRUD + test-connection against a local test IMAP server
  (e.g. `greenmail` docker image or `mailhog`-style fixture), incl. wrong
  password → structured error; redaction check (no password in GET).
- **E2E manual:** create connector to test mailbox → send plain email → new
  ticket appears with correct title/description/board/source=email and
  correct contact/company; send reply with `[C7-XXXXX]` in subject → comment
  appended, no duplicate; restart API mid-stream → no duplicate processing;
  auto-reply (out-of-office) → ignored.
- **Regression:** existing ticket create/list flows, CloudConnect page,
  snapshot poller, and boot pipeline (`verify-post-change.ts` + boot.ps1) all
  still green; no new `tsc` errors introduced beyond the known baseline.

## 7. Known constraints / decisions to confirm at implementation start

- `Ticket.companyId` is required → enforce a resolvable default company at
  connector save time.
- `Contact.email` has no unique index → lookup-first; optionally add
  `@@index([email])` later (non-breaking) if dedup matters at scale.
- `createdById` must be a real user → dedicated seeded "Email Connector" system
  user (idempotent seed).
- Credential encryption must reuse the existing CloudConnect credential
  mechanism - do not introduce a new key/fallback.
- IMAP library choice (`imapflow` preferred: modern, connection pooling, no
  abandoned `node-imap` issues) — pin exact version in Phase 1.
- **M365 prerequisites (confirm at Phase 5 start):** Azure AD app registration
  (delegated: redirect URI `http://localhost:4000/api/email-connectors/oauth/callback`,
  `Mail.ReadWrite` scope, PKCE; application permission: `Mail.ReadWrite` +
  tenant-admin consent), whether to default to delegated or app-only flow,
  and the exact tenant id(s) to test against.
- **Basic Auth deprecation:** legacy M365 Basic Auth is tenant-dependent
  (disabled by default for Exchange Online); the UI must warn and the test
  endpoint must surface Microsoft's error codes distinctly (e.g. `AUTHFAILED`
  vs `UNAVAILABLE`).
- Graph polling requires `Mail.Read` at minimum for the monitored mailbox;
  moving messages to a "Processed" folder requires `Mail.ReadWrite`.
- Refresh-token rotation: persist the rotated token after every refresh so a
  restart never replays a stale refresh token.
