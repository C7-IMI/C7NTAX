# PLAN-018 — Dependency & Application Security Remediation

> **Sequence:** Wave 0 — pre-deployment blocker, runs alongside PLAN-017 and ahead of every cloud step in PLAN-016
> **Status:** ✅ Phase 0 and Phase 1 complete, Phase 3 gated — 128 advisories down to 4 with none in the production closure, every application finding closed in code, and CI running the route-guard check, both typechecks, the dependency gate, gitleaks and trivy. The last item in this plan is the Azure deployment package (PLAN-016), which is the final deliverable of the current run.
> **Being closed now:** Phase 0 remainder → Phase 1 (dependency majors + audit baseline) → Phase 3 (CI gate), with a multi-role test-persona harness driving the verification. Completing W0 means the eight acceptance criteria in §6, not every item in Phase 2 — the structural items (H1–H6) are explicitly scheduled with PLAN-001/PLAN-016, and H1 lands here only because P0-5 depends on it, H5's middleware half because P0-2 depends on it, and H6 as part of H1.
> **Implemented:** Phase 0 items P0-1 … P0-11 and P0-13 below are applied; H1 (egress policy), H5's `middleware/companyScope.ts` half and H6 (egress log) are in as well. Still open: P0-12, the Phase 1 majors, and the Phase 3 CI gate.
> **Outstanding:** 11 application findings (2 critical, 4 high, 4 medium, 1 low) and 30 vulnerable dependency groups across four tiers, of which **1 critical and 16 high** are in code we actually ship.
> **Depends on:** nothing. Everything here can be fixed on `main` today.
> **Blocks:** PLAN-016 (the cloud split exposes the API to the internet for the first time), PLAN-007 (SOC 2 controls assume these are closed), PLAN-012 (the add-in widens the auth surface), PLAN-013 #3 (the customer portal puts client-facing accounts on these routes).
> **Next action:** execute Phase 0 (one-file fixes, ~1 day), then Phase 1 (dependency upgrades in a single PR).

---

## 1. How this was produced

| Step | What was done |
|---|---|
| 1 | **Inventory** — walked `pnpm-lock.yaml` (lockfile v9) to build the real dependency closure of each workspace, so advisories are counted only where the package is actually installed. |
| 2 | **Advisory data** — `pnpm audit --json` against the installed tree: **911 dependencies, 128 advisories** (2 critical, 61 high, 62 moderate, 10 low). |
| 3 | **Primary source** — every material CVE was re-read from `github.com/CVEProject/cvelistv5` record JSON (CWE, affected ranges, patch versions) rather than trusting the advisory summary. Exact URIs are in Appendix A. |
| 4 | **Reachability** — for each package, who pulls it in and whether the application calls the vulnerable function. An advisory in a package we never call (and never ship) is downgraded and says so. |
| 5 | **Independent code review** — a separate adversarial pass over the application code (injection, authz, secrets, XSS, SSRF, Electron), whose findings I then verified line-by-line in the source. Verification notes are recorded per finding. |

Two facts shape everything below: **the API is deployed as-is with production dependencies**, and **the Electron build ships the Electron runtime to user machines** — so a "devDependency" that is really the desktop runtime counts, while `vite`/`esbuild`/`electron-builder` chains count as build-machine risk only.

---

## 2. Part A — Application findings

Severity is rated on what an authenticated outsider (a client contact) or a low-privilege insider can actually achieve, not on the theoretical worst case.

| # | Sev | Location | Finding | Who can trigger it |
|---|---|---|---|---|
| A1 | 🔴 CRITICAL | `apps/api/src/routes/system.ts:8-9` (+ every route in the file) | Router is mounted with `authenticate` and **no** `requirePermission`. Any signed-in user can read and write every `SystemConfig` row. | Any account, including a client contact. |
| A2 | 🔴 CRITICAL | `apps/api/src/routes/clients.ts` (12 routes), `reports.ts` (all routes), plus `kb.ts`, `chat.ts`, `surveys.ts`, `workflows.ts`, `alerts.ts`, `aiActions.ts`, `bulk.ts`, `sso.ts` | `requirePermission` is imported but never applied, and there is no company scoping. Reads and writes cross every tenant boundary. | Any account, including a client contact. |
| A3 | 🔴 CRITICAL | `apps/api/src/routes/billing.ts:215-322` | The invoice "PDF" endpoint builds HTML by string interpolation (`p.method`, `p.reference`, line-item descriptions, company name) and returns it as `Content-Type: text/html` with no escaping. | Anyone who can put text into a time-entry description or a payment reference; executes in the browser of the admin/manager who opens the invoice. |
| A4 | 🟠 HIGH (latent) | `apps/api/src/routes/users.ts:287-345` | `PATCH /api/users/:id` needs only `UserManage` (which `manager` holds) but accepts `role` and a raw `permissions` array for **any** user, including the caller. | Anyone holding a role with `user:manage` but not `role:manage` promotes themselves to `super_admin`; effective immediately, because permissions are re-read per request. **Latent, not live**: no role in the shipped seed has that combination (only `Admin`, `Super Admin`, `Client Admin`, `Read Only`, `Technician`), so the trigger is a custom role — see §2 verification notes. |
| A5 | 🟠 HIGH | `apps/api/src/routes/inference.ts:60-92`, `services/inference/LlmProvider.ts:60-66` | No permission gate, and the admin-supplied `apiEndpoint` is fetched server-side with no host/scheme validation; an existing provider's `apiKey` is sent to it. **Closed** by P0-2 (gate) and P0-13/H1 (policy on save and at call time). | Any authenticated user sets `isDefault` on a provider pointing at an internal address or their own server, then causes a prompt. |
| A6 | 🟠 HIGH | `apps/api/src/routes/ssoExchange.ts:48, 63, 86, 100` | The OIDC `state` is generated and **never validated** on the callback, and JIT-provisioned users are created with the `admin` role (`findFirst({systemRole:"admin"})`); the token is handed over as `?token=` in a redirect. | Anyone the IdP will issue an ID token for with an unknown email — when `SSO_ENABLED` is on. |
| A7 | 🟠 HIGH | `apps/api/src/middleware/auth.ts:5`, `services/kumoCrypto.ts:8-16` | Hardcoded JWT fallback secret `"C7NTAX-dev-secret-change-in-prod"`, and the Kumo vault key is derived from `JWT_SECRET` (or that default) when `KUMO_MASTER_KEY` is unset. No startup assertion. | Anyone who reads the public repo, if the env var is ever missing in a deployment. |
| A8 | 🟡 MEDIUM | `apps/api/src/routes/alertWebhooks.ts:18-21`, `routes/bulk.ts:24-25` | `GET` lists `findMany()` the whole `WebhookConfig` including `secret`, with only `authenticate` (the POST/DELETE routes *are* gated). The `/bulk/webhooks` half of this is **dead code**: `/bulk/:id` is registered before it, so that path resolves to the bulk-item handler and returns 404 — the exposure is `alertWebhooks.ts` only. | Any authenticated user reads the HMAC signing secret of every webhook and forges deliveries. |
| A9 | 🟡 MEDIUM | `apps/api/src/middleware/auth.ts:56-58`, `index.ts:123`, `apps/web/src/pages/Billing.tsx:125` | JWTs are accepted from `?token=`, morgan logs the full URL, and the invoice page uses exactly that pattern — so a 12-hour token lands in logs, browser history and any proxy log. **Closed** by P0-12: header-only auth, the PDF fetched as a blob, and the SSO hand-off reduced to a single-use code. | Anyone with log or history access (or a shared support bundle). |
| A10 | 🟡 MEDIUM | `apps/api/src/routes/serviceAlerts.ts:25, 101-118`, `services/alertMonitor.ts:303-312` | A stored `monitorUrl` is fetched server-side with no allow-list; the HTTP status is reflected into the alert body. **Closed** by P0-13/H1: the four URL fields are validated on create/update, the ssl and dns monitors are checked too (they connect directly rather than via `fetch`), and every request goes through the helper. | An authenticated user holding `ServiceAlertManage`, from inside the VPC. |
| A11 | ⚪ LOW | `apps/api/src/routes/auth.ts:205-210` | The email-MFA code uses `Math.random()` and is compared with `!==` against the stored plaintext. | Weakens the second factor; only exploitable because the rate limiter is effectively off (A12). |
| A12 | 🟡 MEDIUM | `apps/api/src/index.ts:123`, `middleware/rateLimiter.ts` | Global limiter is `rateLimiter(9999, 60_000)` — i.e. off — and it is per-process in-memory. `/auth/login` has no specific limit; `loginAttempts`/`isLocked` exist in the schema and UI but **nothing increments or enforces them**. | Unlimited offline-speed credential stuffing, and the "Account Locked" UI is currently decorative. |
| A13 | 🟡 MEDIUM | `middleware/auth.ts:96-101, 133-137` | `authenticate` fails **open**: if the DB lookup throws it proceeds on the JWT's stale permissions. | Attacker who can induce/await a DB hiccup keeps privileges that were revoked. |

### Verification notes

- **A1/A2 confirmed by reading the routers**: `systemRouter.use(authenticate)` with zero `requirePermission` calls; `clients.ts` has 12 routes and no guard; `reports.ts` zero occurrences of `requirePermission`. `tickets/index.ts` **does** enforce `TicketViewAll`/`companyId` — so the fix is to copy a pattern that already exists, not to invent one.
- **A3 confirmed**: `billing.ts:236-322` interpolates `${p.method}`, `${p.reference}` and the line-item description into a template string and does `res.setHeader("Content-Type","text/html"); res.send(html)`. `escapeHtml` already exists in `services/emailHtml.ts` — the fix is to use it. Impact depends on whether the SPA shares the API origin: in dev it does (the Vite proxy serves both at :3010), and the planned single-hostname deployment (PLAN-016 Front Door → App Gateway) also does, which is what makes the JWT in `localStorage` reachable.
- **A4 confirmed** — this is code added in the previous change (the user administration work); the guard belongs in that route.
- **A6 confirmed**: `state` is destructured in the callback and never compared; the JIT path assigns the admin role; `role ?? "admin"` also defaults the token's role claim.
- **A9 confirmed**: `authenticate` reads `req.query.token`, and `Billing.tsx:125` builds `…/pdf?token=${token}`.
- **A12 confirmed**: `loginAttempts` appears only in `routes/users.ts` (manual lock/unlock and the reset endpoint). Nothing in `auth.ts` counts failed logins.
- **A5/A10 confirmed by grep** on `requirePermission` presence/absence in those routers.
- **A4 confirmed, then re-rated**: the guard was missing, but the escalation needs a role holding `user:manage` without `role:manage`. Querying the seeded roles (only `Admin`, `Super Admin`, `Client Admin`, `Read Only`, `Technician`) and their permission arrays shows no such role, so this is latent until someone creates a custom role. It is fixed anyway, because the fix is three lines and the latent path is one role away.
- **A8 correction**: `/bulk/webhooks` is unreachable (`/bulk/:id` is registered first), so the MEDIUM exposure is `alertWebhooks.ts` alone. Both files are fixed; the bulk half is now correct-but-dead.

### Checked and clean (worth not re-litigating later)

- **No SQL injection**: every `$queryRawUnsafe` call site is parameterized (`$1/$2`) or static.
- **No command injection**: `execSync`/`exec` call sites interpolate only `path.join(__dirname, …)` constants.
- **Attachment downloads are safe**: the resolved path is checked with `path.relative` against the storage root; filenames are sanitized.
- **Server-side HTML sanitization is real**: `sanitizeEmailHtml` is an allow-list parser (drops `script/style/iframe/svg/template` with content, drops `on*`/`style`/`srcdoc`, rejects `javascript:`/`expression`/`url(`/`@import`, allow-lists tags and attributes) and it is applied on every checklist rich-text write. Ticket notes render as escaped text; there is no `dangerouslySetInnerHTML` in the web app.
- **Electron is hardened**: `contextIsolation: true`, `nodeIntegration: false`, sandboxed preload with a narrow bridge, `setWindowOpenHandler` denies all windows.
- **Crypto is sane**: AES-256-GCM with a fresh IV and auth tag per record; bcrypt cost 12; constant-time `bcrypt.compare`; connector OAuth callback validates single-use state.
- **CORS/helmet** are correctly configured (single origin, credentials, helmet defaults).

---

## 3. Part B — Dependency CVEs

Filtered to advisories whose **installed version falls inside the vulnerable range**, grouped by where the package is actually reachable. Unfiltered, `pnpm audit` reports 128 advisory instances; 26 survive the reachability check.

### Tier A — production API runtime (ships in the server)

| Sev | Package | Installed | Fixed | CVEs | Reachability verdict |
|---|---|---|---|---|---|
| 🔴 CRITICAL | `proxy-addr` | 2.0.7 | ≥2.0.8 | CVE-2026-90711 | **Not exploitable today** — `trust proxy` is not set, so Express uses the socket address. It becomes exploitable the moment the planned reverse-proxy deployment sets a trust subnet in `::ffff:a.b.c.d/8` notation. Upgrade before PLAN-016. (CWE-290/348/697) |
| 🟠 HIGH | `nodemailer` | 6.10.1 | ≥10.0.6 for all 15 | CVE-2025-14874, CVE-2026-82659, CVE-2026-82662, +11 GHSA | **Reachable**: the app sends mail to addresses that originate in inbound email (the connector's replies and follow-ups). CVE-2025-14874 (address-parser infinite recursion) turns a crafted `From:` into a hung/crashed worker. CVE-2026-82659 (`raw` option bypass) is *not* reachable — `EmailService` never uses `raw`. |
| 🟠 HIGH | `axios` | 1.19.0 | ≥1.20.0 | CVE-2026-101898…101909 (12) | Partially reachable: the prototype-pollution/`fetchOptions` issues concern the **fetch adapter**; the API uses the http adapter and the browser uses XHR. Upgrade regardless — the affected range is `>=1.7.0 <1.20.0`. (CWE-1321) |
| 🟠 HIGH | `brace-expansion` | 2.1.4 | ≥2.1.7 | CVE-2026-102276/77/78 | Reachable through the `minimatch`/`glob` chain in the API's own tree. Quadratic expansion of `{a},b}}}`-shaped input. (CWE-400/407) |
| 🟠 HIGH | `semver` | 5.3.0 (via `imap` → `utf7`) | ≥5.7.2 | CVE-2022-25883 | Reachable in principle: the `imap` package pulls a legacy `semver`, and the input is server-supplied protocol text. |
| 🟠 HIGH | `deepmerge-ts` | 7.1.5 | ≥8.0.0 | CVE-2026-40345 | Reachable only through `mjml` (see below). (CWE-674) |
| 🟠 HIGH | `html-minifier` | 4.0.0 | **none published** | CVE-2022-37620 | Only via `mjml`, which **the code never calls** (a comment says "production should use MJML"). Accepted-risk candidate — better: remove `mjml`. |
| 🟠 HIGH | `node-forge` | 1.4.0 | **none published** | CVE-2026-85393 | **Not used anywhere** in `packages/integrations` (grep: zero references). Dead dependency carrying a signature-forgery CVE — remove it. |
| 🟠 HIGH | `braces` | 3.0.3 | **none published** | CVE-2026-93687 | Stack exhaustion via nested brace patterns; reachable only through glob-style dev tooling. Accepted-risk with a note. |
| 🟡 MEDIUM | `qs` | 6.15.3 | ≥6.16.0 | CVE-2026-82562, CVE-2026-82417 | Directly reachable — Express query parsing. `arrayLimit` bypass with `comma:true` (CWE-770). |
| 🟡 MEDIUM | `morgan` | 1.11.0 | ≥1.12.0 | CVE-2026-15603, CVE-2026-87859 | Directly reachable: log forging via U+0085/U+2028/U+2029 in a header written into the log file (CWE-117). Pairs with A9. |
| 🟡 MEDIUM | `uuid` | 9.0.1 | ≥11.1.1 | CVE-2026-41907 | **Not reachable**: only `v4()`/`randomUUID()` are used; the bug needs v3/v5/v6 with a caller-supplied buffer. Bump anyway. |
| 🟡 MEDIUM | `mjml` | 4.18.0 | ≥5.0.0-alpha.9 | CVE-2025-67898 | Unused: `mj-include` directory traversal needs the app to compile attacker-influenced MJML, which it never does. Remove the dependency and the whole `html-minifier`/`deepmerge-ts` branch disappears. |

### Tier B — browser bundle (ships to users' browsers)

| Sev | Package | Installed | Fixed | CVEs | Verdict |
|---|---|---|---|---|---|
| 🟠 HIGH | `axios` | 1.19.0 | ≥1.20.0 | as above | Shipped in the bundle; upgrade is the same PR as Tier A. |
| 🟡 MEDIUM | `react-router-dom` | 6.30.4 | ≥6.30.6 | CVE-2026-53668 | Reachable **if** the app permits an open redirect; audit the `?redirect=`/`navigate(searchParams)` paths. (CWE-601/79) |
| ⚪ LOW | `dompurify` | 3.4.13 | ≥3.4.16 | GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2 | Declared but **never imported**. The `IN_PLACE` hook bypass doesn't apply to `sanitize()`, and the server already sanitizes on write. See H4 — we want DOMPurify *in* the render path, upgraded. |

### Tier C — desktop runtime (ships inside the installer)

| Sev | Package | Installed | Fixed | Notes |
|---|---|---|---|---|
| 🟠 HIGH | `electron` | **33.4.11** | 35.7.5 minimum; current line for all 38 advisories | The desktop app bundles this runtime and packages the remote web UI. Worst case is CVE-2025-55305 (ASAR integrity bypass, CWE-94/829) plus 10 more high-severity use-after-free / isolation-bypass issues. The build config pins `electronVersion=33.4.11` in `apps/desktop/package.json`, so both the devDependency and that pin must move together. |

### Tier D — build/CI machine only (not shipped)

| Sev | Package | Installed | Fixed | Notes |
|---|---|---|---|---|
| 🟠 HIGH | `extract-zip`, `http-cache-semantics`, `sprintf-js`, `@xmldom/xmldom`, `js-yaml`, `source-map-js`, `brace-expansion`, `braces` | see audit | mixed, some **no fix** | All arrive through `electron-builder`/`vite`/`postcss` on the build machine (the GitHub Windows runner). Fixed by the `electron-builder` 24.13.3 → 26.x bump (which also clears `app-builder-lib` CVE-2026-54672 and `builder-util-runtime` CVE-2026-54673). |
| 🟡 MEDIUM | `vite` | 5.4.21 | ≥6.4.3 | CVE-2026-53571 is a `server.fs.deny` bypass **on Windows** — dev-server only, so its real relevance is that `startup/c7ntax-boot.ps1` starts Vite with `--host`, i.e. it listens on the LAN. Fix both: upgrade and stop binding to all interfaces by default. |
| 🟡 MEDIUM | `esbuild` (via vite) | 0.21.5 | ≥0.25.0 | Dev-server request forgery; same reasoning as Vite. |
| 🟡 MEDIUM | `postcss-selector-parser` | 6.1.4 | ≥7.1.6 | Build-time quadratic parsing. |

---

## 4. Part C — Implementation plan

### Phase 0 — application hotfixes (do first: one file each, no dependency churn)

| # | Change | File | Acceptance |
|---|---|---|---|
| P0-1 | Add `systemRouter.use(requirePermission(Permission.SystemConfig))` and reject writes to reserved keys (`email_connector:*`, `oauth`, sample-data flags) from this router. | `apps/api/src/routes/system.ts` | A technician and a client user both get 403 on `GET /api/system/configs`; the connector's OAuth flow still works (it writes via the service, not this route). |
| P0-2 | Apply the permission each route was designed for (`ClientView/Create/Edit/Delete`, `ReportView`, `KB*`, `Workflow*`, `Survey*`, `Chat*`, `SystemConfig` for SSO) and add the company scope used in `tickets/index.ts` to every company-scoped read in `clients.ts`, `reports.ts`, `kb.ts`, `chat.ts`, `surveys.ts`, `workflows.ts`, `alerts.ts`, `aiActions.ts`, `bulk.ts`. Add a regression test that walks the Express router stack and fails on any route with `authenticate` but no permission guard. | the routers above + `apps/api/src/routes/__tests__/routeGuards.test.ts` (new) | The test enumerates every mounted route and asserts a guard; a client user gets 403/empty on another company's data. |
| P0-3 | HTML-escape every interpolated value in the invoice template with the existing `escapeHtml` from `services/emailHtml.ts`; keep the route, change nothing else. | `apps/api/src/routes/billing.ts:215-322` | A line item containing `<img src=x onerror=alert(1)>` renders as literal text. |
| P0-4 | Require `RoleManage` for `role`/`roleId`/`permissions` changes, forbid changing your own role or permissions, and refuse granting a role the caller does not hold. | `apps/api/src/routes/users.ts:287-345` | A manager gets 403 promoting anyone (including themselves); an admin can still change roles. |
| P0-5 | Gate the inference router (`InferenceManage`/`IntegrationManage`) and validate `apiEndpoint` (https only, no loopback/RFC1918/link-local/metadata addresses) on create and update. | `apps/api/src/routes/inference.ts` | A provider pointing at `169.254.169.254` or `http://localhost:5432` is rejected with a readable message. |
| P0-6 | Store the OIDC `state` (signed cookie or `SystemConfig`) and compare it on callback; provision unknown identities **inactive** with a read-only role and require an admin to enable them; stop putting the token in a redirect query string. | `apps/api/src/routes/ssoExchange.ts`, `apps/web/src/pages/Login.tsx` | A callback with a wrong/absent `state` is rejected; a new SSO identity lands as inactive/`read_only`; `?token=` is gone. |
| P0-7 | Fail closed in `authenticate` (DB error → 401, not stale permissions), and assert at boot that `JWT_SECRET` is set and not the public default, and that `KUMO_MASTER_KEY` is set. | `apps/api/src/middleware/auth.ts`, `apps/api/src/index.ts` | Starting with the default secret throws with a clear message; a simulated DB error returns 401. |
| P0-8 | Stop returning `secret` from the webhook list endpoints; require `SystemConfig` to read them at all. | `routes/alertWebhooks.ts`, `routes/bulk.ts` | The list response contains no `secret`. |
| P0-9 | Use `crypto.randomInt` for the email-MFA code and compare with `timingSafeEqual`. | `apps/api/src/routes/auth.ts` | Code generation uses the CSPRNG. |
| P0-10 | Enforce lockout: increment `loginAttempts` on a bad password, lock at N (5) for M minutes, reset on success, and surface it in `/auth/login` as "account locked". | `apps/api/src/routes/auth.ts` | Five bad attempts locks the account; the existing Security-tab "Account Locked" state becomes real. |
| P0-11 | Rate limit per endpoint: strict limiter on `/auth/login`, `/auth/mfa/*`, `/auth/webauthn/*`, `/users/:id/reset-password` (e.g. 10/15 min per IP **and** per account). Keep the global limiter but drop it to something real (e.g. 600/min). | `apps/api/src/index.ts`, `middleware/rateLimiter.ts` | 11 rapid login attempts return 429 with `Retry-After`. |
| P0-12 | Replace `?token=` auth on the invoice PDF with an authenticated fetch (the SPA already holds the JWT) or a short-lived signed URL; stop morgan logging query strings for `/api/billing/*`. | `routes/billing.ts`, `apps/web/src/pages/Billing.tsx`, `index.ts` | No JWT appears in any log line or URL. |
| P0-13 | One outbound-request helper (`services/egress.ts`) with a scheme/host policy, per-hop redirect validation and a timeout, used by every fetcher the server owns; validate the URL on save as well, and never write a credential into an audit row. | `services/egress.ts` (new), `services/inference/LlmProvider.ts`, `services/alertMonitor.ts`, `routes/ssoExchange.ts`, `routes/inference.ts`, `routes/serviceAlerts.ts`, `middleware/auditLog.ts` | A provider endpoint or monitor URL pointing at `169.254.169.254`, `localhost:5432` or an RFC1918 address is refused with a readable message on save and again before the request; a public redirect is followed, a redirect into a private range is not; `apiKey`/`token`/`secret` values are `***` in the audit row. |

#### Phase 0 — status after the first pass (2026-10-06)

Everything below was applied, typechecked, and probed live. `◐` means the dangerous half is closed and the remainder needs a decision or a wider change.

| Item | Status | What shipped | What is still open |
|---|---|---|---|
| P0-1 | ✅ | `GET /system/configs` now requires `SystemConfig` and leaves the service-owned rows out of the response altogether; `PATCH /config/:key` and `GET /config/:key` share **one** policy (`assertConfigAccess`) that refuses reserved prefixes (`email_connector:`, `oauth`, `sso:`, `sample_data`) and any key matching `/secret\|token\|password\|credential\|apikey\|private_?key/i` to everyone, and lets a non-administrator read or write only the three self-service keys. The read side was the missing half and it mattered: the SSO callback parks its hand-off row here — the single-use code *and* the signing-in user's whole token — so an ungated read let any signed-in account poll it and take the token without ever calling the exchange that exists to consume that code. | Closed 2026-10-07 (see Appendix C). No decision left open: the self-service keys stay readable by every signed-in account because three screens depend on them, and everything else is administrative. |
| P0-2 | ✅ | 101 new guards across 13 routers (265 total, from 164) mapping every route to the permission it was designed for, including four the audit had missed (asset inventory, time off, the Outlook add-in) and the `/system` admin routes; the SPA nav declares the permission each page needs and filters against the role's set; a denied action surfaces the API message as a toast. `scripts/check-route-guards.mjs` (`pnpm guard:routes`) walks the router stack and reports **322 routes, 293 guarded, 0 violations** with a documented exemption list. | Three SPA-required `/system` reads stay open by decision (`config/:key`, `changelog`, `audit-logs`) — see P0-1. |
| P0-3 | ✅ | `escapeHtml` (pre-existing, in `services/emailHtml.ts`) exported and applied to every interpolated value in the invoice template: line-item descriptions, payment method/reference, invoice number, company name/email, currency, status, status label. | — |
| P0-4 | ◐ | `RoleManage` required for `role`/`roleId`/`permissions` changes; changing your **own** role or permissions (including self-deactivation) is refused; creating or updating a user into an administrative role (one carrying `role:manage` or `system:config`) requires `RoleManage`; `roleId` accepted as an identifier. | No "grant ceiling" (a `RoleManage` holder can still hand out permissions they do not hold). That is intentional for now — `Admin` needs it. |
| P0-5 | ✅ | The inference router is gated (`InferenceManage`), and `apiEndpoint` is validated on create **and** update against the egress policy: https only, no loopback, no RFC1918, no link-local/metadata, resolved addresses checked, redirects re-validated hop by hop. `LlmProvider` fetches through the same helper, so a stored endpoint that was bad before the policy existed is refused at call time and falls back to the keyword layer. | A local model server (Ollama over http on loopback) needs the documented `EGRESS_ALLOW_PRIVATE=true` development opt-in. |
| P0-6 | ◐ | OIDC `state` persisted in `SystemConfig` (`sso:oidc_state`) on start and validated single-use with a 10-minute TTL on callback; unknown identities provisioned **inactive + `read_only`** and refused with 403 instead of being made admin; the token's role claim no longer defaults to `admin`; the token no longer travels in the redirect — a single-use two-minute code does (P0-12). | — |
| P0-7 | ◐ | `authenticate` fails closed — a DB error or unexpected failure returns `{valid:false}` → 401. Boot asserts `JWT_SECRET` is set and is not the public fallback (throws in production) and warns when `KUMO_MASTER_KEY` is unset. | Hard-failing on a missing `KUMO_MASTER_KEY` would brick existing dev vaults; it warns instead. Decide when the key rotation story lands. |
| P0-8 | ✅ | Alert-webhook listing requires `SystemConfig` and strips `secret`; the bulk-webhook trio is gated the same way (and is dead code — see A8). | — |
| P0-9 | ✅ | Email-MFA codes use `crypto.randomInt` and are compared with `timingSafeEqual`. | — |
| P0-10 | ◐ | Lockout implemented: `MAX_LOGIN_ATTEMPTS = 5`, 423 while locked, reset on success — behind `AUTH_HARDENING_ENABLED`. | Defaults to **off** so the existing "locked" UI state and support flows are not changed unannounced. Flip it on deliberately. |
| P0-11 | ◐ | `credentialLimiter` (300/15 min per IP, configurable) on `/auth/login`, `/auth/mfa/verify`, `/auth/mfa/verify-email`, `/auth/send-mfa-email`, `/auth/change-password`. | Per-**account** throttling and a shared store need Redis (H2); the global limiter is untouched. |
| P0-12 | ✅ | The invoice PDF is fetched with the `Authorization` header and opened from an object URL (the tab is opened synchronously first, because a popup raised after an `await` is blocked, with a file download as the fallback); `authenticate` no longer accepts a token from the query string at all; the SSO redirect carries a single-use two-minute code that `/auth/sso/exchange` swaps for the token in a POST body. | The WebSocket handshake still takes its token from the query string (`ws.ts`) — browsers cannot set an `Authorization` header on a `WebSocket`, so this is the documented exception; the access log does not record upgrades. |
| P0-13 | ✅ | `services/egress.ts` is the one outbound-request helper: http(s) only, https for anything public, literal private/loopback/link-local addresses refused before any request, every resolved address checked so a public name cannot resolve inward, redirects followed one hop at a time with the policy re-applied to each target (max 3), a timeout on every call, and one log line per attempt with its outcome. Applied to the inference provider call, the four alert-monitor sources (RSS, Statuspage, DownDetector reader, website/ssl/dns monitors) and the SSO discovery/JWKS/token calls; the inference and alert-service routes validate the URL on save so a bad value never reaches the database. Found while doing it: `apiKey` was written verbatim into the audit row for a provider change, so the audit-log redaction now matches secret-**looking** keys (`apiKey`, `accessToken`, `refresh_token`, `webhookSecret`, `smtp_password`, …) case- and separator-insensitively while still recording lookalikes such as `tokenVersion`. | webhook delivery and the integration adapters still use their own transports and should move onto the helper when they are next touched (no `fetch` remains in the API outside the self-check poller). |

**Phase 1 — status**: ✅ **Complete** (2026-10-06/07). `mjml` and `node-forge` removed (−198 packages); `morgan` → 1.12.1, `axios` → 1.20.0, `dompurify` → 3.4.16; `nodemailer` 6 → **10** (and `mailparser` 3.9.36, whose own nodemailer 9 copy still carried eight advisories), `uuid` 9 → **11**, `vite` 5 → **8** with `@vitejs/plugin-react` 6 (the dev server also stopped binding to the LAN), `react-router-dom` 6 → **7**, `electron` 33 → **44**, `electron-builder` 24 → **26**, `turbo` 1 → **2**; `pnpm.overrides` pin `proxy-addr`, `brace-expansion`, `semver`, `qs`, `dompurify`, `@xmldom/xmldom`, `js-yaml`, `source-map-js`, `tar`, `app-builder-lib` and `builder-util-runtime`. **Advisory instances 128 → 4, with none in the production closure** (was 21); critical 2 → 0; high 61 → 2. The four remaining are accepted in `security/audit-baseline.json` with reasons: `braces`, `http-cache-semantics` and `sprintf-js` have no published fix and reach the build machine only, and `postcss-selector-parser` is pinned to 6.x by Tailwind 3 (revisit with Tailwind 4).

**Two findings from this pass that the plan did not know about.** First, the overrides in the root `package.json` were being **ignored for transitive resolutions** because the file also carried a legacy `workspaces` field next to `pnpm-workspace.yaml` (pnpm 9 then stops reading the `pnpm` field); removing it is what actually cleared the last build-tool advisories, and it means the earlier pass's overrides were only partly in effect. Second, `electron-builder` 26 still resolves a stale `electron-builder-squirrel-windows@24.13.3` — an unused target path that dragged in an old `app-builder-lib`, `builder-util-runtime` and `tar` 6 — which is why the tar critical survived the `electron-builder` bump and needed explicit overrides.

**Phase 3 — status**: ✅ **Applied** as `.github/workflows/security.yml` — `guard:routes`, both typechecks, `guard:deps` (the audit baseline), gitleaks and a trivy filesystem scan on every push and PR to `main`. `security/README.md` documents the rules, the commands and the accepted risks. Still to do in the repo settings rather than in code: the grouped dependency-update PRs (Renovate or Dependabot) and the quarterly `cvelistv5` review.

**Verification used for this pass**: `probe-user-admin.mjs` 63/63 and `probe-auth-smoke.mjs` 15/15 (no regression from the role and auth changes), a purpose-built security probe (config dump 403 for a technician / 200 for an admin, reserved and secret-looking keys refused, self-service keys still writable, webhook list 403 and secret-free, self-promotion and role-granting refused while ordinary profile edits and technician creation still work, login still 401s on a bad password), and an invoice probe that seeds a hostile invoice and asserts the HTML is escaped while the real content still renders (8/8). Typecheck: web 0 errors, API 155 errors = the pre-existing baseline.

**Verification added by the W0 run (2026-10-06/07)**: a six-persona sweep (`probe-permissions.mjs`, 40 endpoints × 5 roles plus writes) diffed against a stored baseline after every step — the only differences across steps A–E are the intended ones; a 13-assertion scoping suite (`probe-scoping.mjs`) per criterion 2; the route-guard check per criterion 2; and a 21-assertion egress suite (`probe-egress.mjs`) that drives the live API — a blocked endpoint or monitor URL is refused on save with a readable message, a refused update leaves the stored value untouched, a legitimate https endpoint is still accepted, the audit row shows `***` instead of the key, and the alert monitor still resolves all 14 configured services (which is how the redirect rule was caught breaking the Google Workspace feed). `pnpm guard:routes`: 322 routes, 0 violations.

### Phase 1 — dependency upgrades (one PR, one audit baseline)

1. **Remove dead dependencies** — `node-forge` (integrations), `mjml` (email; it removes `html-minifier` and `deepmerge-ts` with it). This alone clears 3 of the 16 high findings without a version bump.
2. **Direct upgrades** (bump the manifest, not an override):
   - `nodemailer` → `^10.0.6` (**major: verify `EmailService.send` and the connector's reply paths**; the `createTransport`/`sendMail` shape is stable but 6→10 spans breaking changes)
   - `axios` → `^1.20.0` (web + integrations)
   - `morgan` → `^1.12.0`, `uuid` → latest fixed line (`v4`-only usage, so the API change is limited to the import path), `react-router-dom` → `^6.30.6`, `dompurify` → `^3.4.16` (and start actually using it — H4)
   - `vite` → `^6.4.3` (or 7.x) and with it `esbuild` ≥0.25
   - `electron` → latest stable **and** `apps/desktop/package.json`'s `build.electronVersion` pin; `electron-builder` → `^26.15.0`
3. **Transitive pins** via root `pnpm.overrides` where the parent cannot move: `brace-expansion` ≥2.1.7, `semver` ≥5.7.2 (the `imap`→`utf7` copy), `source-map-js` ≥1.2.2, `postcss-selector-parser` ≥7.1.6, `qs` ≥6.16.0, `js-yaml` ≥4.3.2, `@xmldom/xmldom` ≥0.9.12, `tar` ≥7.5.21, and check `proxy-addr` ≥2.0.8 (Express may pin it below that — if so an override is the only route until Express ships it).
4. **Accepted risks, recorded here on purpose** (no upstream fix): `html-minifier` CVE-2022-37620 → removed with `mjml`; `node-forge` CVE-2026-85393 → removed; `braces` CVE-2026-93687 → glob/dev tooling only, tracked; `extract-zip` CVE-2026-19693/CVE-2026-56876 and `http-cache-semantics` CVE-xxxx → build-machine only via `electron-builder`, re-checked at each upgrade.
5. **Freeze a baseline** — commit `security/audit-baseline.json` (the filtered output of step 3 of §1) and a `security/README.md` explaining that `pnpm audit --audit-level=high` must show no *unaccepted* findings in Tier A/B/C.

**Verification for Phase 1:** re-run `pnpm audit --json` and diff against the baseline (expect ≤ the accepted-risk set); re-run the connector probe suites (69 checks) and the user-admin probe suite (63 checks) because `nodemailer`/`axios`/`express` are all in those paths; rebuild the desktop installer from the new Electron and launch it; open the invoice PDF; browser walkthrough of login + MFA + a ticket note; typecheck all workspaces.

### Phase 2 — structural hardening (schedule with PLAN-001/PLAN-016)

| # | Item | Why |
|---|---|---|
| H1 | ✅ **Applied** for the fetchers the server owns: `services/egress.ts` (P0-13) — scheme/host policy, every resolved address checked, each redirect hop re-validated rather than blanket-refused (refusing them broke the Google Workspace status feed, which answers 301), a timeout on every call, and the policy applied on save as well as before the request. | Closes A5/A10 and the connector/integration variants at the root instead of per-route. Webhook delivery and the integration adapters still use their own clients; move them onto the helper as they are touched. |
| H2 | **Durable, shared rate limiting and lockout** (Redis — `ioredis` is already a dependency and `REDIS_URL` is configured) instead of per-process maps. | A12; also survives a multi-replica deployment. |
| H3 | **Session cookies instead of `localStorage`** — the `sessionAuth` middleware and `c_session` cookie already exist but are unmounted (PLAN-001). HttpOnly + Secure + SameSite removes the "any XSS = takeover" property that makes A3 severe. | A3/A9. |
| H4 | **Sanitize at render too** (`DOMPurify.sanitize` in the rich-text render path, upgraded), keeping the server sanitizer as the primary control. | Defence in depth for the one `innerHTML` sink; also handles HTML written before the sanitizer existed. |
| H5 | **Company scoping as middleware**, not per-route discipline: a helper that every company-scoped query must pass through, plus the route-guard test from P0-2 extended to assert scoping. | A2's root cause is "each route remembers or doesn't". |
| H5 | ◐ **Applied, not yet universal**: `middleware/companyScope.ts` (`isUnscoped`, `companyWhere`, `ticketCompanyWhere`, `canAccessCompany`) is in use across clients/contacts, billing, the eight reporting endpoints, and — from the 2026-10-07 audit round — **projects, quotes, inventory assets, schedule, the knowledge base and the Outlook add-in**, following the `tickets/index.ts` convention (no company on the account = internal = unrestricted; a company = scoped; single records answer 404 not 403). Writes that name a company check it too, so `companyId` in a request body is a request rather than an authority. | Extend it to the remaining company-scoped modules as they are touched (procurement, contracts, checklists, surveys, CRM opportunities), and add the scoping assertions to the route-guard check so a new route cannot forget. The assertions for the modules fixed in this round live in `probe-scoping.mjs`, which is the pattern to copy. |
| H6 | **Egress audit log** — record every outbound URL the server fetches (with result) so SSRF attempts are visible. | SOC 2 + incident response. |
| H6 | ✅ **Applied with H1**: the helper logs one line per attempt (`allowed … request to host`, then `-> status in Xms`, `redirected to …`, or the failure), so an SSRF attempt is visible in the log with the URL, the purpose and the outcome. | Consider promoting these lines from the log into a queryable audit row during the SOC 2 work. |

### Phase 3 — process (pairs with the CI/CD work)

1. `ci.yml` gate: `pnpm audit --audit-level=high --prod` plus the Tier A/B/C filter from the baseline, failing the build on a *new* unaccepted advisory.
2. `gitleaks` (secret scanning) and `trivy` (config/CVE) as real jobs — `startup/security-scanners.ps1` already implements this logic locally and self-skips when the tools are absent.
3. Renovate or Dependabot with grouped PRs (patch/minor weekly, majors manually) — the `electron`/`nodemailer` majors here are exactly the kind of update that never happens without a bot.
4. A quarterly review against `CVEProject/cvelistv5` for the packages in the baseline, recorded as a dated entry in this document's Appendix A.
5. Extend the route-guard test to run in CI so Phase 0's fix cannot silently regress.

---

## 5. Rollback

Every Phase 0 item is an independent, single-file edit — revert the file. Phase 1 is a lockfile change: `git revert` the PR and `pnpm install --frozen-lockfile`, then redeploy the previous image. The dependency work is deliberately ordered so the removals (step 1, no runtime effect) can ship even if a major upgrade has to be backed out.

## 6. Acceptance criteria

1. `pnpm audit` shows no critical/high advisory inside the Tier A, Tier B or Tier C closures except those listed as accepted in §4 Phase 1 step 4.
2. A client-scoped user receives 403 (or an empty, correctly scoped result) on every cross-company route; the new route-guard test passes in CI.
3. No JWT is accepted from a query string; no JWT appears in any log.
4. The invoice PDF renders hostile input as text.
5. Only an admin can grant `SuperAdmin`/`Admin`, and nobody can raise their own role.
6. Failed logins lock the account, and `/auth/login` rate-limits.
7. The desktop installer is built from an Electron release with no outstanding high-severity advisories.
8. `security/audit-baseline.json` exists, is regenerated by a documented command, and is referenced by the CI gate.

---

## Appendix A — CVE records consulted (primary source)

Fetched from `https://raw.githubusercontent.com/CVEProject/cvelistv5/main/cves/<year>/<bucket>/<CVE>.json`, where `<bucket>` is the CVE number with the last three digits replaced by `xxx`.

| CVE | Package | CWE (as published) | Affected (as published) | Fixed |
|---|---|---|---|---|
| CVE-2026-90711 | proxy-addr | CWE-290, CWE-348, CWE-697 | `1.1.0 < 2.0.8` | 2.0.8 |
| CVE-2026-101908 | axios | CWE-1321 | `>=1.7.0 <1.20.0` | 1.20.0 |
| CVE-2025-14874 | nodemailer | Improper Check/Handling of Exceptional Conditions | `<7.0.11` | 7.0.11 |
| CVE-2026-82659 | nodemailer | External Control of File Name or Path | `<9.0.1` | 9.0.1 |
| CVE-2026-82562 | qs | CWE-770 | `6.14.2 <6.16.0` | 6.16.0 |
| CVE-2026-15603 | morgan | CWE-117 | `<1.12.0` | 1.12.0 |
| CVE-2026-102277 | brace-expansion | CWE-400, CWE-407 | `>=2.0.0 <2.1.7` (also `<1.1.21`, `>=3.0.0 <3.0.9`, `>=4.0.0 <5.0.12`) | 2.1.7 |
| CVE-2026-40345 | deepmerge-ts | CWE-674 | `<8.0.0` | 8.0.0 |
| CVE-2026-41907 | uuid | CWE-823, CWE-787 | `<14.0.0` | 14.0.0 |
| CVE-2026-53668 | react-router | CWE-601, CWE-79 | `>=6.30.2 <=6.30.4` | 6.30.6 |
| CVE-2026-53571 | vite | CWE-22, CWE-200 | `<6.4.3` (also 7.x/8.x lines) | 6.4.3 |
| CVE-2026-59873 | tar | CWE-770 | `<7.5.19` | 7.5.19 |
| CVE-2026-83607 | @xmldom/xmldom | CWE-91 | `>=0.9.0 <0.9.11` | 0.9.11 |
| CVE-2026-85393 | node-forge | Improper Verification of Cryptographic Signature | `through 1.4.0` | none published |
| CVE-2022-25883 | semver | ReDoS | `<7.5.2` (5.x line fixed at 5.7.2) | 5.7.2 |
| CVE-2022-37620 | html-minifier | ReDoS | 4.0.0 | none published |
| CVE-2025-55305 | electron | CWE-94, CWE-829 | `<35.7.5` (+ 36.x/37.x/38.x ranges) | 35.7.5 |

## Appendix B — reproducible commands

```powershell
# 1. advisory data for the installed tree
pnpm audit --json > $env:TEMP\audit-full.json

# 2. per-workspace closure + vulnerable-range filter (script kept out of the repo; see §1 step 1)
#    walks pnpm-lock.yaml snapshots, then semver.satisfies(installed, advisory.vulnerable_versions)

# 3. one-off CVE record lookup
#    https://raw.githubusercontent.com/CVEProject/cvelistv5/main/cves/2026/<bucket>/CVE-2026-90711.json

# 4. current effective posture
pnpm why <package> -r --depth 3
```

## Appendix C — audit round 2026-10-07

A repository-wide audit (functional *and* security) followed by a fresh run against the advisory
database. What was found, what was fixed, and what is deliberately left:

### Dependency advisory re-run

`pnpm audit` reports **4 advisories, 0 in production**, all four already accepted in
`security/audit-baseline.json` with reasons:

| Package | Severity | Reachable through | Fixed in | State |
|---|---|---|---|---|
| `braces` | high | Tailwind's file watcher (`chokidar`, `fast-glob`) on the development machine | no release published | accepted — dev only, parses our own source |
| `http-cache-semantics` | high | `@electron/get` on the build machine while downloading Electron | no release published | accepted — never runs in the shipped product |
| `sprintf-js` | moderate | `global-agent` → `roarr` → `@electron/get` (`argparse` also pulls it) | no release published (package abandoned) | accepted — build machine only |
| `postcss-selector-parser` | moderate | Tailwind 3's 6.x line | 7.1.6 | accepted — 7.x is a breaking API change; revisit with the Tailwind 4 upgrade |

There is nothing left to upgrade safely: the two with a published fix are reachable only by moving a
dependency across a **major** version (Tailwind 4, Electron 35+), which is exactly the kind of change
this document's ordering reserves for its own PR. Everything a patch or minor bump could fix has
already been fixed by the overrides.

**The overrides were one toolchain away from being silently ignored.** `packageManager` pins pnpm
9.1.0, which reads `overrides` only from the root `pnpm` field in `package.json`; pnpm 10+ reads them
only from `pnpm-workspace.yaml`. Measured: a wrapper pnpm 11.20.0 prints *"the pnpm field … was
ignored"* before handing over to the pinned 9.1.0, which does apply them — so the warning is
misleading here and the tree is fine. It stops being misleading the moment something resolves without
the pin: the same override in a project with no `packageManager` did nothing, and `qs` fell from the
6.16.0 floor to 6.11.0. The twelve floors are therefore now declared in **both** files, re-resolving
the repository with them in `pnpm-workspace.yaml` produced a byte-identical lockfile, and
`scripts/audit-baseline.mjs` fails on drift between the two lists — a floor that only one package
manager reads is not a floor.

### Application findings

| # | Severity | Finding | Action |
|---|---|---|---|
| 1 | HIGH | `GET /system/config/:key` had no gate: any signed-in account could read `sso:oidc_code`, whose value is the hand-off record — the single-use code **and** the signing-in user's whole token, live for two minutes. An administrator signing in through SSO could be impersonated by anyone polling the key. The route-guard exemption claimed the route was "guarded per key", which was true of `PATCH` and false of `GET`. | **Fixed** — one shared policy for read and write; reserved rows are refused to everyone and omitted from the `/system/configs` dump. `probe-configuration` grew from 87 to 91 assertions. |
| 2 | HIGH | `GET /api/cloudconnect` returned the raw rows including `credentials` — cleartext M365 client secrets, ConnectWise key pairs, AWS `secretAccessKey` — to any caller with `IntegrationView`, which **Technicians** hold and `IntegrationManage` they do not. | **Fixed** for the role that should not have it: the projection withholds `credentials` from callers without `IntegrationManage` and reports `hasCredentials` instead; the manage-gated UI that edits them is unaffected, and the CloudConnect fix dialog now says so instead of opening a dialog whose save would be refused. `probe-cloudconnect-status` grew from 28 to 34 assertions. |
| 3 | HIGH | Cross-company writes: `POST /projects`, `POST /quotes`, `POST /schedule` and the add-in's `POST /tickets` accepted a `companyId` from the request body, and `client_admin`/`client_user` hold the permissions to reach them. | **Fixed** — the body is checked against the caller's own company (`canAccessCompany`), the add-in pins a scoped account to its own client and refuses another up front with a 403 rather than a per-message "could not be created", and a scoped account is offered only its own client in the pane's picker. Assertions added to `probe-scoping` and `probe-outlook-addin`. |
| 4 | MEDIUM | Cross-client reads: `GET /projects`, `/projects/:id`, `/inventory/assets`, `/inventory/assets/:id`, `/schedule` and `/quotes` had no company filter — the `companyId` query parameter was the caller's choice and absent by default, so a client-scoped account could enumerate every client's projects, assets, schedule and quote pricing. | **Fixed** — `companyWhere` merged into each query, `canAccessCompany` on each detail route (404, not 403). `probe-scoping` grew from 13 to 26 assertions. |
| 5 | MEDIUM | The knowledge base served unpublished and internal articles to `KBView`, which client roles hold: `GET /kb/:slug` ignored `status` and `visibility`, and `GET /kb/drafts` and `?status=`/`?visibility=` were open to everyone with the permission — draft bodies carry the review note and the ticket they were drafted from. | **Fixed** for company-scoped accounts (staff unchanged): drafts are empty, the list ignores a request for drafts or internal articles, and a single unpublished/internal article answers 404. Assertions added to `probe-scoping`. |

### Checked and clean

Parameterised SQL only (the two `$queryRaw` call sites use tagged templates); no command injection
(the `exec`/`execSync` calls use fixed `__dirname` paths and the seeding scripts are not routes); the
invoice HTML escapes every interpolated value; path traversal is confined in the attachment and
installer downloads; every server-side fetcher goes through the egress policy; no secrets are
committed (only placeholders in the `.env` examples); session handling is HttpOnly + `SameSite=strict`
+ double-submit CSRF with hashed tokens and `timingSafeEqual`; the test bypass refuses production and
non-loopback; portal sign-in uses CSPRNG codes, hashed at rest, attempt-capped and scoped.

### Verification used for this round

Every probe in `apps/api` was run against a live API: **28 suites, ~1,200 assertions**. Several are
variants that only make sense against a differently-configured process, and the audit's first lesson
was to read their headers before reading their failures:

| Probe | Needs | Result |
|---|---|---|
| `probe-billing-batch` | `INVOICE_BATCH_ENABLED`, `TIME_RULES_ENABLED`, `EGRESS_ALLOW_PRIVATE` | 36/36 |
| `probe-expenses` | `EGRESS_ALLOW_PRIVATE` (its stub push is on loopback) | 27/27 — and its header now says so, which it did not |
| `probe-kb-autogen` | `EGRESS_ALLOW_PRIVATE`, `KB_AUTOGEN_ENABLED`, a stub model on `PROBE_AI_PORT` | 42/42 — it now reports a missing precondition instead of crashing on an undefined id |
| `probe-outage-board` | `EGRESS_ALLOW_PRIVATE`, `X_BEARER_TOKEN`, `X_API_BASE_URL` pointing at its stub | slow: it drives a full monitor poll across the 14 configured services, so it needs minutes, not seconds |
| `probe-portal-off`, `probe-time-rules-flag`, `probe-billing-generate-flag` | the corresponding flag **off** | 10/10, 9/9, 6/6 |
| `probe-report-designer` | `npx tsx` (it imports the shared TypeScript modules directly) | 349/349 |
| everything else | a running API and the sample data | green, including `probe-configuration` 91, `probe-scoping` 26, `probe-outlook-addin` 63, `probe-cloudconnect-status` 34, `probe-reports-standard` 131, `probe-portal` 90, `probe-products` 82, `probe-permissions` (exit 0), `probe-session` 34, `probe-kumo-audit` 34, `probe-m365-inactivity` 36, `probe-dashboard` 31, `probe-generate` 45, `probe-board-layout` 33, `probe-egress` 21 |

The web-to-API contract audit — every path the SPA requests, resolved against the route table
through the router mounts — reported **332 calls, 0 broken**. `guard:routes` 393/347/0,
`guard:config` 43 declared, `guard:plugin` 26.10.7036 matching its MSI, `guard:deps` 4 accepted
advisories and 12 security floors in parity, help links 75/20/44. API typecheck 150 (the pre-existing
baseline, no error in a changed file); web typecheck 0.

**Not verified this round:** the per-page click-through of the SPA. The browser tooling disconnected
part-way through, so the route sweep was replaced by the three deterministic checks above — stronger
for links and endpoints, weaker for interaction (a button whose handler throws at runtime would not
be caught). Re-run the sweep when the browser is available.


| Item | Why it is not fixed yet |
|---|---|
| **Report colour values reach an HTML sink unescaped.** `reportChartSvg.ts` / `reportOutput.ts` interpolate `style.color`, `style.background` and `border.color` into SVG attributes and `style="…"` strings, which are rendered through `dangerouslySetInnerHTML` and `document.write`; a saved report template accepts any string for a colour. | Exploitation depends on CSP not being inherited by the `window.open("", "_blank")` document — confidence is below the reporting bar. The fix is to validate colour values at save time (the registry already does this for accent colours) and escape at render; it touches the report renderer, so it belongs with the reporting work rather than an audit commit. |
| **`cloudconnect` credentials are stored in cleartext.** | `email-connectors` stores `*Encrypted` columns and maps through a `toPublic()` view; aligning integrations with that is a schema change plus a migration, and the fix above already removes the read path that made it urgent. |
| **The remaining company-scoped modules** (procurement, contracts, checklists, surveys, CRM opportunities). | Same fix as finding 4, but each needs its own probe assertions to be trustworthy; doing them in one pass would be a large, hard-to-review change. Recorded as the H5 remainder. |
| **Majors for the two fixable advisories** (Tailwind 4, Electron 35+). | Both are behaviour-changing upgrades with their own verification (the desktop installer has to be rebuilt and launched); they are Phase 1's normal path, not an audit commit. |
