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
seven issues, of which six are now fixed and one is deliberately deferred until there is a server to fix it
on. **Nothing has been deployed to Azure yet** — everything below is compiled and reviewed, not proven
against a subscription. Two of the recent fixes are one-way doors and are the reason this briefing exists:
they had to be decided before the first deployment, because afterwards they are migrations.

---

## The five things to know

| # | Thing | Why it matters |
|---|---|---|
| 1 | **Geo-redundant database backups are now ON in production** | Azure only lets you set this when the database server is **created**. It was briefly turned off to save ~$10–30/month; with it off, ever turning it on again means a **new server and a data migration**. The data is the only thing in this system that cannot be rebuilt from the repository — the compute can. |
| 2 | **An earlier cost claim was wrong, and it fed the purchase-permission maths** | A note said `SameZone` high-availability "halves the compute". It does not: `SameZone` provisions a standby, and a standby is billed, so both HA modes cost ×2. **Only disabling HA halves it.** This matters because it is the input to how many Azure reservations get bought — the guidance now says reserve ×2 for either HA mode. |
| 3 | **The CI pipeline's migration step was broken and is now fixed** | Every push to `main` would have failed before the deploy step ran: the step authenticated as a fresh system-assigned identity that had no permission to pull the image or read the database secret. |
| 4 | **Two first-run failures were found and one of them is only half-fixed** | The placeholder image a brand-new environment is created with serves on a different port than the app is probed on. Fixing the port **does not finish the job**: health-probe settings belong to the container revision, so the swap to the real image leaves the probes pointing at the placeholder's port. **The first deployment from empty is still expected to fail at the image hand-off**, and the recommended fix is to create the app only against the real image (deploy everything except the app, build into the registry, then create the app). Separately, the deployment's traffic routing used to rely on an omitted setting meaning "leave it alone"; it now states explicitly which revision is serving, so a deployment can never hand traffic to a revision that failed its health check. |
| 5 | **One known security item remains, and it is the last one** | The application still connects to its database as the **server administrator**. This should be closed before production holds real data, because afterwards it is a credential rotation as well as a code change. It cannot be done before the first deployment, because there is no server to create the restricted role on. |

---

## Before the first production deployment

These are the items that must be settled first. Everything else can follow.

- [ ] **Fix the first-run image hand-off** (the one known blocker for a deployment from empty). Health-probe
      settings belong to the container revision, so moving the ingress port is not enough: after the swap to
      the real image the probes still point at the placeholder's port and the deployment fails its own
      health gate. The recommended fix is to create the app only against the real image — deploy everything
      except the app, build and push into the new registry, then create the app with the real tag. It is a
      flow change, so it wants a throwaway resource group rather than another blind edit.
- [ ] **Confirm the production parameters** — region, naming, and that `postgresGeoRedundantBackup` and
      `postgresHaMode` are as intended for the environment.
- [ ] **Decide the high-availability mode and size the reservations with the corrected maths** — ×2 the
      SKU for **either** HA mode, ×1 only if HA is disabled. See item 2 above; the earlier figure was
      wrong.
- [ ] **Decide the ingress policy** — whether the application is reachable only through Front Door.
      The switch exists (`lockIngressToFrontDoor`); the decision does not.
- [ ] **Verify on a throwaway dev resource group**, because nothing has been run against a subscription
      yet:
  1. a full create run from empty — this is the run that will still fail until the hand-off is fixed;
  2. a deployment-only re-run — this must show **no change** to which revision is serving traffic;
  3. one push to `main` — this exercises the fixed CI migration step.
- [ ] **Then close the last security item** (the least-privilege database role) before production data
      arrives.

## Deliberately not done yet, and why

| Item | Why not |
|---|---|
| Least-privilege database role | Needs a server to create the role on. First task after the first deployment, before production data. |
| Private container registry in production | Costs money and changes nothing functionally until there is something to protect. Recommended, not urgent. |
| Secret expiry dates | Meaningless without a rotation runbook, which is written but not yet exercised. |
| Stricter database connection verification (`sslmode=verify-full`) | Needs a certificate decision; tracked in the plan with its trigger. |
| Four further architectural questions (the plan's "D1–D4") | Genuine choices for the business, not defects. Listed in §8 and §9 of the plan. |

## What has *not* been proven

Being explicit, because "applied" and "working" are different words:

- **No deployment has been run.** The templates compile without warnings against the real Bicep compiler
  (a real compile, not a linter), and the deployment script passes a PowerShell parse and its own
  infrastructure-contract guards, but none of it has touched Azure.
- **A first deployment from empty is expected to fail** at the image hand-off, for the reason in item 4
  above. That is a known blocker with a known fix, not a surprise waiting in the pipeline.
- **No CI run has happened since the workflow fix.**
- **Two pre-existing preflight failures** are unrelated to this work and were confirmed on a pristine
  checkout before the change: the dependency audit baseline and a list of environment variables the
  template does not document.

## Where to read more

| Document | What is in it |
|---|---|
| `PlanDocs/PLAN-030-Azure-Bicep-Go-Live-Hardening.md` | The plan: what was hardened, the four deliberate deviations from the original review, the open recommendations (§8), the cost and reservation analysis (§9), and the current status line saying what is confirmed versus compiled. |
| `PlanDocs/PLAN-030-Response-to-Review.md` | The point-by-point reply to the second review, including where the earlier reasoning was wrong and why. |
| `PlanDocs/PLAN-030-Review-of-Applied-Changes.md` | The second review itself (on the branch that produced it). |
| `infra/README.md` | The operational runbook: what to run, secret rotation, the ingress checklist, the cost table and the open items. |
| `docs/API.md` §13 | The maintenance rule for the API documentation, for whoever integrates with this next. |

## How the changes were verified

For completeness, since the claim above is "compiled, not deployed":

- `node scripts/azure/validate-bicep.mjs` — compiles every template with the real Bicep CLI and fails on
  warnings.
- `node scripts/azure/preflight.mjs` — an *infrastructure contract* check that fails if a template regains a
  property that was deliberately removed (a default image tag, a traffic rule claimed implicitly) or if a
  parameters file carries an empty secret.
- The deployment script is parse-checked by the PowerShell parser.
- The documentation guards (`check-help-links`, `check-api-docs`, `check-route-guards`) are green for the
  application side of the same commit.
