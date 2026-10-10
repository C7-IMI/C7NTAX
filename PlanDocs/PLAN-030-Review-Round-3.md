# PLAN-030 — Review, round 3: the deploy path, run as far as it goes without a subscription

> **For:** whoever owns the Azure package next.
> **Date:** 2026-10-10.
> **Subject:** `scripts/azure/deploy-env.ps1`, `.github/workflows/deploy-azure.yml`, `GET /api/ready`,
> and the `trust proxy` note the package inherits.
> **Method:** Azure CLI 2.91.0 installed, and every `az` command in both files executed with
> placeholder names. See §2 for what that does and does not prove.

## 1. Verdict

**Five defects stopped the package deploying, and all five are real.** They were confirmed by running
the commands, not by reading them — which matters here, because the previous round approved one of them
on the strength of a claim about the CLI's source rather than the CLI. All five are fixed in this
change, and each fix has been executed to the same standard.

Two further findings are real but are **decisions for the operator**, not repairs: the production
replica count (§7.1) and `pgaudit`'s extension (§7.2). Both are stated with the evidence and left
alone, because changing either silently would be a bigger error than the one being fixed.

One thing the review surfaced that nobody had asked about: a document cited by five files has never
existed on this branch (§7.4), and a claim in this repository's own dependency record had gone stale in
both directions (§6).

## 2. What "tested" means here, and what it does not

`az` can be run without a subscription. It parses its arguments, resolves the command, and only then
asks for credentials, so the error message tells you which of two things happened:

| What you see | What it means |
|---|---|
| `ERROR: unrecognized arguments: --flag value` | the CLI **rejects** the argument. The command cannot work. |
| `ERROR: Please run 'az login' to setup account.` | the arguments **parsed**. Only the subscription was missing. |

That distinction is the whole method, and it is reproducible: install the CLI, run the command with
placeholder names, read which error comes back. It proves an argument is accepted or rejected. It
**cannot** prove a call succeeds against a real resource group, and it cannot prove a migration job
runs or a revision reports itself healthy — those need a deployment, and §8 lists what is left.

For the two questions that are about *response shape* rather than arguments, the authority is the CLI's
own serializer — `azure/cli/command_modules/containerapp/_sdk_models.py` in the installed CLI. That
file is what `--query` runs against, so a property named there is a property that exists.

## 3. The five defects, each confirmed by execution

### 3.1 `--target-port` is not an argument of `containerapp update`

```
$ az containerapp update -n probe-app -g probe-rg --image probe:1 --target-port 4000 --revision-suffix probe
ERROR: unrecognized arguments: --target-port 4000
```

`deploy-env.ps1` passed it on the update that creates the revision, so **the script stopped at the
revision step on its first `az` call of that step — before any revision existed, and before the health
gate or the traffic shift were reached.** The comment above it claimed the flag was "confirmed", on the
grounds that `target_port` is declared on the `containerapp` argument context in the CLI's command
module. That reasoning does not survive contact with the CLI:

```
$ az containerapp ingress update -n probe-app -g probe-rg --target-port 4000
ERROR: Please run 'az login' to setup account.
```

The flag belongs to the **ingress** command, which accepts it. The port is now set by a separate
`az containerapp ingress update` call, and the claim is removed rather than softened.

Note for the next reader: the CI workflow **never** passed this flag, so this defect was script-only.
A deploy run from CI would have got further than a deploy run from a laptop.

### 3.2 The health gate filtered on a property a revision does not have

```
[?properties.revisionSuffix=='dev-abc'].properties.healthState | [0]
```

The CLI's own `Revision` serializer declares exactly these keys:

`id`, `name`, `type`, `systemData`, `properties.createdTime`, `properties.lastActiveTime`,
`properties.fqdn`, `properties.template`, `properties.active`, `properties.replicas`,
`properties.trafficWeight`, `properties.provisioningError`, `properties.healthState`,
`properties.provisioningState`, `properties.runningState`.

`revisionSuffix` is not among them. It belongs to the `Template` model, which a revision nests at
`properties.template` — so the suffix is reachable, but not where the query looked. The filter matched
nothing, `$state` stayed empty, and the loop fell through to its own throw **whether or not the
revision was healthy**: the gate could not pass.

Worth stating because it is easy to get wrong in the other direction: `properties.fqdn`,
`properties.healthState` and `properties.trafficWeight` **are** correct, so the surrounding queries were
never the problem. The workflow's rollback capture, `[?properties.trafficWeight>=\`100\`].name | [0]`,
is right as written and was left alone.

The fix resolves the revision **by name** and then asks that one revision:

```
CONT=… revision list --query "[?properties.template.revisionSuffix=='$SUFFIX'].name | [0]"
CONT=… revision show --revision "$REVISION" --query "properties.healthState"
```

Reading the name back from the API rather than assembling `<app>--<suffix>` also removes an assumption
about the separator that three later steps were making independently (see §3.3).

### 3.3 `revision show --revision` takes the revision *name*

```
$ az containerapp revision show --help
    --revision [Required] : Name of the revision.
```

The script and the workflow both passed the **suffix**. The name is `<app>--<suffix>`, and the
workflow's own three later uses (`FQDN`, the traffic shift, the rollback) rebuilt that string by hand
in shell, each an independent place to get it wrong. The workflow now resolves the name once, in the
step that waits for health, and publishes it as a step output that the later steps consume.

### 3.4 `ingress traffic set` has no `--revision` and no `--weight`

```
$ az containerapp ingress traffic set -n probe-app -g probe-rg --revision probe --weight 100
ERROR: unrecognized arguments: --weight 100

$ az containerapp ingress traffic set --help
    --label-weight     : A list of label weight(s) … 'label_name=weight' format.
    --revision-weight  : A list of revision weight(s) … 'revision_name=weight' format.
                         For latest revision, use 'latest=weight'.
```

So the traffic shift never ran — and a detail that would mislead a reader who only glanced at the
error: **`--revision` was not rejected.** Argparse accepted it as an unambiguous prefix of
`--revision-weight`, so the old form was a parse error on `--weight` *and* had silently assigned a bare
suffix to the wrong option. A fix that only replaced `--weight` with `--revision-weight` and kept
`--revision` would have produced `--revision-weight probe` — accepted, and wrong.

Correct form, now used:

```
az containerapp ingress traffic set --revision-weight "<revision-name>=100"
```

This also corrects the rollback command printed at the end of a deploy and the same command in
`infra/README.md` §Rollback, which had the same shape.

### 3.5 The migration job's `--command` was one argument, not four

```
$ az containerapp job create --help
    --command : A list of supported commands on the container that will executed during startup.
                Space-separated values e.g. "/bin/queue" "mycommand".
```

`--command "npx prisma migrate deploy"` is a **list of one**, so the container execs a program whose
name is literally `npx prisma migrate deploy`. Note that the CLI *accepts* it — there is no parse
error, so this defect is invisible to the check that finds the other four and only shows up as a job
that fails at runtime. Both files now pass four tokens.

## 4. Where round 3 and the round-2 review disagreed

Recording this because two of the previous round's statements were made with confidence and are not
right, and a future reader should not inherit them:

- **"its deep check would refuse every rollback"** — correct, and now fixed (§5). The reasoning is
  worth keeping: the old check compared the newest *applied* migration to the newest *shipped* one, and
  after any forward migration a rolled-back image ships an older set, so the answer is `false` exactly
  when a rollback is being attempted.
- **"prod is set to two replicas, but the plan says not to run more than one until in-memory state is
  made safe"** — the second half is not in PLAN-030. That plan's cost table budgets "2 always-on
  replicas" for prod, so two was deliberate. The *concern* is real and documented elsewhere, and the
  code substantiates it (§7.1). The finding stands; its citation does not.

## 5. `GET /api/ready` — a gate that refused rollbacks

`migrationsApplied()` asked whether the newest migration in `_prisma_migrations` equalled the newest
migration the image ships, and returned `false` otherwise. Forward-only in effect: promote a new
revision, then roll back, and the older image reports `not-ready` with HTTP 503 — so the deploy script
and the workflow both refuse to shift traffic to the revision they are trying to restore. The gate is
there to permit that.

It now asks the question a rollback needs answered: **is anything this image ships missing?** Every
shipped migration must appear applied; extra rows in the database are not a failure. The
"could not tell ⇒ ready" behaviour for an unexpected layout is unchanged, and the doc comment on
`/api/ready` now says "every migration this image ships" where it said "the newest".

## 6. `trust proxy` — the caveat had gone stale, in both directions

Left unset, and behind Container Apps that means two wrong things at once: the rate limiter keys on
`req.ip`, so **every user shares one bucket**, and every audit row records the ingress's address instead
of the person's.

The reason it was left alone is recorded in `PlanDocs/PLAN-018-Dependency-and-Application-Security-Remediation.md`
line 80 — CVE-2026-90711 in `proxy-addr` <2.0.8 (IP spoofing), "**not exploitable today** — `trust
proxy` is not set … Upgrade before PLAN-016." Both halves are now out of date:

- It has been upgraded. `package.json` carries `pnpm.overrides: { "proxy-addr@<2.0.8": "^2.0.8" }` and
  `pnpm-lock.yaml` resolves **2.0.8**. The CVE is remediated, so the upgrade PLAN-018 asked for before
  this work has already happened, and setting `trust proxy` no longer arms anything.
- With the CVE gone, "unset" stopped being the safe choice. It is now simply the wrong one for this
  deployment.

Implemented as `TRUST_PROXY`, a **hop count**, defaulting to `0` — exactly today's behaviour, so a dev
machine and any proxy-less deployment are unchanged. `infra/main.bicep` sets it to `1` for the
Container Apps ingress, or `2` once `lockIngressToFrontDoor` puts Front Door in front of it, and it is
derived from that same parameter so the two cannot drift apart.

A hop count rather than `true`, deliberately: `true` believes any number of hops, which lets a caller
choose their own address by sending their own `X-Forwarded-For` — the spoof the count exists to
prevent, and `GET /api/auth/client-ip` is the route that would show the difference.

Because this changes how an integrator is rate limited and what the audit trail records,
`docs/API.md` §2.1, the curated description in `docs/api-operations.json`, the regenerated
`docs/openapi.yaml` and the route comment in `apps/api/src/routes/auth.ts` are all updated in the same
change.

## 7. Findings left as decisions

### 7.1 Production runs two replicas, and nothing elects a leader

`infra/params/prod.bicepparam` sets `minReplicas = 2`. Five background loops start unconditionally in
every process — `startWorkers()`, `startPoller()`, `startSnapshotPoller()`,
`startAlertMonitor()`, and `hydrateEmailConnectors()` — and there is no advisory lock, no leader
election and no instance identity anywhere in `apps/api/src`. So two replicas means two pollers, two
snapshot pollers, two alert monitors and two mail connectors over one database. Two prior notes already
record the underlying hazard for other subsystems: `PlanDocs/README.md` records that PLAN-002's
challenge store must move to a table "before more than one replica", and PLAN-016 §27 that CloudConnect
health memory is in-process, where "a restart forgets, replicas disagree".

It is left as it is, on purpose. PLAN-030's cost table prices two replicas, so this is a chosen
availability posture rather than an oversight, and trading it away is the operator's call. The two
honest options:

1. **Cap at one replica** (`minReplicas = 1`, `maxReplicas = 1`) until the in-memory state is shared —
   the conservative reading, at the cost of replacing HA with a restart.
2. **Keep two and make the loops safe** — one `pg_try_advisory_lock` leader, or move each loop's state
   into the database, which is what the three plan notes above already contemplate.

Recommendation: (1) before the first production data, (2) as the real fix, in that order.

### 7.2 `pgaudit` is configured on the server, but the extension is never created

`infra/main.bicep` lines 508–523 set `shared_preload_libraries = pg_stat_statements,pgaudit`,
`pgaudit.log = ddl,role` and `azure.extensions = pgaudit`. That is the server half. No SQL in this
repository runs `CREATE EXTENSION pgaudit`, so the extension itself does not exist in the
`c7ntax` database. `shared_preload_libraries` plus `pgaudit.log` is what produces the audit lines, so
the SOC 2 evidence in §2.6 is not wholly absent — but leaving the extension uncreated is not the state
the plan describes, and I could not test the difference without a server.

The remedy is one line and belongs with the database bootstrap that PLAN-030 §7 and §8.1 already defer
(creating `app_c7ntax`):

```sql
CREATE EXTENSION IF NOT EXISTS pgaudit;
```

Recorded here rather than shipped, because a migration that cannot be run against a server is a
migration whose failure mode is unknown, and `prisma migrate deploy` runs it on every environment.

### 7.3 The production rehearsal

Dev cannot demonstrate the closed Key Vault, zone-redundant HA, or the geo-redundant backup, because
each is a creation-time property (and prod-only). A one-time throwaway run of the prod parameter set,
torn down afterwards, is the only way to prove the template applies as written. Recommended before the
first real production deployment; not done here, as it needs a subscription and the operator's consent
to spend money.

### 7.4 A document cited five times that is not in the repository

`PlanDocs/PLAN-030-Review-of-Applied-Changes.md` is cited by `infra/README.md` line 27,
`PLAN-030-Review-Round-2.md` line 4, `PLAN-030-Response-to-Review.md` line 3,
`PLAN-030-Go-Live-Briefing.md` line 122 and `PLAN-030-Azure-Bicep-Go-Live-Hardening.md` line 12. It
does not exist on this branch, and `PLAN-030-Go-Live-Briefing.md` says it lives "on the branch that
produced it". A provenance note now stands in its place, so the five citations resolve and no reader is
left chasing a file that was never merged.

## 8. What still needs a subscription

None of the following was proven here, and none should be assumed by whoever reads the next deploy log:

- That the arguments are accepted **by a real resource group** — §2 proves parse, not success.
- The first-run two-pass create: pass 2 creating the app against the real image, and its first revision
  becoming healthy.
- The migration job's four-token command actually running `prisma migrate deploy` in the container, and
  the job reporting `Succeeded`.
- The three health checks answering 200 on a real revision.
- The Bicep compile, if the Bicep CLI is unavailable in the environment — see the note in §9.

## 9. Files changed

| File | Change |
|---|---|
| `scripts/azure/deploy-env.ps1` | §3.1–§3.5; the health wait now resolves and then reads one revision; the printed rollback command is corrected |
| `.github/workflows/deploy-azure.yml` | §3.2, §3.3, §3.4, §3.5; the resolved revision name is published as a step output and consumed by the three later steps |
| `apps/api/src/index.ts` | §5 subset semantics for `migrationsApplied()`; §6 `TRUST_PROXY` |
| `infra/main.bicep` | §6 `TRUST_PROXY`; two comments that named a command that does not exist |
| `infra/params/prod.bicepparam` | unchanged; §7.1 is a decision, not an edit |
| `infra/README.md` | the stale `--target-port` claim corrected; the rollback command corrected |
| `docs/API.md`, `docs/api-operations.json`, `docs/openapi.yaml` | §6 — the API document is part of the change |
| `PlanDocs/PLAN-030-Review-of-Applied-Changes.md` | created as a provenance note (§7.4) |

**Verification run for this change:** `generate-openapi.mjs` (469 operations), `check-api-docs.mjs`
(specification matches the routes), `check-route-guards.mjs` (472 routes), `check-encoding.mjs`,
`lint-design-tokens.mjs`, `check-help-links.mjs`, and `tsc --noEmit` for `apps/api` and `apps/web` —
all clean.

`scripts/azure/validate-bicep.mjs` **passes**, and it took a download to get there: `az bicep install`
truncated at 6.9 MB of ~124 MB, leaving a corrupt `bicep.exe`, so the standalone `bicep-win-x64.exe`
v0.48.1 was fetched directly. Against it, with the four deploy-time variables filled in as placeholders,
`infra/main.bicep`, `infra/params/dev.bicepparam` and `infra/params/prod.bicepparam` all compile **without
warnings** — which includes the `TRUST_PROXY` `env` entry added in §6. The templates are the part of this
package a subscription is still needed to exercise, and they now at least parse and type-check against the
schemas.
