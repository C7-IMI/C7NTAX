# PLAN-018 — Dependency & Application Security Remediation

> **Sequence:** Wave 0 — pre-deployment blocker, runs alongside PLAN-017 and ahead of every cloud step in PLAN-016
> **Status:** Planning — this document only. No code changed.
> **Implemented:** Nothing yet. The audit below is the deliverable.
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
| A4 | 🟠 HIGH | `apps/api/src/routes/users.ts:287-345` | `PATCH /api/users/:id` needs only `UserManage` (which `manager` holds) but accepts `role` and a raw `permissions` array for **any** user, including the caller. | A manager promotes themselves to `super_admin`. Effective immediately — permissions are re-read per request. |
| A5 | 🟠 HIGH | `apps/api/src/routes/inference.ts:60-92`, `services/inference/LlmProvider.ts:60-66` | No permission gate, and the admin-supplied `apiEndpoint` is fetched server-side with no host/scheme validation; an existing provider's `apiKey` is sent to it. | Any authenticated user sets `isDefault` on a provider pointing at an internal address or their own server, then causes a prompt. |
| A6 | 🟠 HIGH | `apps/api/src/routes/ssoExchange.ts:48, 63, 86, 100` | The OIDC `state` is generated and **never validated** on the callback, and JIT-provisioned users are created with the `admin` role (`findFirst({systemRole:"admin"})`); the token is handed over as `?token=` in a redirect. | Anyone the IdP will issue an ID token for with an unknown email — when `SSO_ENABLED` is on. |
| A7 | 🟠 HIGH | `apps/api/src/middleware/auth.ts:5`, `services/kumoCrypto.ts:8-16` | Hardcoded JWT fallback secret `"C7NTAX-dev-secret-change-in-prod"`, and the Kumo vault key is derived from `JWT_SECRET` (or that default) when `KUMO_MASTER_KEY` is unset. No startup assertion. | Anyone who reads the public repo, if the env var is ever missing in a deployment. |
| A8 | 🟡 MEDIUM | `apps/api/src/routes/alertWebhooks.ts:18-21`, `routes/bulk.ts:24-25` | `GET` lists `findMany()` the whole `WebhookConfig` including `secret`, with only `authenticate` (the POST/DELETE routes *are* gated). | Any authenticated user reads the HMAC signing secret of every webhook and forges deliveries. |
| A9 | 🟡 MEDIUM | `apps/api/src/middleware/auth.ts:56-58`, `index.ts:123`, `apps/web/src/pages/Billing.tsx:125` | JWTs are accepted from `?token=`, morgan logs the full URL, and the invoice page uses exactly that pattern — so a 12-hour token lands in logs, browser history and any proxy log. | Anyone with log or history access (or a shared support bundle). |
| A10 | 🟡 MEDIUM | `apps/api/src/routes/serviceAlerts.ts:25, 101-118`, `services/alertMonitor.ts:303-312` | A stored `monitorUrl` is fetched server-side with no allow-list; the HTTP status is reflected into the alert body. | An authenticated user holding `ServiceAlertManage`, from inside the VPC. |
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
- **A5/A8/A10 confirmed by grep** on `requirePermission` presence/absence in those routers.

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
| H1 | **One outbound HTTP helper** used by every fetcher (inference, monitors, webhooks, integration adapters, SSO metadata) with a scheme/host allow-list, no redirects to private ranges, and a timeout. | Closes A5/A10 and the connector/integration variants at the root instead of per-route. |
| H2 | **Durable, shared rate limiting and lockout** (Redis — `ioredis` is already a dependency and `REDIS_URL` is configured) instead of per-process maps. | A12; also survives a multi-replica deployment. |
| H3 | **Session cookies instead of `localStorage`** — the `sessionAuth` middleware and `c_session` cookie already exist but are unmounted (PLAN-001). HttpOnly + Secure + SameSite removes the "any XSS = takeover" property that makes A3 severe. | A3/A9. |
| H4 | **Sanitize at render too** (`DOMPurify.sanitize` in the rich-text render path, upgraded), keeping the server sanitizer as the primary control. | Defence in depth for the one `innerHTML` sink; also handles HTML written before the sanitizer existed. |
| H5 | **Company scoping as middleware**, not per-route discipline: a helper that every company-scoped query must pass through, plus the route-guard test from P0-2 extended to assert scoping. | A2's root cause is "each route remembers or doesn't". |
| H6 | **Egress audit log** — record every outbound URL the server fetches (with result) so SSRF attempts are visible. | SOC 2 + incident response. |

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
