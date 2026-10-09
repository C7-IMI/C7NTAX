# PLAN-030 — Response to the review of the applied changes

> **For:** the author of `PLAN-030-Review-of-Applied-Changes.md`.
> **From:** the agent that applied PLAN-030 and wrote §7–§9 of the plan.
> **Re:** your seven findings against `bda54ed`.
> **Status:** findings **1–6 applied**; finding 7 accepted and deliberately not applied yet, with the
> plan of record below. This file is the reply; the change itself is BuildNotes `2026.10.9.002`.

Thank you — this is a better review than my own §8 was, and two of the findings change decisions rather
than wording. Taking them in your order.

---

## 1. Geo-redundant backup — **accepted, and you are right about the direction**

**Applied.** `postgresGeoRedundantBackup` now defaults to `environment == 'prod' ? 'Enabled' : 'Disabled'`,
the comment at `infra/main.bicep` states the creation-time constraint as fact rather than as a *(verify)*,
and §9.1/§9.3 say the same. Off in dev, on in prod.

**Where my reasoning went wrong, because it is worth writing down.** I argued there was "nothing to
restore *to*" in the paired region, so the backup bought a recovery this package cannot perform. That
treated the compute as the scarce thing. It is not: the VNet, the Container Apps environment, the vault
and the registry are all Bicep — the template *is* the compute — and a redeploy into the paired region is
an afternoon's work. **The data is the only thing that cannot be re-created from the repository**, and a
geo-redundant backup is the only copy of it that outlives the region. I had the scarcity backwards, and
because the setting is one-way at creation, the mistake would have been permanent: it would have taken a
new server and a data migration to undo. Thank you for the citation; I have recorded it as confirmed
rather than needing a subscription to check.

One consequence worth stating for whoever reads this later: **enabling it is a cost line, not a feature.**
At 128 GB it is roughly $10–30/month, and it buys a restore that nothing in this repository can currently
perform by itself. That is the correct trade — it is the precondition for ever writing a DR plan, not the
DR plan — but it should be listed as such so nobody later "saves" it again.

## 2. The `SameZone` claim — **accepted; the error was mine and it was worse than a wording slip**

**Applied**, in all six places: the `@description` on `postgresHaMode`, §4's table row, §8.5, §9.1, §9.2
and §9.4. Every reference now reads:

> **ZoneRedundant** — ×2 compute, survives the loss of an availability zone.
> **SameZone** — ×2 compute, survives a host failure only.
> **Disabled** — ×1 compute, no standby.

And §9.2/§9.4's reservation sizing now covers **×2 the SKU for either HA mode**, and ×1 only for
`Disabled`.

**This one deserves the plain admission.** I wrote "`SameZone` halves the compute (~$130/mo)" as an aside
while describing a parameter, and I did not check it. It is wrong: `SameZone` still provisions a standby,
and a standby is billed. I invented a saving that does not exist, in the one place a reader is most likely
to act on it — someone choosing `SameZone` to save money saves nothing and gives up zone resilience, and
the reservation maths that number fed would have under-reserved by half. An unverified figure next to a
parameter is worse than no figure: it reads as knowledge, and it is the kind of thing that gets a
purchase order signed.

## 3. The CI migration step — **accepted; it was a defect, not a decision**

**Applied.** `.github/workflows/deploy-azure.yml` now mirrors `deploy-env.ps1`: it reads the app's
user-assigned identity, passes `--mi-user-assigned` and `--registry-identity`, passes `DATABASE_URL` as a
`keyvaultref:` secret with `identityref:`, and creates-or-updates the job rather than only creating it.

You are right that filing it under "still your call" was wrong. I had it on my own list from the first
pass — I noted the workflow used `--mi-system-assigned` and no `DATABASE_URL` — and then treated it as
out of scope because the file was not in the set I had been pointed at. But a step that fails on every
push to `main` is not a decision anybody makes; it is a broken build. The distinction I should have drawn
is *"out of my file list" ≠ "not mine to fix"*, and the honest version of that note would have been a
one-line fix rather than a paragraph of caveat.

## 4. The bootstrap image cannot pass the probes — **accepted, option (a) implemented, and it is not enough**

**Applied, with a caveat that I think matters more than the fix.** `var appPort = contains(imageTag, '/') ? 80 : 4000`
now drives the ingress `targetPort` and every probe port, and the script moves the port back to 4000 when it
swaps in the real image. Your diagnosis is right: the bootstrap image is exactly the thing that exists to
make the first `-Create` run succeed, and it was the thing that would have made it fail.

**But option (a) does not get a first run through, and here is the mechanism.** A probe's `port` is a
**required field of `HTTPGet`** in the Container Apps REST spec, and probes live in the **revision
template** — not in the ingress. `az containerapp update --target-port` moves the ingress only. So on an
environment's first run:

1. Bicep creates the app on port 80 with probes on port 80 (the fix working as intended);
2. the script swaps in the real image and moves the ingress to 4000 — and the revision it creates inherits
   the **probes from the last deployment**, which are still on port 80, where the real application is not
   listening;
3. the script's health gate sees the revision go `Unhealthy` and throws.

That is better than failing at creation — traffic never moves, and the guard does its job — but the first
`-Create` run still does not finish. **Your option (b) is the correct fix**: deploy everything except the
app, build into the new registry, then create the app with the real tag so it is only ever created against
a port the application actually listens on. I have not implemented it here, deliberately: it means a
condition on the `containerApp` resource and a second Bicep pass, and anything in pass 1 that references
the app (the migration job, the Front Door origin) has to tolerate its absence. That is a flow change
rather than a correction, and it deserves a real dev-resource-group run rather than a second blind edit. It
is recorded as the first item to resolve before the first production deployment.

**One more thing in the same area, unverified but likely:** the quickstart image is a static-file server,
and ACA treats only 2xx–3xx as probe success. Even with the port right, `/api/health` would 404 on it. If
option (b) is taken this disappears, because the app is never created against that image at all — which is
another argument for (b) over (a).

**Your `--target-port` suggestion is confirmed**, incidentally: the CLI declares `target_port` on the
`containerapp` argument context (`arg_group 'Ingress'`), so no fallback is needed and I removed the
`verify` note I had put there.

## 5. Omitting `traffic` — **accepted; your fix is strictly better than my omission**

**Applied.** `param activeRevision string = ''` with
`traffic: empty(activeRevision) ? [ { latestRevision: true, weight: 100 } ] : [ { revisionName: activeRevision, weight: 100 } ]`,
and the script reads the serving revision with
`az containerapp revision list … --query "[?properties.trafficWeight==\`100\`].name | [0]"`.

I removed the `traffic` block to stop every Bicep run handing 100% to a brand-new revision before the
health gate had looked at it — the failure you describe in step 3 is the same failure from the other
direction, and I traded a known-bad outcome for an undocumented reliance on what an absent field means. I
should have known better, because the principle was already in the file: `imageTag` has no default
precisely so nothing about the running state is implied. **An omitted field is not a decision; it is an
assumption**, and restating the serving revision explicitly is the same fix applied consistently.

One ordering detail that your version needs to get right, and that I have made explicit in the script:
read the serving revision **before** creating the new one. Read it afterwards and you record the revision
you just created, which is the one thing the gate exists to keep at 0% until it has been checked.

## 6. The DNS-zone comment — **accepted; conclusion kept, reason corrected**

**Applied.** The comment now reads as you suggested: any zone ending in `.postgres.database.azure.com`
works, and this name is kept because a VNet-injected server never takes a private endpoint, so nothing
competes for it. The "DO NOT rename / resolves nowhere" warning is gone.

I had the right answer and the wrong rule: I knew the zone had to match something and reached for "the
server's own FQDN" when the actual rule is the suffix, and I invented a collision that cannot arise
because a VNet-injected server cannot have a private endpoint at all. A comment that states a rule
incorrectly is worse than one that states nothing, because the next person cites it.

## 7. 2.3, the least-privilege database role — **accepted, not applied, and why**

Agreed on the substance and on the timing: the app connects as the server administrator, it is the one
High item left, and after production holds data it becomes a credential rotation as well as a code change.
It is not applied here for one reason: **the role has to be created on the server, and no server exists
yet.** It needs a subscription, the first deployment, then a role and a grant, then `DATABASE_URL` moved to
that login — and doing it before there is a server to do it on is not work, it is a plan. It is the first
item after the first deployment, and §8.1 of the plan now says so with your standard: an `app_c7ntax` role
owning the **`public` schema of the `c7ntax` database**, no server-level rights, used by both the app and
the migration job. *(Two corrections landed here after this reply was written, both in §8.1 rather than in
your review: the database is not a schema — see the addendum below — and it is no longer called
`c7_overwatch`.)*

---

## On the two `(verify)` markers and the status line

Your closing instruction — record what is confirmed against a subscription versus only compiled — is
applied to the plan's status line. The current position:

| Item | Status |
|---|---|
| The creation-time constraint on geo-redundant backup | **Confirmed** from Microsoft's documentation |
| `SameZone` costs the same as `ZoneRedundant` | **Confirmed** by pricing documentation; the earlier claim was wrong |
| The quickstart bootstrap image listens on port 80 | **Confirmed** (the image is documented as serving on 80) |
| `az containerapp update --target-port` moves the ingress port | **Confirmed** — the CLI declares `target_port` on that command |
| **That the first `-Create` run completes** | **No — expected to still fail at the promotion step.** Probes live in the revision template, so the port fix moves the ingress and leaves the probes on the bootstrap image's port. Recommended fix: deploy everything except the app, build into the registry, then create the app with the real tag. See §4 of the response document. |
| The bootstrap image's probe *path* | **Unverified, and likely a second failure** — it is a static-file server, so `/api/health` probably 404s and ACA counts only 2xx–3xx as success |
| Whether omitting `ingress.traffic` resets it | **No longer a question** — the field now states the serving revision explicitly |
| The workflow's identity and secret wiring | **Compiled and reviewed, not run** — CI has not executed since the change |

## What I did not do

- **I did not merge your branch or copy your review into `main`.** It is a review of a specific commit
  range and it belongs with the branch that produced it; the maintainer will decide whether it should sit
  in `PlanDocs` alongside the plan. Everything in it that needed acting on has been acted on.
- **I did not touch the four items in §8 of the plan that are still open by choice** — the private ACR in
  prod, secret expiry, `sslmode=verify-full`, and D1–D4. Those are decisions for the maintainer, and your
  findings did not change them.
- **I did not renumber or rewrite anything else in the plan's text** beyond §2's corrections and the
  status line, so the diff of the plan is readable as "what this review changed".

---

## Suggested order, as asked

Your order is the one I followed, with one adjustment: **§2 landed in the same commit as §1** rather than
after it. They are both text-and-default changes in the same two files, and §2's figure feeds §1's cost
comment, so splitting them would have left a commit whose comment quoted a number the next commit changed.

---

# Addendum, 2026-10-09 — what happened after this reply

Four things, one of which is a correction to **the plan** rather than to your review. Filed here so the
reply and the work do not diverge.

## 1. §4's option (b) is implemented (plan §8.13)

You were right that option (a) does not get a first run through, and I recorded then that (b) — build
first, create the app only against the real image — was the correct fix while deliberately not
implementing it, because a flow change wants a real run rather than a second blind edit. It is now
implemented, with the caveats written into the plan rather than argued away:

- The app is created **once, against the real image**, in two passes: pass 1 `createApp=false` (everything
  else, the registry above all), the image build, then pass 2 `createApp=true` with the tag just built. The
  probe-port hand-off cannot happen because there is no hand-off. From pass 2 the run continues through the
  same migration, revision, gate and traffic steps every later deployment uses.
- `infra/main.bicep` gained `param createApp bool = true` and a conditional app resource. The app is
  referenced in exactly **three** places in that template — its declaration, the `containerAppFqdn` output
  (now `createApp ? … : ''`) and a comment — because there is no Front Door module and no migration job in
  this file. I had assumed otherwise when I deferred this; the change is smaller than I said it would be.
- **Three things a reader should not assume.** Nothing has been run against ARM. Pass 1 depends on the
  default *incremental* deployment mode — a `Complete`-mode deployment with `createApp=false` would delete
  the app, which is now a comment beside the call. And **on a first run the health gate does not hold the
  revision at 0%**: that guarantee comes from the template restating the *serving* revision, and on a first
  run there is nothing serving to restate, so the app's first revision takes traffic and is then checked.
  Nothing that was working is at risk, but the property belongs to redeploys and should not be claimed for
  first runs.

## 2. The database is renamed `c7ntax` (plan §8.12)

`c7_overwatch` is a product this one absorbed. The name was corrected in the template (as one parameter,
`databaseName`, used by both the database resource and the `DATABASE-URL` secret), the `.env` example, the
plan and the local development instance. The operator's question was whether a database should instead
carry a random name; the answer recorded in §8.12 is no, and the reason is the useful part: a database name
is an **identifier, not a control** — reaching the server needs network reach and a credential, the name is
printed in every connection string and diagnostic log the moment it is used, and `pg_database` is readable
by anyone who can connect at all. The protections that matter are the private network, authentication
without a stored password, the least-privilege role this reply's §7 discusses, TLS verification and
`pgaudit`. Obscurity, meanwhile, is paid for in an incident: in a restore, the name is one of the few
things you need *before* you can read anything.

## 3. A correction to the plan's §8.1, found while preparing that work

§8.1 said to create the role with `CREATE SCHEMA c7_overwatch AUTHORIZATION app_c7ntax`. **That is wrong,
and following it would have produced an application with no rights to its own data.** `c7_overwatch` was
the **database**, not a schema, and the app's tables live in **`public`** — Prisma is handed a plain
`DATABASE_URL` with no `?schema=`, and the local one carries `?schema=public` explicitly. Following that
instruction literally would have created a second, empty schema beside the real one while the app went on
reading `public`, where it would have held no grants: a permissions mystery whose most likely reading
would have been "Prisma is broken". §8.1 and the 2.3 row now say to own the `public` schema of the
database, with the wrong instruction kept alongside the correction so the two can be read against each
other. Your review did not raise this; it is my error, of the same family as the `SameZone` figure — a
concrete-sounding instruction that nobody had executed.

## 4. 2.3 is deferred by decision, not by drift (plan §8.11)

The operator has parked the least-privilege role for now. It stays the **last High item on the bar**,
marked as a decision rather than an open finding, and it should be read next to §8.1's correction: whoever
picks it up inherits the corrected SQL rather than the version that would have quietly broken the
application's access to its own tables. It cannot be done before the first deployment in any case, because
the role is created on a server that does not exist yet.

## 5. One more thing for the go-live checklist, found while reading production's parameters

`infra/params/prod.bicepparam` sets `webOrigin = 'https://app.c7ntax.example.com'`, and the template passes
that value as **both `WEB_ORIGIN` and `CORS_ORIGIN`**. Per the deployment's own environment example, those
"gate CORS **and every redirect the app builds** (SSO callback, desktop hand-off, reset links)". A
production deployment with that placeholder would therefore block browser calls from the real origin and
put a dead hostname into password-reset and notification links. I did not invent a replacement — that is a
value only the operator has — but it is now a named must-confirm item in the briefing, rather than a value
that looks finished because it is spelled correctly.
