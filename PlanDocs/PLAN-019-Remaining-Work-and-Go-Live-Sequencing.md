> **Plan ID:** PLAN-019
> **Title:** Remaining Work & Go-Live Sequencing (advisory overlay)
> **Source:** authored in `PlanDocs/` — distilled from the completed implementation programme
> **Indexed:** 2026-10-07

# Remaining Work & Go-Live Sequencing

> **Sequence:** **overlay** — this plan adds no work of its own. It orders the work the other plans already own, in the order the dependencies and the decisions actually allow. §1 of `README.md` says *what* is left; this says *in what order, why, and what has to be decided first*.
> **Status:** 📋 **Recommendation only.** Nothing in this document has been started, and no recommendation in it has been applied. Where it says *recommend*, that is an engineering opinion for you to accept, reject or amend.
> **Basis:** the repository as at BuildNotes **2026.10.7.017–.022**. Everything buildable without an Azure subscription is shipped and verified: **617 assertions green across 19 probe suites**, `guard:routes` 362 routes / 315 permission-guarded / 0 violations, the six-persona permission matrix identical to its stored baseline, API typecheck at its 152 pre-existing errors, web typecheck 0, Azure preflight 0 failures.
> **What this is not:** it does not replace the owning plans. Every item here already lives in PLAN-002/003/007/011/012/013/014/015/016/017, in `BuildNotes.md` under the version that raised it, and in the consolidated list `files/OUTSTANDING-ITEMS.md`. This document only sequences them.
> **Next action:** the operator decides. Tier 1 then starts with two things that need no code at all — the production flag-value sitting (§3.1) and the subscription handover (§3.3).

---

## 1. How to read this

Three rules:

1. **Decisions first, then work.** Several items are not code at all — a provider choice, a cloud choice, a set of flag values. Doing the code first would mean guessing, and every guess would have to be undone.
2. **Nothing is invented here.** If an item is missing from this document it is because it is already closed, and `BuildNotes.md` says so under its version.
3. **Every tier ends in evidence.** Each step names the check that proves it worked — usually one of the 19 probe suites, which is why §6 recommends making them runnable as one battery.

---

## 2. The shape of what is left

| Kind | Approx. count | What it needs | Where it lives |
|---|---|---|---|
| **Decisions only you can make** | 10 | Your judgement, one sitting each | PLAN-016 header table, `files/OUTSTANDING-ITEMS.md` §1 |
| **Blocked outside the repository** | 6 | An Azure subscription, a tenant admin, or another team | `files/OUTSTANDING-ITEMS.md` §2 |
| **Deliberate skips / recorded limitations** | ~15 | A small change each, scheduled on purpose | `files/OUTSTANDING-ITEMS.md` §5, `BuildNotes.md` per version |
| **Additive polish** | 1 item (#9's tail) | A design decision, not a defect | PLAN-013 §4 item 9 |

**The observation that shapes the sequencing: there is no dependency chain left inside the codebase.** W0, W1, W2 and W5-1 are shipped and verified; PLAN-013 is as complete as the plan allows. Nothing that remains waits on another piece of code — it waits on a *decision* or an *external object*. So the ordering question is not "what depends on what" but "what unblocks the most at once".

---

## 3. Tier 1 — before the first deployment

### 3.1 Production feature-flag values

Every flag already has a **tested off state**, so this is a single sitting with no code. Recommended starting values, with the reasoning you would want on record:

| Flag | Recommended | Why |
|---|---|---|
| `AUTH_HARDENING_ENABLED` | `true` | 15-minute token and a five-failure lockout, **verified in both directions** (2026.10.7.020). The one flag with teeth: it also makes persona accounts lockable, and the bypass account is exempt. |
| `SESSION_AUTH_ENABLED` | `true` | The cookie session is the primary credential the whole browser path now depends on. |
| `PORTAL_ENABLED` | `true` **only when a client is onboarded** | The portal is per-client as well (`Company.portalEnabled`). Switching the deployment flag on before any client has Portal access advertises a sign-in page nobody was told about. |
| `TIME_RULES_ENABLED` / `INVOICE_BATCH_ENABLED` / `BILLING_FROM_TICKETS_ENABLED` | **hold** until the spot rates are confirmed | **These change money.** Weighted time and batch invoicing alter what a client is billed; they are a billing sign-off decision, not a technical one (decision #6, §9). |
| `KB_AUTOGEN_ENABLED` | `true` | Draft-only, one article per ticket, and it refuses thin tickets — the blast radius is a review queue nobody has to read yet. |
| `M365_OFFBOARD_ENABLED` | `false` until the tenant grant exists | Without `AuditLog.Read.All` + Entra P1 every account reports "unknown" — correct by design, but not useful to show a client (decision #7). |
| `CLOUDCONNECT_LIVE_STATUS_ENABLED` | `true` | Reads only, throttled server-side, and it says when it has not verified rather than pretending. |
| `SERVICE_ALERTS_SOCIAL_ENABLED` | `false` to start | Informational-only by design, but it is the source with the least control over its own failure modes. |
| `OUTLOOK_ADDIN_ENABLED` | `true` | Harmless while the manifest's two placeholders are unset: nothing can load it yet. |

Also worth setting deliberately rather than by omission: `PORTAL_DEFAULT_BOARD_ID` (without it, portal tickets land on the oldest active board), `WEB_ORIGIN`/`CORS_ORIGIN`, `SMTP_*` (the portal sign-in code has no other transport), and `KUMO_MASTER_KEY` (with it unset the vault key is derived from `JWT_SECRET`).

**Exit condition:** `infra/env/.env.production.example` reviewed line by line, every flag explicitly set, and the four flag-off probes re-run against the deployment configuration.

### 3.2 Three pieces of console work that need no subscription

These can run in parallel with everything else, and each one removes a blocker that code cannot:

| Task | Unblocks | Note |
|---|---|---|
| **PLAN-017 Entra registration** — register the app, consent `Mail.ReadWrite`, scope to one mailbox | The O365 watcher go-live **and** the Outlook add-in's SSO | Doing it early also removes the last reason the portal signs in with an emailed code instead of SSO. Runbook: `PlanDocs/PLAN-017-Microsoft-365-OAuth-App-Setup.md`. |
| **DNS hostnames + TLS certificates** | The ingress module, the add-in manifest URLs, and the portal address you give clients | The portal link is now something you hand to a customer, so the hostname is no longer internal-only. |
| **Add-in host + GUID decision**, and AppSource-vs-internal | A deployable manifest | The manifest carries `__ADDIN_HOST__` and `__ADDIN_GUID__`; a placeholdered manifest cannot be shipped. The internal admin-center path needs no review and no Partner Center account. |

**Exit condition:** each of the three ends in a concrete value (a client ID, a hostname, a GUID) recorded in `infra/env/.env.production.example` or the manifest.

### 3.3 The subscription handover, and the ingress module

Attach the subscription, create the resource groups, the deploy identity with federated credentials, the role assignments and the GitHub environments. The runbook in `infra/README.md` lists these in order.

**This is the largest single unblock available**: everything in PLAN-016 is written and validated except the ingress module, which was deliberately left unwritten because Bicep that cannot be compiled with `bicep build` is unverifiable text. The moment `az`/`bicep` exist, that module is a bounded piece of work with a compile-and-diff proof.

**Exit condition:** `node scripts/azure/preflight.mjs` green against the real environment, `deploy-env.ps1 -WhatIf` reviewed, then the module written and `bicep build` clean.

### 3.4 Recommended first deployment: **dev first, with the battery run against it**

> **Recommendation.** Deploy the **dev** environment before prod, and run the 19 probe suites against the deployed API before touching production.

The reasoning: every verification so far has been local. There is no environment where the *deployed artefact* — container image, one-origin SPA + API, Key Vault-injected secrets, private-endpoint Postgres — has been exercised. That gap is the largest remaining risk, and one deployment closes it.

What I would expect it to surface, based on what the local changes already taught us (a CSP that blocked Office.js, cookies that behave differently without HTTPS, absolute URLs in the manifest):

- `frame-ancestors`/`script-src` behaviour on the add-in path over HTTPS,
- `secure` cookie + `SameSite=Strict` under a real domain (the portal and session cookies),
- `PUBLIC_URL`-style absolute links in the add-in manifest and any email template,
- migrations applied by `prisma migrate deploy` rather than `migrate dev`,
- the service worker's shell cache against a real deployment (it must cache only the shell).

**Exit condition:** the battery green against dev, plus a written note of anything the environment required that the repository did not.

---

## 4. Tier 2 — small builds, each gated on one decision

| Build | Gated on | Size | Notes |
|---|---|---|---|
| **SMS notifications** (PLAN-015 #13) | Provider choice (§9 #1) | Small | The only Phase B item not built. Provider choice determines the client library, the cost model and the compliance story, which is why nothing was guessed. |
| **Customer invoice email** (PLAN-015 Phase A #3) | Whether to, and from which address (§9 #4) | Small | A template plus the PDF that already renders; wired into batch approval. The plan assumed an "existing path" that never existed. |
| **Portal follow-ups** (PLAN-013 #3) | Whether you are onboarding a portal client soon | Small | Recommended order if yes: the **retention sweep** for `PortalLoginCode`/`PortalSession` first (stops two tables growing forever), then attachments. The internal notification on a customer reply can wait — the reply already appears in the queue. |
| **Per-role passkey policy / SAML** (PLAN-002) | An enterprise client asking, or not | Medium | Best built when a real IdP is in front of it; its shape is decided by that IdP's configuration. |

---

## 5. Tier 3 — one deliberate pass each, not leftovers

| Pass | What to do | Verification |
|---|---|---|
| **PLAN-013 #9's tail** — empty-state audit, breadcrumb parity, mobile table→card transforms | Batch into **one** UI pass with a design review, not page by page | Web typecheck, browser check per surface. The defect-shaped parts of #9 are already done (2026.10.7.019, .021, .022) |
| **The two in-memory stores** — passkey challenge store, CloudConnect health | Move **both** in one change, when you decide to run more than one replica | `probe-passkey`, `probe-cloudconnect-status`. They are the same class of bug and the same fix; doing them separately means doing it twice |
| **Recorded limitations worth scheduling** — retention policies for audit rows; Kumo audit coverage for assets/configs/links; the social source's per-service query; `MFASetup`'s rotate-on-load; the auto-TOTP panel nested inside "Credentials Revealed"; `FinanceDashboard`'s raw company-ID input | One small change each, in whatever order suits | Each has an owning probe or a browser check |
| **Later waves** — PLAN-007 (SOC 2), PLAN-004 (mobile), PLAN-005 (mac/Linux), PLAN-011 (agent/MCP), PLAN-014 (RMM) | PLAN-007 is an auditor-scope exercise before it is code; PLAN-004/005 are mostly packaging; PLAN-011 is the largest; PLAN-014 is another team's dependency | Per plan |

---

## 6. Two practices I would change

### 6.1 Run the probes as one battery

The 19 suites (**617 assertions**) are the most valuable asset in the repository and they are currently run by hand, in two API configurations and four flag-off variants. A single `scripts/run-battery.ps1` that starts the API in each required configuration, runs the suites, prints a summary table and exits non-zero on any failure would turn "I believe it works" into "it says so".

Two caveats, both learned the hard way:

- **The suites create and delete real rows**, so they need their own database before they go into CI. Four of them already need `EGRESS_ALLOW_PRIVATE=true` and a loopback stub; `probe-egress` needs it *absent*.
- **Each suite is evidence for a specific claim**, so it must ship in the same commit as the feature it proves — which is how this programme has been run and what makes the claims checkable later.

### 6.2 Do a short "primary surfaces" pass on a fresh environment

> **Recommendation.** A 30-minute scripted click-through on a clean environment: sign in → list tickets → search → open one → add a note → log time → generate an invoice → sign into the portal → sign out.

All three defects found in the session that produced this document came from **using** the product rather than reading it: a duplicated route the finance dashboard had coded against, an auth-hardening guard that re-hashed every password on every sign-in, and a service worker holding another user's cached API responses. Each had passed a code review. A click-through would catch that class cheaply, and doing it on a *fresh* environment would catch the environment-specific ones in §3.4.

---

## 7. Multi-tenant — what returns together if it is ever taken up

Staying excluded by decision. Worth recording what is attached to it so the cost is known:

- **PLAN-003** itself (steps 2–3: tenant middleware, full isolation/RLS),
- **PLAN-013 #8's RLS enforcement pass** (the one part of #8 not done),
- **PLAN-011 phase 7's** `tenant_id` vector filter.

Today's substitutes are proven rather than asserted: company scoping via `User.companyId` / `Contact.companyId` (`probe-scoping`, 13 assertions) and per-contact portal scoping (the portal probe, 90).

---

## 8. The shortest path to a live system

| Step | Action | Exit condition |
|---|---|---|
| 1 | Attach the subscription; create the resource groups, deploy identity and GitHub environments | `preflight.mjs` green against the real environment |
| 2 | Deploy **dev** | The app answers on its own hostname |
| 3 | Run the battery against dev (§3.4) | 19 suites green, plus a note of anything the environment needed |
| 4 | Console tasks in parallel with 1–3 (§3.2) | A client ID, a hostname, a GUID — recorded |
| 5 | Flag-value sitting (§3.1) | Every flag explicitly set in the production env |
| 6 | Write and compile the ingress module | `bicep build` clean, `-WhatIf` reviewed |
| 7 | Deploy **prod** | The dev battery's checks repeated against prod |
| 8 | SMS and the invoice email at leisure | Per Tier 2 |

Steps 1, 4 and 5 need no code. That is the point of the ordering: the critical path is decisions and console work, not implementation.

---

## 9. Decision ownership

| # | Decision | Owner | What it unblocks | Cost of deciding late |
|---|---|---|---|---|
| 1 | SMS provider + sender ID | Commercial | PLAN-015 #13, the last Phase B item | Nothing else waits; it stays unbuilt |
| 2 | Azure or AWS | Architecture | PLAN-016 (or PLAN-010), the ingress choice, PLAN-011's AI services | The deployment package is Azure; a late switch re-does the Bicep |
| 3 | Production flag values | Commercial + risk | The first deployment | A flag guessed wrong is a billing or exposure surprise |
| 4 | Customer invoice email — whether, and from which address | Commercial | PLAN-015 Phase A #3's last gap | Invoices are issued without being sent |
| 5 | Per-role passkey policy and SAML | Security | PLAN-002's remaining scope | Only if an enterprise client asks |
| 6 | Spot-rate tiers ($100/$250/$275/$400) | Commercial | The three billing flags in §3.1 | Billing runs on unconfirmed rates |
| 7 | M365 `AuditLog.Read.All` + Entra P1 | Tenant admin | The inactivity report's usefulness | Without it every account reads "unknown" |
| 8 | Add-in host + GUID; AppSource or internal | Product | A deployable manifest | The add-in cannot be sideloaded or distributed |
| 9 | PLAN-017 registration | Tenant admin | The O365 watcher, add-in SSO, and the portal's SSO option | The watcher stays unconfigured |
| 10 | DNS, TLS, hostnames | Infrastructure | The ingress module, manifest URLs, the portal address | Three plans stay blocked |

---

## 10. Keeping this current

This overlay is only useful while it matches reality. Two habits keep it honest:

- When a decision in §9 is made, strike it here **and** in `PlanDocs/README.md` §1, and record the answer in `BuildNotes.md` under a version — the plan registry and BuildNotes are what the next reader will believe.
- When a tier item ships, move it out of `files/OUTSTANDING-ITEMS.md` in the same commit rather than leaving it listed. An outstanding-items list that overstates what is left is as misleading as one that understates it (the lesson of 2026.10.7.016).
