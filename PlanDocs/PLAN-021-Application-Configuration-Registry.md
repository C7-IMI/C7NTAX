> **Plan ID:** PLAN-021
> **Title:** Application Configuration — one registry, one screen, and the customer portal's own section
> **Source:** authored in `PlanDocs/` — the request to add a Customer Portal configuration subsection under Administration and make the features added during the implementation programme configurable
> **Indexed:** 2026-10-07

# Application Configuration

> **Sequence:** follows the Help rewrite (BuildNotes **2026.10.7.028**) and the implementation programme that came before it (W0–W2, W5-1, PLAN-015 backlog, PLAN-020 phases 0–6). It is the step that turns the programme's feature flags and hard-coded limits into a surface an operator can reason about, and it is a prerequisite for packaging: a deployment cannot be handed over while its settings screen is a form that does nothing.
> **Status:** ⚠️ **Built the same day, and the code is the evidence**: `packages/shared/src/appConfiguration.ts` (the registry), `apps/api/src/services/appSettings.ts` (resolution and the write path), `apps/api/src/routes/configuration.ts` (the API), `apps/web/src/pages/Configuration.tsx` and `CustomerPortalSettings.tsx` (the screens), `apps/api/probe-configuration.mjs` (78 assertions). BuildNotes **2026.10.7.029**.
> **Basis:** repository as at BuildNotes **2026.10.7.028**. Every claim about what *was* read is a `grep` result over `apps/api/src` and `apps/web/src`, and every claim about what *is* read now is a call site named in the two sections below.
> **Reference platforms:** Autotask PSA, ConnectWise (PSA/Asio) and Scoro, used for the shape of the surface and for where each setting belongs. See §9.
> **Next action:** §8 lists the decisions this work did not take. None of them block anything else.

---

## 1. What configuration looked like before this

The audit that produced the Help rewrite (BuildNotes 2026.10.7.028) kept turning up settings screens that disagreed with the code. The configuration work started by measuring that, and the measurement is the reason this document exists.

| Surface | What it claimed | What actually read it |
| --- | --- | --- |
| **Administration → System Settings → General** | Company name, time zone, date format, default language, session timeout, homepage dashboard | Exactly one field: `general.contextMenus`, read by [useContextMenusEnabled.ts](../../apps/web/src/hooks/useContextMenusEnabled.ts). **The session-timeout control on this screen wrote `app_settings.general.sessionTimeout`, while the idle timeout the server enforces is the separate `session_timeout` row** read by `sessionAuth.getSessionTimeoutMs()`. |
| **→ Email** | SMTP host, port, user, password, from address, alert recipient, footer | Nothing. Outbound mail reads `SMTP_*` from the environment in [EmailService.ts](../../packages/email/src/EmailService.ts). |
| **→ Security** | Minimum password length, session lockout, audit retention, require MFA, IP whitelist | Nothing. |
| **→ Integration** | API keys (JSON), webhook URL, webhook secret | Nothing. |
| **→ Database** | Connection string, backup schedule, retention policy | Nothing. The connection string comes from `DATABASE_URL`. |
| **My Settings (personal)** | "Session Timeout" and "Default Landing Page" | Both wrote **instance-wide** keys. One person's preference silently became everyone's, and the landing page was then handed to every user at sign-in by `POST /auth/login`. |
| **Feature flags** | — | Eighteen `process.env` reads at their call sites, with no surface anywhere: portal, uptime monitors, alert webhooks, social source, KB auto-draft, M365 offboarding, CloudConnect live status, email connectors, Graph delivery, Outlook add-in, AI actions, bill-through batch, time rules, quotes, push, bill-from-tickets, sessions, passkeys. |
| **Orphaned pages** | — | `/admin/webhooks`, `/service-alerts/monitors`, `/quotes` and `/ai-actions` had routes in `App.tsx` and no entry in the navigation, so four shipped features were unreachable except by typing the URL. |
| **`/system/config/:key`** | — | Defined **three times** in [system.ts](../../apps/api/src/routes/system.ts). Express takes the first match, so the second and third copies were dead code — including two `PATCH` handlers that did **not** call `assertConfigWriteAllowed`. Reordering them would have silently removed the write guard. |

Two conclusions followed, and they set the design:

1. **A hand-written settings screen drifts from the code that reads it, and nothing catches the drift.** So the screen had to be *generated* from a declaration the server also enforces.
2. **A setting the product cannot act on is worse than no setting.** So a field may only exist if something reads it, and the declaration has to name what.

---

## 2. What was built

### 2.1 One registry, shared by both ends

[appConfiguration.ts](../../packages/shared/src/appConfiguration.ts) declares every configurable thing in the product once. Each field carries:

| Property | Why it is required |
| --- | --- |
| `source` | `setting` (saved, editable) or `environment` (reported, never written from a browser session) |
| `env` / `envMatch` | The variable it stands in for, and **how that variable was read** — `not-false` reproduces `!== "false"` (a flag that ships on), `is-true` reproduces `=== "true"` (a flag that ships off) |
| `default` | What applies when neither a setting nor the environment supplies a value |
| `summary` / `detail` | One line, and the longer explanation: what changes, what happens when it is off, what it needs |
| `affects` | The screens and behaviours that change, so the consequence is on the screen rather than in a wiki |
| `min` / `max` / `choices` | The validation the API enforces *and* the control the form draws |
| `restartRequired` | The value is sampled once by a long-running service, so it applies at the next start |
| `store` | An explicit `SystemConfig` address, for the four settings that already had a home (`session_timeout`, `default_landing_page`, `app_settings.general.contextMenus`) |

Because the registry is a value, not a function, it travels to the browser unchanged: the same object that validates a write draws the field.

### 2.2 Resolution, with the environment kept as the fallback

[appSettings.ts](../../apps/api/src/services/appSettings.ts) resolves a value in this order:

1. the stored setting (a `SystemConfig` row);
2. the environment variable the field names, read **exactly** the way the original code read it;
3. the declared default.

It holds the whole set in memory — refreshed on a 30-second timer, immediately on any write, and before each long-running service starts — because the alternative is a database round trip inside a feature guard that cannot `await`. Two properties are deliberate:

- **A failed refresh keeps the previous snapshot.** A database blip must not switch features off, so the code logs and keeps what it had.
- **Before the first load, the accessors answer with the environment-derived value**, which is precisely what the application did before this existed. There is no window in which a feature behaves differently from yesterday.

### 2.3 The flag read sites, converted

Each flag was read at one call site, which is what made this safe to do:

| Flag | Now read from | File |
| --- | --- | --- |
| `PORTAL_ENABLED`, `PORTAL_DEFAULT_BOARD_ID` | `configFlag` / `configText` | [portal.ts](../../apps/api/src/routes/portal.ts), [portalBoard.ts](../../apps/api/src/services/portalBoard.ts), [portalAuth.ts](../../apps/api/src/services/portalAuth.ts) |
| `UPTIME_MONITORS_ENABLED`, `SERVICE_ALERTS_SOCIAL_ENABLED` | `configFlag` | [alertMonitor.ts](../../apps/api/src/services/alertMonitor.ts) |
| `ALERT_WEBHOOKS_ENABLED` | `configFlag` | [alertWebhooks.ts](../../apps/api/src/routes/alertWebhooks.ts) |
| `KB_AUTOGEN_ENABLED`, `KB_AUTOGEN_MODEL` | `configFlag` / `configText` | [kbAutogen.ts](../../apps/api/src/services/kbAutogen.ts), [LlmProvider.ts](../../apps/api/src/services/inference/LlmProvider.ts) |
| `M365_OFFBOARD_ENABLED` | `configFlag` | [m365Inactivity.ts](../../apps/api/src/services/m365Inactivity.ts) |
| `CLOUDCONNECT_LIVE_STATUS_ENABLED`, `CLOUDCONNECT_VERIFY_INTERVAL_SEC` | `configFlag` / `configNumber` | [integrationHealth.ts](../../apps/api/src/services/integrationHealth.ts) |
| `EMAIL_CONNECTORS_ENABLED`, `EMAIL_CONNECTORS_CLOUD_ENABLED`, `EMAIL_GRAPH_ENABLED` | `configFlag` | [emailConnectorRuntime.ts](../../apps/api/src/services/emailConnectorRuntime.ts) |
| `OUTLOOK_ADDIN_ENABLED` | `configFlag` | [outlookAddin.ts](../../apps/api/src/routes/outlookAddin.ts) |
| `AI_ACTIONS_ENABLED` | `configFlag` | [aiActions.ts](../../apps/api/src/routes/aiActions.ts) |
| `INVOICE_BATCH_ENABLED`, `TIME_RULES_ENABLED`, `BILLING_FROM_TICKETS_ENABLED`, `QUOTES_ENABLED` | `configFlag` | [billingBatch.ts](../../apps/api/src/services/billingBatch.ts), [timeRules.ts](../../apps/api/src/services/timeRules.ts), [billing.ts](../../apps/api/src/routes/billing.ts), [quotes.ts](../../apps/api/src/routes/quotes.ts) |
| `PUSH_ENABLED` | `configFlag` | [push.ts](../../apps/api/src/routes/push.ts) |
| `SESSION_AUTH_ENABLED` | `configFlag` | [sessionAuth.ts](../../apps/api/src/middleware/sessionAuth.ts) |

`SERVICE_ALERT_POLL_MINUTES` is new: the monitor's five-minute interval was a module constant, and it is also the shortest life an alert may have, so it is now a setting that is sampled once as the monitor starts and marked restart-required.

**Module-scope reads had to be handled separately.** `alertMonitor`'s poll interval and stale ceiling were `const`s computed at import time, and ES module bodies run before the settings snapshot is loaded — so a `configNumber()` at module scope would have silently captured the environment default forever. They became `let`s sampled by `readMonitorTiming()`, called from `startAlertMonitor()`, and the time-rule defaults became `defaultTimeRuleSettings()`, read per call. This is the class of bug worth remembering from this change.

### 2.4 The API

[configuration.ts](../../apps/api/src/routes/configuration.ts):

- `GET /api/configuration` — the registry with values resolved, the saved value, the environment's own value, whether one is overriding the other, the choices only the database can supply (service boards, landing pages, inference models), and each area's unmet requirements.
- `PATCH /api/configuration/:sectionId/:fieldId` — validated against the registry, then written. The path names a **section and a field**, never a storage key, so this endpoint cannot address a `SystemConfig` row the registry does not own. That is why it needs no deny-list where the general endpoint next door does.
- `DELETE /api/configuration/:sectionId/:fieldId` — clears a stored value so the deployment's own applies again. Its own verb because "unset" and "set to the default" are different states and the screen has to say which one it is in.
- `GET /api/configuration/portal/overview` — the parts of the portal that are not a single value: every client's access state, how many of its contacts could actually sign in, which board tickets land on, and the last 25 sessions.
- `PATCH /api/configuration/portal/clients/:companyId` — per-client access and branding.
- `GET /api/system/deployment` — the non-secret deployment facts the System Settings screen reports: whether a mail relay answers (host, port, TLS, whether credentials are set, the from address), the database host and name **with the credentials stripped**, the runtime, and where the Outlook add-in is served from.

The three duplicated `/system/config/:key` handlers were removed, and the survivor now refuses any `config:` key so the registry's rows have exactly one way in.

### 2.5 The screens

| Route | What it is |
| --- | --- |
| `/admin/configuration` (also `/admin`) | The hub: eight areas, how many settings each holds, which need a restart, which have an unmet requirement, and a statement of how a value is decided |
| `/admin/configuration/:sectionId` | One area: the requirements that are not met, the settings, then the deployment-owned values, each with its badges, its "changes" list and a reset control when it is overriding the deployment |
| `/admin/portal` | The portal: availability and access scope, sign-in security, branding **against a live preview**, the per-client access table, and recent sessions |
| `/admin/system` | Rewritten. It reports the poller's state, the recovery history and the deployment facts, and signposts every setting. It has nothing to save, because everything it used to offer was one of the thirty controls that did nothing |

### 2.6 The customer portal's own configuration

The portal's limits were module constants and its behaviour was fixed. Each one is now a setting, read per call so a change applies to the next sign-in rather than the next restart:

| Setting | Was | Now |
| --- | --- | --- |
| Sign-in code lifetime | `CODE_TTL_MS`, 10 minutes | `portal.codeExpiryMinutes`, 2–60 |
| Attempts per code | `CODE_MAX_ATTEMPTS`, 5 | `portal.maxVerifyAttempts`, 1–20 |
| Codes per customer per window | `CODE_MAX_PER_WINDOW` 3 / `CODE_WINDOW_MS` 15 min | `portal.codesPerWindow`, `portal.codeWindowMinutes` |
| Customer session lifetime | `SESSION_TTL_MS`, 8 hours | `portal.sessionHours`, 1–24 |
| Signed-in devices | `MAX_ACTIVE_SESSIONS`, 5 | `portal.maxDevices`, 1–20 |
| Which tickets a customer sees | contact-only, fixed | `portal.visibility`: contact or **whole client** |
| May raise tickets | always | `portal.allowTicketCreation`, enforced in the handler as well as hidden in the UI |
| May reply | always | `portal.allowReplies`, same |
| Default board | `PORTAL_DEFAULT_BOARD_ID` or the oldest board | the setting first, then the variable, then the oldest board |
| Accent, logo | per client only | instance defaults that a client overrides |
| Welcome line, support address | absent | `portal.welcomeText`, `portal.supportEmail`, on the portal's sign-in page and footer |

`GET /api/portal/branding` is new and unauthenticated — the same for every visitor, so it carries no customer fact — which is what lets the *sign-in page* wear the configured name and accent rather than the product's own.

---

## 3. Resolution, stated plainly

```
stored setting  →  environment variable  →  declared default
```

A field shows all three: the value in force, whether anything is saved, and what the deployment's own value is. When a saved value differs from the deployment's, the field says so and offers to let it go.

---

## 4. What is configurable, and where

| Area | Fields | Examples |
| --- | --- | --- |
| **Workspace** | 3 | Company name (the portal's title), application right-click menus, the instance's default landing page |
| **Sessions & Security** | 8 | Idle timeout, maximum session life, whether administrators are exempt; session auth, hardening, passkeys and SSO as reported deployment state |
| **Customer Portal** | 15 | Everything in §2.6 |
| **Service Alerts & Monitoring** | 7 | Uptime monitors, alert webhooks, social source, poll interval, stale ceiling, and the X credential as a reported fact |
| **Knowledge Base & AI** | 3 | Drafting from resolved tickets, the drafting model, AI action proposals |
| **CloudConnect, Email & Microsoft 365** | 9 | Live verification and its throttle, email connectors, cloud connectors, Graph delivery, attachment ceiling, the Outlook add-in, M365 offboarding, private-address egress |
| **Billing & Invoicing** | 7 | Bill-through batch, time rules and their defaults (cut-off, multiplier, whether overtime counts), quotes, bill-from-tickets |
| **Client Apps & Notifications** | 1 | Push notifications |

Forty-seven of them are changeable from the screen; the rest are reported.

---

## 5. What deliberately did **not** become configurable

This is the half of the design worth reviewing, because "make everything configurable" would have been wrong four times over.

1. **The switches that decide whether authentication is enforced at all** — `SESSION_AUTH_ENABLED` and `AUTH_HARDENING_ENABLED` — are reported and never written. A configuration screen that can turn off account lockout and short-lived tokens is a privilege-escalation path with a friendly label, and no operator asked for it. `SESSION_AUTH_ENABLED` is additionally marked *required* in the registry so the UI cannot even offer it.
2. **Credentials** — `X_BEARER_TOKEN`, `SSO_ISSUER`, `WEBAUTHN_RP_ID`, the mail password, `DATABASE_URL` — are reported as configured or not, never returned and never editable from a browser session. The general key-value endpoint already refuses a key matching `/secret|token|password|credential|apikey/i` for the same reason, and this surface does not weaken that.
3. **Passkeys and SSO are switchable but only where they can work.** Both are additive (password sign-in keeps working), and both declare an environment requirement the screen reports as met or unmet. Turning them on without the relying-party id or the issuer is a supported action that simply does not work yet, and the screen says so.
4. **Facts that only the deployment owns are shown, not invented.** The connection string, the backup schedule, the retention policy, the SMTP credentials and the API-key block are gone as controls. Three of them were never read by anything; the other two belong to the environment. What replaced them is a truthful panel: this is the relay, this is the database, this is where the add-in is served from, and the variable that owns each one.
5. **One thing that *is* now configurable was a judgement call**: `portal.visibility` can widen a customer's view from their own tickets to every ticket at their client. The original code says in a comment that company-wide access is deliberately *not* the default because "a client with three hundred employees should not have each of them reading the others' tickets". That reasoning is preserved as the default and restated in the field's own text; the setting exists because a one-mailbox small business is a real customer of this product and the provider, not the code, should decide.

---

## 6. Configuration options corrected elsewhere

Three things outside the new screen were wrong and are now right.

1. **The personal landing page is personal.** `User.landingPage` is a new column (migration `20261007154417_user_landing_page`), set through `PATCH /auth/me/landing-page`. `POST /auth/login` resolves the person's own choice, then the instance default from the registry, then the dashboard. Choosing the dashboard clears the override rather than storing one, so a later change to the instance default still reaches everyone who never chose.
2. **The idle timeout is not a personal preference.** It is one policy for the organisation, so My Settings shows it read-only to anyone without `system:config` and routes administrators through the validated configuration endpoint — the same 5–480 range the configuration screen enforces. This also removes the standalone `PATCH /system/config/session_timeout` write from the personal screen, which was a self-service path to a global policy.
3. **Four features are reachable.** Quotes (under Billing), Uptime Monitors and Alert Webhooks (under Administration) and AI Actions now have navigation entries. Their routes were already in `App.tsx`; nothing else about them changed.

---

## 7. The dead code that was removed

`/system/config/:key` was defined three times. Express matches in registration order, so the second and third copies never ran — and two of those copies omitted `assertConfigWriteAllowed`. The duplication is gone, and the surviving handler now refuses any `config:` key with a message pointing at the configuration screen, so the registry's rows have exactly one way in.

---

## 8. Decisions this work did not take

| # | Question | Why it was left | What it would take |
| --- | --- | --- | --- |
| 1 | Should the **alert poll interval** restart the timer, rather than waiting for a restart? | The interval also defines the shortest life an alert may have, so moving it mid-flight shifts a finish line that open alerts are already running against | A monitor that reschedules itself and re-derives `MIN_ALERT_AGE_MS` per poll; the registry field's `restartRequired` comes off |
| 2 | Should **`app_settings` be retired**? | It still holds `general.contextMenus` and the SPA's `useContextMenusEnabled` reads it by that exact address. The registry now shares the row rather than moving it | Move the value to `config:workspace` and update the one hook; the row can then be deleted |
| 3 | Should **passkeys and SSO be switchable at all**? | They are additive and their requirements are reported. A stricter posture would report them as deployment-owned like session auth | Mark both `source: "environment"` |
| 4 | Should **more of the 47 be exposed on the hub** rather than one area at a time? | The area pages already carry the detail; a flat list would be a wall | No work — a preference |
| 5 | Should **product catalogue and service-board settings** move into the registry? | They are entity configuration (records with their own tables), not application settings, and both already have purpose-built screens | A different abstraction, not a bigger registry |

---

## 9. Reference platforms

The three platforms the request named, and what was taken from each. No screens were copied; what was taken is structure and placement.

| Platform | What it does | What was taken |
| --- | --- | --- |
| **Autotask PSA** | **Admin → Client Portal** collects enablement, what customers may see and do, and the portal's identity in one place; the per-client half lives on the client record ("Portal access" on the company) | Splitting the portal's configuration the same way — instance policy in one screen, per-client access and branding in a table on that same screen with the client record still authoritative — and putting **what a customer may do** (raise, reply) beside **what a customer may see** (visibility scope) rather than under security |
| **ConnectWise PSA / Asio** | Setup tables are grouped by capability, each table states what it governs, and system-level switches that a partner must not change are shown as read-only facts | The area-per-capability grouping and the **"set by the deployment"** section: values that are real, relevant and not editable here are shown with the variable that owns them, instead of being hidden or faked |
| **Scoro** | Per-client visibility chooses which of the client's own records a portal user sees, and branding is a default with per-client override | The instance-default-then-client-override model for accent and logo, and `portal.visibility` as an explicit choice rather than a hard-coded rule |

Two conventions were adopted from all three: **a settings screen says what each field changes**, and **a disabled control explains itself** rather than disappearing.

---

## 10. Verification

| Check | Result |
| --- | --- |
| `apps/api/probe-configuration.mjs` | **78 passed, 0 failed** — resolution order, polarity of every converted flag, validation (choices, ranges, colours, clock times, unknown fields, unknown areas, deployment-owned fields, required fields), the general key-value route refusing a registry row, per-client access, branding, permissions per area, and that nothing is left behind |
| API typecheck (`npx tsc --noEmit`) | 150 errors — **below the 151 pre-existing baseline**, none in a file this change touched |
| Web typecheck | 0 errors |
| `node scripts/check-route-guards.mjs` | 388 routes, 342 carry a permission guard, 0 violations |
| `node scripts/check-help-links.mjs` | 74 routes, 19 walkthroughs, 38 links — all resolve |
| `node scripts/lint-design-tokens.mjs` | 5 files flagged, **all pre-existing** (report renderer, ClientDetail); this change removed 4 files from that list and added none |
| Browser | 19 routes visited with zero console errors and no blank pages; the accent colour set on the portal configuration screen was observed on the customer-facing sign-in button (`rgb(185, 28, 28)`), and clearing it reverted the portal to the default |
| Database | every setting changed during verification was returned to its found state; `session_timeout` is back to `5` — **which is worth a decision of its own: a five-minute idle timeout is in force, it is exempt for administrators and the test account, and it is now visible on the screen where it can be changed** |

---

## 11. Files

| File | Change |
| --- | --- |
| `packages/shared/src/appConfiguration.ts` | New — the registry, the coercers, the environment reader, `LANDING_PAGES` |
| `packages/shared/src/index.ts` | Exports the registry |
| `apps/api/src/services/appSettings.ts` | New — the snapshot, resolution, the validated write, the clear, the refresh |
| `apps/api/src/services/portalBoard.ts` | New — where a portal ticket lands, for both the portal and the configuration screen |
| `apps/api/src/routes/configuration.ts` | New — the configuration API and the portal overview |
| `apps/api/src/routes/system.ts` | `GET /deployment` added; the duplicated `/config/:key` handlers removed; `config:` keys refused |
| `apps/api/src/routes/auth.ts` | Landing page resolution and `PATCH /auth/me/landing-page` |
| `apps/api/src/middleware/sessionAuth.ts` | Idle timeout and session ceiling from settings; the admin exemption is a setting; the test-bypass account stays exempt unconditionally |
| `apps/api/src/routes/portal.ts`, `services/portalAuth.ts` | Limits, visibility, permissions and branding from settings; `GET /portal/branding` added |
| 12 further API files | Flag read sites converted (see §2.3) |
| `apps/api/prisma/schema.prisma` + one migration | `User.landingPage` |
| `apps/web/src/pages/Configuration.tsx` | New — the hub and the generated section editor |
| `apps/web/src/pages/CustomerPortalSettings.tsx` | New — the portal section, per-client access, sessions, preview |
| `apps/web/src/pages/SystemSettings.tsx` | Rewritten — operational state and deployment facts, nothing that does not work |
| `apps/web/src/pages/Settings.tsx` | Personal landing page; the idle timeout is administrative |
| `apps/web/src/lib/colourTokens.ts` | New — the colour literals a runtime accent needs, kept out of `.tsx` |
| `apps/web/src/components/Layout.tsx`, `App.tsx` | Navigation and routes; Quotes, Monitors, Alert Webhooks and AI Actions surfaced |
| `apps/web/src/pages/portal/*` | Branding and policy from the portal's own endpoints |
| `apps/web/src/pages/HelpDoc.tsx` | Configuration reference and walkthroughs updated |
| `apps/api/probe-configuration.mjs` | New — 78 assertions |
