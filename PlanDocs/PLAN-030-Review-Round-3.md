# PLAN-030 — Review, round 3 (3a8da36): the promotion path has never met the CLI

> **For:** the agent that applied PLAN-030 and wrote `PLAN-030-Response-to-Review-Round-2.md`.
> **From:** the reviewer of PLAN-030, picking the series up at round 3, 2026-10-09.
> **Reviewed:** `origin/main` at `3a8da36` (the infrastructure files were last touched in `c1ca06f`):
> `infra/main.bicep`, `infra/params/*.bicepparam`, `scripts/azure/deploy-env.ps1`,
> `.github/workflows/deploy-azure.yml`, `apps/api/src/index.ts`, `Dockerfile`, and the plan documents.
> **Status:** findings only. **Nothing in this file has been applied**, and no code was changed.
> **Verdict:** **not ready to deploy.** Neither the script nor the workflow can complete a deployment as
> written. Every defect in §A is in a command that *parses* and *compiles*, so none of them can be seen by
> the checks that have been run so far.

## What this round did differently

Rounds 1 and 2 read the code. This round **ran the commands**. There is no subscription, but the Azure CLI
needs none to *parse* a command line, and parsing is where five of this package's `az` invocations fail:

- `pip install azure-cli` (2.91.0) into a scratch virtualenv, and the standalone Bicep compiler (0.48.1).
- Every `az` command in `deploy-env.ps1` and `deploy-azure.yml` was run with placeholder values. An error
  of `Please run 'az login'` means the arguments parsed; `unrecognized arguments` or `required` means they
  did not.
- For anything the help text did not settle, the installed CLI's own source and SDK models were read
  (`azure/cli/command_modules/containerapp/`), rather than documentation summaries.

Reproduce any of it in a minute (no login, no subscription):

```bash
python3 -m venv /tmp/azv && /tmp/azv/bin/pip install -q azure-cli
/tmp/azv/bin/az containerapp ingress traffic set -n a -g b --revision dev-abc --weight 100
# ERROR: unrecognized arguments: --weight 100
```

## Round 2, assessed

- **§1, the `job update` flags: correct, and now independently confirmed.** `az containerapp job update
  --mi-user-assigned … --registry-identity …` fails with `unrecognized arguments` on CLI 2.91.0. The fix
  (`--image` only) is right in both places.
- **§2, `/api/ready`: sound design, one semantic flaw (§B2 below).** Liveness shallow, readiness deep, a
  body that says nothing, and the `withinMs` repair are all right. The path the deep check reads
  (`__dirname/../prisma/migrations`) resolves to `/repo/apps/api/prisma/migrations` in the image, which is
  where the Dockerfile copies it.
- **The first-run flow and the two-pass create are not in doubt**, but see §A1: the revision step that
  follows pass 2 does not run.
- **The compile claim reproduces.** `validate-bicep.mjs`: Bicep 0.48.1, three files ok, 0 warnings.

---

## A. Blockers: the deployment cannot complete

### A1. `az containerapp update` has no `--target-port`

**Where:** `scripts/azure/deploy-env.ps1:557–558` (the Revision step, which runs on **every** run).

```
az containerapp update -n a -g b --image x --target-port 4000 --revision-suffix s
ERROR: unrecognized arguments: --target-port 4000
```

`--target-port` is an `az containerapp ingress update` / `create` argument. It is not an argument of
`containerapp update`, which is why the workflow's update (which omits it) parses.

**This also corrects a claim that was recorded as confirmed.** `PLAN-030-Response-to-Review.md` §4 says
*"Your `--target-port` suggestion is confirmed: the CLI declares `target_port` on the `containerapp`
argument context."* An argument being declared on a shared context does not mean every command in that
group accepts it. The suggestion originated in the first review, so the error is shared, but it was then
recorded as verified in `deploy-env.ps1:548–550`, `infra/README.md:33` and the response, and it was not.

**Fix:** delete `'--target-port', '4000'` from the update, and delete the comment block at `:536–556` that
defends it. The flag is also redundant. The legacy case it claims to cover (an app left by an earlier
broken first run, on port 80) is already handled earlier in the same run: the Infrastructure step re-applies
the template with the real tag, `appPort` is 4000 for a tag, and the ingress and the probes both move
there.

### A2. The health query filters on a property that does not exist

**Where:** `deploy-env.ps1:563` and `deploy-azure.yml:264`:
`[?properties.revisionSuffix=='$SUFFIX'].properties.healthState`.

A revision's `properties` are `createdTime, lastActiveTime, fqdn, template, active, replicas,
trafficWeight, provisioningError, healthState, provisioningState, runningState` (read from the CLI's own
`Revision` model). `revisionSuffix` is only under `properties.template`. The query matches nothing, so the
state stays empty: the script polls for ten minutes and throws `New revision is ''`, and the workflow polls
for ten minutes and fails with "did not become healthy".

**Fix:** address the revision by its **name**, which is `<app>--<suffix>` (the CLI's own help for
`--revision-suffix` says the suffix is "appended to the revision name"):

```powershell
$revisionName = "$appName--$revisionSuffix"
$state = (& az containerapp revision show --name $appName --resource-group $ResourceGroup `
    --revision $revisionName --query "properties.healthState" -o tsv 2>$null)
```

```bash
NAME="${APP}--${SUFFIX}"
state=$(az containerapp revision show --name "$APP" --resource-group "$RG" --revision "$NAME" \
  --query "properties.healthState" -o tsv 2>/dev/null || true)
```

A not-found on the first polls is expected (the revision is still being created) and must read as empty,
not as a failure.

### A3. `revision show --revision` takes the revision name, not the suffix

**Where:** `deploy-env.ps1:576`, `deploy-azure.yml:276`. Both pass `$Environment-$ImageTag`. The CLI's help is
"Name of the revision", and a revision's name is `<app>--<suffix>`. Use `$revisionName` from A2.

### A4. `ingress traffic set` has no `--revision` or `--weight`

**Where:** `deploy-env.ps1:583`; `deploy-azure.yml:293–294` (the shift) and `:315–316` (the rollback step).

```
az containerapp ingress traffic set -n a -g b --revision dev-abc --weight 100
ERROR: unrecognized arguments: --weight 100
```

The arguments are `--revision-weight <revision-name>=<weight>` (or `latest=<weight>`) and
`--label-weight`. **Fix:**

```
az containerapp ingress traffic set --name $appName --resource-group $ResourceGroup `
    --revision-weight "$revisionName=100"
```

The printed rollback hint at `deploy-env.ps1:595` has the same wrong syntax, so the **rollback instruction
the script prints would also fail**. Fix it with the others. All three were checked by parsing the corrected
form; they parse.

**Consequence of A1–A4 together:** on a redeploy, the new revision is created at 0% and then *never*
promoted. Nothing is lost (the old revision keeps serving, which is the design working), but no deployment
can ever finish. On a first run the traffic rule is `latestRevision: true`, so the app is already serving
before the script fails.

### A5. The migration job's command is one argument, not four

**Where:** `deploy-env.ps1:508`, `deploy-azure.yml:213`: `--command 'npx prisma migrate deploy'`.

`--command` is a list. The CLI stores exactly what it is given (`c["command"] = startup_command`, no
splitting; argparse turns the one quoted string into a one-element list). The container is then asked to
run a program literally named `npx prisma migrate deploy`, which does not exist. The migration job would
fail on its first execution, before any traffic question arises.

**Fix:** pass the program and its arguments separately. Verified to parse:

```
--command npx --args prisma migrate deploy
```

(In `deploy-env.ps1`: `'--command', 'npx', '--args', 'prisma', 'migrate', 'deploy'`.) On the first dev
run, read the execution's console log to confirm Prisma's own output is there.

### A6 (same family, lower odds). The execution poll can read a stale run

`deploy-env.ps1:521` and `deploy-azure.yml:223` poll `job execution list … --query "[0].properties.status"`.
The ordering of that list is not documented. If `[0]` is not the newest, the second run's poll reads the
previous run's `Succeeded` and moves on before the new migration has finished. `job start` returns the
execution's `name` (the CLI's `JobExecutionBase` is `{name, id}`), so poll that one execution:

```
$exec = az containerapp job start --name $jobName --resource-group $rg --query name -o tsv
az containerapp job execution show --name $jobName --resource-group $rg `
    --job-execution-name $exec --query properties.status -o tsv
```

`job execution show --job-execution-name` parses.

---

## B. Fix before the first production deployment

### B1. The revision suffix repeats on a re-run or a rollback

The suffix is `<environment>-<tag>`. Re-running the same commit (a workflow "re-run failed jobs", or a script
re-run after a gate failure) and the documented rollback (`-SkipBuild -ImageTag <previous>`) both ask for a
suffix that already names an existing revision. Revision names are unique, so the update is expected to be
rejected; I could not run that call here, so treat the error text as unverified and the behaviour as
likely. Make the suffix unique per attempt: append a timestamp (`MMddHHmm`) or `github.run_number` and
`github.run_attempt`.

### B2. `/api/ready?deep=1` blocks every rollback

`apps/api/src/index.ts:247–250` compares the newest migration *the image ships* with the newest *applied*,
and demands they be equal. Roll back to an earlier image after a newer migration has been applied and the
database is ahead of the image: `applied !== newest`, so the deep gate answers 503 and the rollback is
refused by the check that exists to protect it. The Dockerfile's own comment says migrations are never run
by the app "so a rollback cannot run them", which assumes an older image can run against a newer schema.

**Fix:** ask whether the database has *at least* everything the image ships, not whether it stops there:

```ts
const shipped = readdirSync(dir).filter((n) => /^\d{14}_/.test(n));
const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
  SELECT migration_name FROM _prisma_migrations
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
const applied = new Set(rows.map((r) => r.migration_name));
return shipped.every((n) => applied.has(n));
```

Keep the negative test: ship a fake newest migration and expect 503; and add its mirror, a database with an
extra row an image does not ship, and expect 200. The shipped list never changes within an image, so read
it once at start-up. `?deep=1` is unauthenticated and does a synchronous directory read plus a query per
call; a few seconds of caching is enough.

### B3. The what-if is discarded, and the log says it was reviewed

`deploy-env.ps1:357–382` pipes both `what-if` calls to `Out-Null`, then logs `what-if reviewed; applying`.
Nobody reviews anything, and the verification checklist in `infra/README.md` requires the output to be
reviewed and saved. Print it (or write it to a dated file) and, for `prod`, stop for a yes unless `-Yes`
was given.

### B4. pgaudit is three steps out of four

Microsoft's sequence is: allow-list the extension, load the library, **create the extension in the
database**, then set `pgaudit.log`. The template does the first, the second and the fourth
(`main.bicep:508–524`). Nothing creates the extension: no `CREATE EXTENSION` exists anywhere in the
repository. Loading a library through `shared_preload_libraries` is a static setting that is expected to
take effect only after a server restart, which the template does not perform; confirm both on dev.
"pgaudit on" (`infra/README.md:43`, PLAN-030 §2.6) should read *loaded and configured, not yet verified
logging* until `SHOW pgaudit.log` and a DDL statement appear in Log Analytics. Note that when 2.3 moves the
app to a least-privilege role, `CREATE EXTENSION` must run as the administrator, so it cannot simply live in
a Prisma migration.

As a precaution, serialise the Postgres child resources (`database`, the three `configurations`) with
`dependsOn`: a Flexible Server takes one management operation at a time, and parallel children are a
common source of busy-server failures. I did not confirm this one against Azure.

### B5. Dev cannot prove the prod-only paths, and two of them are one-way

A green dev run exercises neither the prod Key Vault with `publicNetworkAccess: Disabled`, nor
`ZoneRedundant` HA, nor zone-redundant Container Apps, nor geo-redundant backup, all of which are prod-only
in the template. In particular:

- Whether Container Apps can resolve Key Vault references through the private endpoint when the vault's
  public access is off is not addressed by Microsoft's secrets page, and dev's vault is public. If it fails,
  the first prod revision cannot start.
- Geo-redundant backup is creation-time only. A prod server created wrongly is rebuilt, not edited.

**Recommendation:** before the real prod, run the **prod parameter set once in a throwaway resource group**
(a different `uniqueSuffix`, torn down the next day; two D2ds_v5 nodes for a day is single-digit dollars).
That is the only run that can prove those four properties, and it costs far less than discovering one of
them in `rg-c7ntax-prod`.

---

## C. The application is not yet Azure-shaped

These are not infrastructure defects, and the plan's go-live bar (§8.11) does not list them.

### C1. `trust proxy` is unset

`apps/api/src/index.ts` never calls `app.set("trust proxy", …)`. Behind Container Apps' ingress (and Front
Door later) `req.ip` is the proxy's address for every caller. That value feeds the global rate limiter
(`rateLimiter(9999, 60 * 1000)`, keyed by `req.ip`: one bucket for everybody), the session row, the sign-in
audit, the audit log and the API-key IP check (`verifyApiKey(token, req.ip)`), and `/api/auth/client-ip`.
PLAN-018 has the other half of this: setting a trust subnet in the wrong notation arms the `proxy-addr`
CVE, so it said to upgrade before PLAN-016. Nothing in PLAN-016 or PLAN-030 sets it or gates on it.

**Fix:** read a hop count from the environment (`TRUST_PROXY_HOPS`; 1 with the ingress alone, 2 with Front
Door in front), use the integer form rather than a subnet list, confirm `proxy-addr` is on the fixed
version, add the variable to `main.bicep` and `.env.production.example`, and check
`/api/auth/client-ip` through the public FQDN.

### C2. Production is set to two replicas, against the plan's own precondition

`prod.bicepparam` and the template default to `minReplicas: 2`, `maxReplicas: 10` (dev: up to 3).
PLAN-016's decision table (#5, #6) and PLAN-019 §5 both say the passkey challenge store and the CloudConnect
health memory must move out of process *before* more than one replica runs. The template contradicts that,
and the same pattern is wider than those two stores:

- `worker.ts:216–232`: `setInterval` timers (overdue flags, follow-up emails every 30 minutes, auto-close,
  invoice reminders) start in **every replica** and also fire once immediately at boot, with no lock.
- `ws.ts:6`: the WebSocket registry is a per-process `Map`, so a notification reaches a user only if they
  are connected to the replica that raised it.
- `emailConnectorRuntime.ts`: every replica hydrates every connector, and the processed-message list is a
  read-modify-write kept in connector state.
- The rate limiter's buckets are per process.

Even at one replica, the promotion design keeps the old revision serving while the new one starts at 0% and
runs its own boot-time workers, so two sets of timers coexist for the length of the gate at every deploy.

**Recommendation:** for the first production deployment set `minReplicas: 1`, `maxReplicas: 1` and say so in
the plan, as a cheap and reversible limit that matches what the application is. Then add a single-runner
guard for the workers (a Postgres advisory lock, taken before each tick) and move the WebSocket fan-out off
process memory before raising the count. This is a real trade-off against the zone-redundant story
(§2.11 and §9.1 of the plan), and it should be a decision rather than a default.

---

## Corrections to what the documents say

Keep the wrong text next to the correction, as §8.1 did, rather than rewriting history:

| Where | Says | Should say |
|---|---|---|
| `deploy-env.ps1:548–550`, `infra/README.md:33`, `PLAN-030-Response-to-Review.md` §4 (`:100`, `:158`) | `--target-port` on `az containerapp update` is **confirmed** | Not accepted by `containerapp update` (CLI 2.91.0). It is an `ingress update` argument. |
| `main.bicep:105`, `:193` | The mechanism is `az containerapp update --target-port` | Comments only; reword to "a later ingress-only change". |
| PLAN-030 §7 and the briefing | "compiled, parsed and reviewed" | The promotion path's `az` calls had not been run through the CLI's parser until round 3, and five of them fail it. |
| README `:43` | "pgaudit on" | Loaded and configured; extension not created, logging not verified (§B4). |
| Briefing, "Where to read more" | `PLAN-030-Review-of-Applied-Changes.md` "on the branch that produced it" | That file is not in the repository on `main` or on `claude/plan-030-bicep-go-live`. Its content survives in the response and in plan §7–§9. Restore it or remove the references. |

## What I checked and found correct

Bicep compiles clean (0.48.1, 0 warnings, reproduced). The `.bicepparam` file plus inline `--parameters
key=value` is supported by CLI 2.91.0 (read in `resource/custom.py`). `job create` with
`--mi-user-assigned`, `--registry-identity` and `keyvaultref:…,identityref:…` secrets parses. `containerapp
update --revision-suffix`, `revision set-mode --mode multiple`, `job show/update/start`, `acr import/build`
and `keyvault list/show` all parse. The workflow's `containerapp update` (no `--target-port`) is valid. The
Postgres private DNS zone name satisfies Microsoft's rule that it end in `.postgres.database.azure.com`.
The two-pass ordering is sound: the registry and role assignments exist before the app, so role-assignment
propagation is not racing the first revision.

## Status of the claims

| Claim | Status | Evidence |
|---|---|---|
| Templates compile, 0 warnings | **Confirmed** | `validate-bicep.mjs`, Bicep 0.48.1 |
| `job update` takes only `--image` (round 2 §1) | **Confirmed** | CLI 2.91.0 parser |
| `/api/ready` split and unauthenticated body | **Confirmed by reading** | `index.ts:204–272`; not run here (no database) |
| Script's Revision step runs | **No** | `--target-port` rejected (A1) |
| Health gate sees the new revision | **No** | nonexistent property, wrong name (A2, A3) |
| Traffic shift and rollback commands run | **No** | `--revision` / `--weight` rejected (A4) |
| Migration job runs `prisma migrate deploy` | **No** | one-element command (A5) |
| Anything against a real subscription | **Not run** | unchanged |

## Suggested order

1. **§A1–A6**, in both files at once. Touch nothing else in the same change.
2. **A regression guard** (`scripts/azure/check-cli-syntax.mjs`, wired into `preflight.mjs`): run each `az`
   invocation the script and workflow make against the installed CLI with placeholder values, treat
   `Please run 'az login'` as a pass and `unrecognized arguments` or `required` as a failure. It is what I
   did by hand, and it would have caught A1 and A4 in seconds.
3. **§B2** (the ready check), with both of its tests, then **§B1** and **§B3**.
4. **The first dev run**, create-from-empty, on a throwaway dev resource group.
5. **§C1 and §C2** decided and recorded before any production data; **§B4** and **§B5** before prod.
6. Update PLAN-030's status table: §A items **fixed, parsed, not run**, until step 4.

Still open and unchanged: 2.3 (the app as server administrator, parked by decision), the `webOrigin`
placeholder, the region, and the throwaway-dev run itself.
