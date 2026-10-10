# C7NTAX — Azure deployment readiness briefing

**Date:** 9 October 2026
**Subject:** the state of the Azure deployment package (`infra/`, `scripts/azure/`), what was just
hardened, and what must be decided or done before the first production deployment
**Audience:** whoever is accountable for putting this application into production
**Length:** read the top table and the "before you deploy" list; the rest is background

---

## In one paragraph

The application has a complete Azure deployment package described in `PlanDocs/PLAN-030-Azure-Bicep-Go-Live-Hardening.md`.
It was reviewed twice. The first review's recommendations were applied; a second review of that work found
seven issues, of which six were fixed and one deferred. A third pass has since implemented the reviewer's
own recommended fix for the first-run hand-off — so a deployment into an empty environment is no longer
expected to fail — and renamed the database `c7ntax`. The last security item (the application connecting
as the server administrator) is **parked by decision**, not forgotten. **Nothing has been deployed to
Azure yet** — everything below is compiled and reviewed, not proven against a subscription. Two of the
earlier fixes are one-way doors, which is why this briefing exists: they had to be decided before the
first deployment, because afterwards they are migrations.

---

## Update — round 3 (read this before the rest)

**The package is not ready to deploy.** A third review ran the deployment commands through the real Azure
CLI's parser, which needs no subscription, and found that **neither the deploy script nor the CI workflow
can complete a deployment as written**. The templates compile and the scripts parse as PowerShell and YAML,
which is why every earlier check passed: the defects are in the *arguments* of `az` commands.

| What fails | Why it matters |
|---|---|
| The revision step, `az containerapp update --target-port` | The flag does not exist on that command. Every script run stops here. An earlier note recorded it as confirmed; it was not. |
| The health check on the new revision | It looks for a property revisions do not have, so it can never see the revision become healthy. Script and workflow. |
| The traffic shift (and the printed rollback command) | `--revision` and `--weight` are not options of `ingress traffic set`. A new revision is never promoted. Script, workflow and rollback. |
| The migration job | Its command is passed as one word instead of four, so the container is asked to run a program that does not exist. Script and workflow. |

None of these puts anything at risk — the old revision keeps serving, which is the design working — but no
deployment can finish. Round 2's two fixes (the `job update` flags and the new `/api/ready` check) are
correct. The review also found that the new readiness check would **refuse a rollback**, that dev cannot
prove the production-only settings, and two application items the go-live bar did not list: the app does not
yet know it sits behind a proxy (so every user shares one rate-limit bucket and every audit row records the
proxy's address), and production is set to **two replicas** although the plan says not to run more than one
until in-memory state and background workers are made safe for it.

**Nothing has been fixed yet.** The review is findings only. See
`PlanDocs/PLAN-030-Review-Round-3.md` for each defect with the exact correction, and plan §8.15.

---

## The five things to know

| # | Thing | Why it matters |
|---|---|---|
| 1 | **Geo-redundant database backups are now ON in production** | Azure only lets you set this when the database server is **created**. It was briefly turned off to save ~$10–30/month; with it off, ever turning it on again means a **new server and a data migration**. The data is the only thing in this system that cannot be rebuilt from the repository — the compute can. |
| 2 | **An earlier cost claim was wrong, and it fed the purchase-permission maths** | A note said `SameZone` high-availability "halves the compute". It does not: `SameZone` provisions a standby, and a standby is billed, so both HA modes cost ×2. **Only disabling HA halves it.** This matters because it is the input to how many Azure reservations get bought — the guidance now says reserve ×2 for either HA mode. |
| 3 | **The CI pipeline's migration step was broken and is now fixed** | Every push to `main` would have failed before the deploy step ran: the step authenticated as a fresh system-assigned identity that had no permission to pull the image or read the database secret. |
| 4 | **The first-run failure is fixed in the template — and still has to be run once** | The app used to be created against a placeholder image whose port the probes could not follow (probe settings live in the container revision), so the **first** deployment into an empty environment could not finish. The app is now created **once, against the real image**, in two passes: everything except the app, build and push the image, then create the app with it. The hand-off that failed cannot happen because there is no hand-off. It is compiled, parsed and reviewed — **and it has not been executed against Azure**, so the first dev run is still the thing that proves it. Separately, the deployment's traffic routing now states explicitly which revision is serving, so a deployment can never hand traffic to a revision that failed its health check. |
| 5 | **One known security item remains, and it is parked by decision, not overlooked** | The application still connects to its database as the **server administrator**, which is a member of `azure_pg_admin`. This should be closed before production holds real data, because afterwards it is a credential rotation as well as a code change. It cannot be done before the first deployment — the restricted role is created on a server that does not exist yet. The plan of record is corrected and ready (§8.1): an `app_c7ntax` role owning the **`public` schema of the `c7ntax` database**. |

---

## What production will be created with

Read from `infra/params/prod.bicepparam` and the template's own defaults, so this is what a `prod` run
produces rather than what somebody remembered setting. **The two rows marked ⚠ must be decided by a
person before the first production deployment** — they are not defects, they are values nobody has chosen
yet, and both look finished because they are spelled correctly.

| Setting | Value for `prod` | Notes |
|---|---|---|
| Resource group / environment | `rg-c7ntax-prod`, `environment = 'prod'` | |
| **Region** | ⚠ **the resource group's own location** | The template defaults `location` to `resourceGroup().location` and no parameter file overrides it, so the region is whatever the group was made in. Decide it, or it decides itself. |
| Naming | `acrc7ntaxprodprod01`, `kv-c7ntax-prod-prod01`, `psql-c7ntax-prod-prod01`, `aca-c7ntax-prod`, `c7ntax-prod` (the app), `vnet-c7ntax-prod-prod01` | From `uniqueSuffix = 'prod01'`. Global names (the registry, the server) must not already exist. |
| Database | **`c7ntax`**, Postgres Flexible Server, VNet-injected, no public endpoint | Renamed from `c7_overwatch` (§8.12 of the plan). |
| Database shape | `Standard_D2ds_v5`, `GeneralPurpose`, **128 GB**, HA **`ZoneRedundant`** | |
| Geo-redundant backup | **`Enabled`** in prod (the template's default for this environment) | One-way at server creation. |
| Replicas | min **2**, max **10** | |
| **`webOrigin`** | ⚠ **`https://app.c7ntax.example.com` — a placeholder** | Passed as both `WEB_ORIGIN` and `CORS_ORIGIN`, which per the deployment's own environment example "gate CORS **and every redirect the app builds** (SSO callback, desktop hand-off, reset links)". As it stands, a production deployment would block browser calls from the real origin and put a dead hostname in password-reset and notification links. Only the operator has the real value; it is deliberately not invented here. |
| Ingress lock | `lockIngressToFrontDoor = false` | See the ingress decision in the checklist below. |
| Secrets the deploying shell must carry | `POSTGRES_ADMIN_PASSWORD`, `JWT_SECRET_VALUE`, `KUMO_MASTER_KEY_VALUE` | The parameter files read them from the environment, so a run missing one fails at compile time instead of writing an empty signing key into Key Vault. |

## Before the first production deployment

These are the items that must be settled first. Everything else can follow.

- [ ] **Fix the promotion path's `az` commands** — the five defects in the round-3 review (§A1–A5, plus the
      stale-execution poll A6), in the script and the workflow together. Then add the CLI-syntax guard to
      preflight so it cannot return. Nothing deploys until this is done.
- [ ] **Make the readiness check allow a rollback** (round-3 §B2): "everything this image ships has been
      applied", not "the newest applied equals the newest shipped".
- [ ] **Decide the replica count and the proxy setting** (round-3 §C1, §C2). Recommended for the first
      deployment: one replica, and the proxy hop count set so client addresses are real.
- [ ] **Rehearse the production parameter set once in a throwaway resource group** (round-3 §B5): it is the
      only run that can prove the closed Key Vault, zone-redundant HA and the creation-time geo-redundant
      backup, none of which dev exercises.

- [x] **Fix the first-run image hand-off** — **done in the template** (plan §8.13). The app is now created
      once, against the real image, in two passes, so the probe-port hand-off that made a deployment from
      empty fail cannot happen. It is compiled, parsed and reviewed, and **not yet executed**; the dev run
      below is what proves it.
- [ ] **Confirm the production parameters** — the table above is what a `prod` run creates, including the
      region it inherits from the resource group, the naming that has to be globally free, and the two ⚠
      values that are placeholders rather than choices.
- [ ] **Decide the high-availability mode and size the reservations with the corrected maths** — ×2 the
      SKU for **either** HA mode, ×1 only if HA is disabled. See item 2 above; the earlier figure was
      wrong.
- [ ] **Decide the ingress policy** — whether the application is reachable only through Front Door.
      The switch exists (`lockIngressToFrontDoor`); the decision does not.
- [ ] **Verify on a throwaway dev resource group**, because nothing has been run against a subscription
      yet:
  1. a full create run from empty — this now exercises the two-pass create, and is the run that proves the
     first-run failure is fixed rather than relocated;
  2. a deployment-only re-run — this must show **no change** to which revision is serving traffic;
  3. one push to `main` — this exercises the fixed CI migration step.
- [ ] **Close the last security item** (the least-privilege database role) before production data arrives.
      **Parked by decision on 2026-10-09** — the plan of record is corrected and ready (§8.1), and it is
      the first task after the first deployment rather than a forgotten finding.

## Deliberately not done yet, and why

| Item | Why not |
|---|---|
| Least-privilege database role | **Parked by the operator's decision on 2026-10-09.** Needs a server to create the role on, so it is the first task after the first deployment and before production data — and it is the one High item still open. |
| Private container registry in production | Costs money and changes nothing functionally until there is something to protect. Recommended, not urgent. |
| Secret expiry dates | Meaningless without a rotation runbook, which is written but not yet exercised. |
| Stricter database connection verification (`sslmode=verify-full`) | Needs a certificate decision; tracked in the plan with its trigger. |
| Four further architectural questions (the plan's "D1–D4") | Genuine choices for the business, not defects. Listed in §8 and §9 of the plan. |

## What has *not* been proven

Being explicit, because "applied" and "working" are different words:

- **No deployment has been run.** The templates compile without warnings against the real Bicep compiler
  (a real compile, not a linter — Bicep CLI 0.48.1, 0 warnings), the deployment script parses cleanly under
  Windows PowerShell 5.1 and its `-WhatIf` path describes both passes of the first-run create, but none of
  it has touched Azure.
- **The two-pass first-run create is unrun**, which is the one thing that changed most recently: pass 1
  without the app, the image build, pass 2 with it. It is designed to remove the failure the previous
  briefing predicted, and it has not been executed against ARM.
- **No CI run has happened since the workflow fix — and the workflow would not complete if one did.** Round 3
  found that its health check, traffic shift, rollback step and migration command use arguments the Azure CLI
  rejects or mishandles (see the update above). The same is true of the script.
- **The script's `az` calls had never been through the CLI's own parser until round 3.** "Compiled and
  parsed" meant the Bicep compiler and the PowerShell parser, which cannot see a wrong flag on an `az`
  command.
- **Review round 2's two findings are fixed and exercised locally, not run against Azure**: the
  `az containerapp job update` flags (the update path now moves only the image) and the readiness
  endpoint (`GET /api/ready`, with `?deep=1` checking that the newest migration in the image has been
  applied) — including a deliberate negative test that proved the deep check can fail. See
  `PlanDocs/PLAN-030-Response-to-Review-Round-2.md`.
- **Two pre-existing preflight failures** are unrelated to this work and were confirmed on a pristine
  checkout before the change: the dependency audit baseline and a list of environment variables the
  template does not document.

## Where to read more

| Document | What is in it |
|---|---|
| `PlanDocs/PLAN-030-Azure-Bicep-Go-Live-Hardening.md` | The plan: what was hardened, the four deliberate deviations from the original review, the open recommendations (§8), the cost and reservation analysis (§9), and the current status line saying what is confirmed versus compiled. |
| `PlanDocs/PLAN-030-Response-to-Review.md` | The point-by-point reply to the second review, including where the earlier reasoning was wrong and why — and an addendum covering the first-run fix, the database rename, a correction to the plan's own §8.1, and the parked security item. |
| `PlanDocs/PLAN-030-Review-Round-2.md` | Review round 2 (on the branch that produced it): the `job update` flags and the health gate that cannot see the database. |
| `PlanDocs/PLAN-030-Response-to-Review-Round-2.md` | The reply to that round, with the verification that the readiness check can actually fail. |
| `PlanDocs/PLAN-030-Review-Round-3.md` | Review round 3: the deployment commands run through the Azure CLI's parser, the five defects that stop a deployment completing, the rollback flaw in the readiness check, and the replica and proxy items. Findings only. |
| `PlanDocs/PLAN-030-Review-of-Applied-Changes.md` | The second review itself. **Not in the repository** — it is on neither `main` nor `claude/plan-030-bicep-go-live`, though several documents refer to it. Its findings survive in the response above and in plan §7–§9. Restore it or remove the references. |
| `infra/README.md` | The operational runbook: what to run, secret rotation, the ingress checklist, the cost table and the open items. |
| `docs/API.md` §13 | The maintenance rule for the API documentation, for whoever integrates with this next. |

## How the changes were verified

For completeness, since the claim above is "compiled, not deployed":

- `node scripts/azure/validate-bicep.mjs` — compiles every template with the real Bicep CLI and fails on
  warnings. Latest run: **Bicep CLI 0.48.1, three files ok, 0 warnings**.
- `node scripts/azure/preflight.mjs` — an *infrastructure contract* check that fails if a template regains a
  property that was deliberately removed (a default image tag, a traffic rule claimed implicitly) or if a
  parameters file carries an empty secret.
- The deployment script is parse-checked by the PowerShell parser: **0 errors** under Windows PowerShell
  5.1, and its `-WhatIf` path was executed — it describes both passes of a first run (`createApp=false`,
  then `createApp=true` once the image exists) and touches nothing.
- The database rename was rehearsed locally rather than assumed: the local instance was renamed with the
  API stopped, 119 tables / 104 tickets / 17 users came through intact, and the API then answered
  `/api/health` and served the queue from the new name.
- The documentation guards (`check-help-links`, `check-api-docs`, `check-route-guards`) are green for the
  application side of the same commit.
