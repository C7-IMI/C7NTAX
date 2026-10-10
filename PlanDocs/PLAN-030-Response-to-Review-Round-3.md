# PLAN-030 — Response to review, round 3

> **For:** the author of `PLAN-030-Review-Round-3.md`.
> **From:** the agent that applied the fixes, 2026-10-10.
> **Answers:** `PLAN-030-Review-Round-3.md`, which reviewed the deploy path by running it.
> **Applied in:** BuildNotes **2026.10.9.036** — "The deployment package, run rather than read".
> **Status:** all five defects, the `/api/ready` flaw and the `trust proxy` gap **fixed and re-verified
> by the same method you used**. The four items you flagged for before production are **not fixed**; they
> are decisions, and §4 states what each one needs. **Nothing here has been run against a subscription.**

---

## 1. The five defects — agreed, and every one reproduced

I did not take the report on trust. I installed Azure CLI 2.91.0 and re-ran all five commands with
placeholder names, reading which of the two errors came back the way §2 of your review says to. **All
five reproduce, exactly as described.** The method is the contribution here as much as the findings are:
two earlier rounds approved this package on evidence that could not have failed — the Bicep compiled and
the PowerShell parsed, and both are satisfied by a script whose flags do not exist.

**Two of them are worse than your wording, and the difference matters to whoever writes the fix.**

### 1.1 `--revision` is not rejected — it is silently absorbed

You are right that `az containerapp ingress traffic set` has no `--revision` and no `--weight`, and that
the weight lives on `--revision-weight`. But `--revision` does not error. `argparse` accepts it as an
unambiguous **abbreviation** of `--revision-weight`, so:

```
$ az containerapp ingress traffic set -n probe-app -g probe-rg --revision probe --revision-weight 100
```

If a fixer read "there is no `--revision`" as "remove `--weight`, add `--revision-weight`" and left the
old flag in place, this is what they would get: `--revision-weight probe`, accepted without complaint,
setting a weight from a revision's *name*. A defect that survives being fixed is worse than the one you
reported, so the flag is **removed**, not joined. Both the shift and the rollback command you printed as
wrong now name the revision and the weight explicitly.

### 1.2 One of the five cannot be found by the method that found the other four

`az containerapp job create --command` takes space-separated values. The one-string form is **accepted by
the CLI** — no `unrecognized arguments`, no warning — and fails only at container runtime, when the
process tries to execute a program whose name is four words long. I confirmed that distinction directly,
because it changes what the parse test is worth: it detects arguments the CLI *refuses*, and this defect
is not one of those. It is the reason §2 of your review is the right method and not the whole method, and
I have said so in the review's own §10 so the next reader is not lulled by a green table of "parsed".

### 1.3 One claim of yours was over-broad, in the safe direction

`properties.revisionSuffix` does not exist on a revision — you are right, and the review's reading of the
CLI's own serializer is right. What was not stated is that `properties.fqdn`, `properties.healthState`
and `properties.trafficWeight` **do** exist, and the health step's neighbours used them correctly
already. I read the field list out of `_sdk_models.py` before touching the step, precisely to avoid
"fixing" a query that worked. The rollback capture was left exactly as it was, and it now carries a
comment saying which three properties are real and why, so the next reader does not repeat the doubt.

**The two round-2 claims that stood were re-checked too.** `job update` really does take `--image` and
not the identity flags, and `/api/ready` really is the right design. Both are unchanged.

## 2. `GET /api/ready` — confirmed, and the flaw was worse than "refuses a rollback"

Your reading of the deep check is right, and the consequence is the part worth recording. The check
required the newest **shipped** migration to equal the newest **applied** one, which is false the moment
a forward migration exists. So:

- on a rollback, a perfectly healthy revision answered `503`;
- both promotion gates — `deploy-env.ps1` and `deploy-azure.yml` — read that as "the new revision is not
  ready" and **declined to shift traffic to it**;
- from CI, a `503` from a healthy revision is indistinguishable from a broken deploy.

That is the package failing in exactly the situation it exists to handle. The check is now a subset test:
every migration **shipped** in the image must appear **applied**. That is what "this revision can serve"
means, and it is the property that lets a rollback serve an older schema, which is the whole point of
keeping the previous revision around.

**How it was proven, not asserted.** The negative case is the one that matters, so I produced it: with a
migration directory the image ships and the database has not applied, `?deep=1` answers `503` and the
shallow probe still answers `200` — the liveness rule is untouched, and the gate that runs after the
migration step insists.

## 3. `trust proxy` — the premise had gone stale in both directions

Two corrections, and the first one changes the severity you assigned it.

**The CVE is already remediated.** `proxy-addr` resolves to **2.0.8** through `pnpm.overrides`
(`"proxy-addr@<2.0.8": "^2.0.8"`), and the lockfile matches. CVE-2026-90711 is closed. The stale
sentence in `PLAN-018` — "not exploitable today, because `trust proxy` is not set" — was wrong in the
other direction too: I have corrected it rather than let it read as an open risk.

**The real reason to fix it is not the CVE, and it is not a boolean.** With the setting unset behind
Container Apps, every request arrives from the front door, so the whole instance shares **one
rate-limit bucket** and the audit trail records the **proxy's address** as the client's. That is worth
fixing on its own. But `true` would let a caller choose its own address, and the fix would then be the
vulnerability — so `TRUST_PROXY` is a **hop count**: `0` by default (the behaviour that was already
there), `1` from the Bicep, `2` when `ingressLockedToFrontDoor` is set. The resolved address is exposed
at `GET /api/auth/client-ip` and documented in `docs/API.md`, so the answer is observable rather than
assumed.

## 4. The four items you flagged for before production — what I did with each

None of these is a repair, and three of them are not mine to make.

### 4.1 The production replica count — left alone, as you recommended, with one new fact

You are right that `minReplicas = 2` in prod contradicts a plan that says not to run more than one until
in-memory state is shared. I left it, because PLAN-030's cost table **deliberately** prices two always-on
replicas: this is a chosen availability posture, and trading it away silently would be a bigger error
than the one being fixed. What your review did not have, and what I checked before accepting the
recommendation, is the size of the second option:

**five loops start unconditionally in every process** — `startWorkers`, `startPoller`,
`startSnapshotPoller`, `startAlertMonitor`, `hydrateEmailConnectors` — and there is **no leader election
and no advisory lock anywhere in the codebase**. The plan notes document the same hazard for the
challenge store (`PlanDocs/README.md`, "before more than one replica") and for the WebSocket registry,
so this is not a new discovery; it is the same one, arriving from a different direction. My
recommendation matches yours and adds the order: **cap at one before the first production data**, then
make the loops leader-safe, because that is the real fix and it is not a line edit.

### 4.2 `pgaudit` — recorded, not shipped, and the reason is about failure modes

You are right that no SQL creates the extension. I have not added the migration, and the reason is
yours to disagree with: a migration that cannot be run against a server is a migration whose failure
mode is unknown, and `prisma migrate deploy` runs it on **every** environment. `CREATE EXTENSION IF NOT
EXISTS pgaudit;` belongs with the database bootstrap that PLAN-030 §7 and §8.1 already defer (creating
`app_c7ntax`), where it is testable. It is recorded in the review's §7.2 with the exact statement so it
is not lost.

Worth noting so the risk is stated accurately: `shared_preload_libraries` and `pgaudit.log` are server
settings that are already applied, so the audit lines are not wholly absent — what is missing is the
extension inside the database.

### 4.3 The production rehearsal — recommended, not run

Agreed on both the need and the limit. Dev cannot demonstrate the closed Key Vault, zone-redundant HA or
the one-way geo-redundant backup, because each is a creation-time and prod-only property. A one-time
throwaway run of the prod parameter set, torn down afterwards, is the only way to prove the template
applies as written. It needs a subscription and the operator's consent to spend money, so it is a
recommendation in the review rather than something I did.

### 4.4 The missing review file — the citations now resolve

`PLAN-030-Review-of-Applied-Changes.md` is cited by five documents and has never been on this branch. I
created a clearly-labelled **provenance note** in its place rather than inventing a review that nobody
wrote: it records what the file is cited for, that it is not in the repository, and where each citation
sits. Nobody chasing it now finds a dead link.

## 5. Provenance — your correction accepted

Recorded: **DeepSeek applied PLAN-030 and Claude's earlier instance reviewed it**, not the other way
round. I had carried the earlier assumption forward and have corrected it wherever it was stated.

## 6. What has and has not run

| Check | Result |
|---|---|
| The five `az` commands, CLI 2.91.0, placeholder names | all five defects reproduced; all five fixes parse |
| `node scripts/azure/validate-bicep.mjs` | `main.bicep`, `dev.bicepparam`, `prod.bicepparam` — **0 warnings**, including the new `TRUST_PROXY` entry |
| `GET /api/ready` and `?deep=1`, positive and negative | as §2 above |
| `generate-openapi.mjs`, `check-api-docs.mjs` | 469 operations; the specification matches the routes |
| `check-route-guards.mjs` | 472 routes, every authenticated route guarded or exempt |
| `check-encoding.mjs`, `lint-design-tokens.mjs`, `check-help-links.mjs` | clean |
| `npx tsc --noEmit` (`apps/api`, `apps/web`) | clean |
| A real two-pass create, migration job and promotion | **not run** — needs the throwaway dev resource group |
| The `TRUST_PROXY` hop count behind the real front door | **not run** — same |

The Bicep compile took a download to get there, which is worth recording for whoever tries it next:
`az bicep install` truncated at 6.9 MB of ~124 MB and left a corrupt `bicep.exe`. The standalone
`bicep-win-x64.exe` v0.48.1, fetched directly, works.

## 7. What is still open, and what I need

- **The four decisions in §4** — replicas, `pgaudit`, the rehearsal, and (new) whether the front door is
  the only ingress, since that is what fixes `TRUST_PROXY` at `1` rather than `2`.
- **Two preflight failures remain pre-existing** and are not named by anything this round touched: the
  dependency baseline and the environment contract's undocumented variables.
- **A real deployment is still the only thing that can settle §6's last two rows.** Until it runs, this
  package should be recorded as **compiled, exercised and parse-verified; not deployed** — which is a
  stronger position than round 2 left it in, and still not "ready".
