# C7NTAX on Azure — deployment package (PLAN-016)

Everything needed to run C7NTAX in Azure: one image, two environments, schema migration
through the pipeline, and an ingress layer that is added before the first production
cut-over. Dev and prod run the **same image** with different configuration, which is what
makes "verify in dev, then promote" meaningful.

**The path is sync to GitHub → push to dev → push to production.** Work continues on
dev; production receives only what dev has already run, promoted by tag rather than
built again. PLAN-016 §16 is the full description of that model.

> **Status:** the package is built and validated as far as this workstation allows —
> the container image was built and run against the dev database, the Bicep templates
> compile with no warnings, the PowerShell deploy script parses and its plan mode runs
> end to end (both the dev and the promotion path), and both workflows parse. **Nothing
> has been deployed**: there is no Azure subscription attached yet (`az` is not installed
> here), so the first run is a bootstrap that must be done interactively and reviewed with
> `what-if`.
>
> **PLAN-030 (go-live hardening) is applied to the templates.** The deployment blockers and the
> security items that do not need an application change are in `infra/main.bicep`,
> `scripts/azure/deploy-env.ps1` and this file. Three things the first `what-if` has to confirm are
> called out where they land: the Consumption workload profile on a delegated subnet, a
> zone-redundant Container Apps environment in prod, and the Postgres server parameters. What was
> deliberately *not* changed is in **Notes and known gaps**.
>
> **The review of that work is applied too** (`PlanDocs/PLAN-030-Review-of-Applied-Changes.md`, §1–§6;
> §7, the least-privilege database role, is tracked separately). Prod's Postgres is now **created with
> geo-redundant backup** — a creation-time-only property, so it is only settable on the first
> deployment — the bootstrap image's port is handled, ingress `traffic` restates the serving revision
> instead of being omitted, and the pipeline's migration step uses the app's user-assigned identity.
> Two things only a subscription can settle: whether the bootstrap image answers the probe's path on
> port 80, and the port hand-off on the first `-Create` run — a probe's `port` belongs to the revision
> template, so the ingress port moves and the probes do not until the next Bicep run. Review §4's
> option (b) — create the app only against the real tag — avoids the hand-off altogether and is the
> cleaner fix.
>
> **Correction (round 3).** This section used to say the script's `--target-port` was "confirmed
> against the CLI's own command module". It was not, and `az containerapp update` rejects it:
> `ERROR: unrecognized arguments: --target-port 4000`. The port is set by a separate
> `az containerapp ingress update --target-port 4000`. See `PlanDocs/PLAN-030-Review-Round-3.md`.

## What is in the package

| Path | What it is |
|---|---|
| `Dockerfile`, `.dockerignore` | One image: the API on port 4000 **and** the built SPA from the same origin. Non-root, healthcheck, locked install. |
| `infra/main.bicep` | VNet, subnets and NSG, Log Analytics, Key Vault (+ the three secrets, a private endpoint and a private DNS zone), ACR, PostgreSQL Flexible Server (VNet-injected, no public endpoint, pgaudit on), Container Apps environment and app, and the *user-assigned* identity with its `AcrPull` and `Key Vault Secrets User` grants. |
| `infra/params/dev.bicepparam`, `prod.bicepparam` | Per-environment sizing: dev is Burstable, single-zone, 7-day backup; prod is General Purpose, zone-redundant HA, 35-day backup with geo-redundant copies. The secret values are read from the deploying shell's environment (`readEnvironmentVariable`), so a run that is missing one fails while the deployment is compiled rather than writing an empty secret into Key Vault. |
| `infra/env/.env.production.example` | Every environment variable the API reads, with the ones that must be set in Key Vault called out. |
| `scripts/azure/preflight.mjs` | Fails before a deploy does: stale lockfile, missing migration, undocumented env var, unguarded route, new advisory, non-root image — and a template that could move the running image or the traffic (an `imageTag` default, an `activeRevision` the script does not pass, a revisions mode that is not `Multiple`). |
| `scripts/azure/deploy-env.ps1` | The local push tool: preflight → infrastructure → image → schema → 0%-traffic revision → health gate → traffic shift, with `-WhatIf`, `-Create` and `-PromoteFrom`. |
| `.github/workflows/deploy-azure.yml` | CI/CD: build once, deploy **dev** on every push to `main`; a prod dispatch **promotes the tag dev is running** (copying the image between registries) instead of building, so prod only ever receives an artifact dev has served. Prod runs only from a manual dispatch, behind the `prod` environment's reviewers. |
| `.github/workflows/security.yml` | The gate from PLAN-018: route guards, typechecks, the dependency baseline, gitleaks, trivy. |
| `apps/api/prisma/migrations/0_init` | The schema baseline. Production schema moves with `prisma migrate deploy`, never `db push`. |

## One-time setup (before the first deployment)

These steps need a subscription and are done once by someone with owner rights. Replace
`<...>` as you go.

### 1. Resource groups (one per environment)

Both environments are created up front, each in its own group. Bicep creates everything
*inside* a resource group, but not the group itself — `deploy-env.ps1 -Create` does that
(step 3).

```powershell
az group create --name rg-c7ntax-dev  --location eastus2
az group create --name rg-c7ntax-prod --location eastus2
```

The two groups are independent: each environment gets its own registry, PostgreSQL server,
Key Vault, Container Apps environment and app. Nothing is shared but the deploy identity
below.

### 2. A deploy identity that cannot do anything else

The pipeline authenticates with GitHub's OIDC token — there is no client secret to rotate
or leak. Scope the identity to what a deployment needs and nothing more:

```powershell
az ad app create --display-name "c7ntax-deploy" --query appId -o tsv     # -> <client-id>
az ad sp create --id <client-id>
# Contributor on the two resource groups only (not the subscription)
az role assignment create --assignee <client-id> --role Contributor --scope /subscriptions/<sub>/resourceGroups/rg-c7ntax-dev
az role assignment create --assignee <client-id> --role Contributor --scope /subscriptions/<sub>/resourceGroups/rg-c7ntax-prod
# Plus AcrPush on both registries, so the pipeline can push on dev and copy the image
# across registries when it promotes to prod (a promotion is an `az acr import` between
# the two, which needs push on the target and pull on the source)
```

Add the federated credentials for the two workflows (replace the repository and branch):

```powershell
az ad app federated-credential create --id <client-id> --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:C7-IMI/C7NTAX:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"] }'
az ad app federated-credential create --id <client-id> --parameters '{
  "name": "github-prod-env",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:C7-IMI/C7NTAX:environment:prod",
  "audiences": ["api://AzureADTokenExchange"] }'
```

Then in GitHub → Settings:

- **Secrets** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
- **Environments** `dev` and `prod`; add required reviewers to `prod` so the production
  deployment is a deliberate action, which is the "Push to Prod" gate.

### 3. First deployment, in order — both environments

Create **dev first, then prod**. Dev has to exist before prod can be promoted from, and
each environment's first run is the only one that needs `-Create`:

```powershell
# 1. Preview what will be created — read this list before applying it.
./scripts/azure/deploy-env.ps1 -Environment dev -WhatIf

# 2. Export the secrets for this shell (they go into Key Vault, never into a file). The names are
#    the ones the parameter file reads; PG_ADMIN_PASSWORD is still accepted as an alias.
$env:POSTGRES_ADMIN_PASSWORD = '<generated>'
$env:JWT_SECRET_VALUE        = '<openssl rand -base64 48>'
$env:KUMO_MASTER_KEY_VALUE   = '<32 random bytes, base64>'

# 3. Create dev: the resource group (-Create) and everything inside it
./scripts/azure/deploy-env.ps1 -Environment dev -Create

# 4. Create prod the same way, with its own secrets (never reuse dev's)
./scripts/azure/deploy-env.ps1 -Environment prod -Create
```

The first run of an environment creates its registry, then builds into it. Until that build lands,
the Container App runs a public placeholder image (`mcr.microsoft.com/k8se/quickstart:latest`):
`deploy-env.ps1` gives Bicep the image the app is *already* running — the placeholder when there is
none — so applying infrastructure can never point the app at a tag that does not exist. The placeholder
is a plain HTTP server on **port 80**, so the template creates and probes the app on port 80 while that
image is in use and on 4000 otherwise; the script's update installs the real image and moves the port
back to 4000 in the same call.

Infrastructure also cannot promote anything. The template's ingress `traffic` rule *restates* the
revision serving 100% of traffic — `activeRevision`, which the script reads before it creates a new
revision — rather than omitting the rule, because a deployment is a PUT of the whole resource and an
absent rule falls back to `latestRevision`, which would hand everything to a revision the health gate
has not looked at. The deploy finishes by updating the revision to the freshly built tag and shifting
traffic to it, after the gate.

After that, `-Create` is never needed again — leave it off, and the script will stop
with a clear message rather than create a resource group by mistake if one is missing.

### 4. Ingress (before production)

`infra/main.bicep` deliberately stops at the Container App. Production should not go live
until the ingress layer is added:

1. **Application Gateway v2 (WAF_v2)** in `snet-appgw`, with the TLS certificate and the
   two listeners the plan calls for (dev :3010, prod :3011) so prod can be verified on its
   own port by refreshing the browser. Its NSG needs `GatewayManager` (65200–65535) and
   `AzureLoadBalancer` inbound; the subnet has no NSG today (see **Notes and known gaps**).
2. **Front Door Premium** in front of it for the 80/443 entry point, edge cache, WAF
   policies and DDoS absorption, with the App Gateway locked to Front Door's ranges.
3. **Private endpoint + private DNS for Storage**, and diagnostic settings from both into
   the immutable log container. Key Vault's private endpoint and zone are already in the
   template (`privatelink.vaultcore.azure.net`, in `snet-pe`), and Key Vault's public data
   plane is closed in prod.

**The origin is still reachable directly** on `*.azurecontainerapps.io` with no WAF. That is the one
High item PLAN-030 could not close from the infrastructure it was allowed to change — an origin rule
without the Front Door in front of it would only make the app unreachable. Both halves land with
this module, and both are go-live checklist items:

- [ ] **Lock the origin to Front Door.** Set `lockIngressToFrontDoor = true` in
      `infra/params/prod.bicepparam` (the switch is declared in `infra/main.bicep`; it is off by
      default because it is only correct once Front Door exists). It adds an ingress rule matching
      the `AzureFrontDoor.Backend` service tag. Do this *after* Front Door is serving, and then
      confirm from outside that `https://<app>.azurecontainerapps.io/api/health` is **refused**
      while the same call through Front Door returns 200 — that is the exit condition in PLAN-030 §2.
- [ ] **Reject requests that did not come through Front Door, in the API.** Front Door sends
      `X-Azure-FDID` with the profile's id; any request whose header does not match this Front
      Door's id must be rejected. This is an application change (`apps/api`), not an infrastructure
      one, so it is not in this package: a rule that pretended to do it would be worse than none.
- [ ] **Turn the App Gateway's own WAF policy to Prevention** and review the logs in Log Analytics
      before production traffic arrives.

## Day-to-day

The everyday loop is three steps, in this order: **sync to GitHub → push to dev → push
to production.** Work continues on dev; prod is only ever promoted to.

```powershell
# 1. Sync: work lands on main (commit + push)

# 2. Push to dev — deploy what is on main. The push-to-main workflow does this
#    automatically; this is the manual equivalent.
./scripts/azure/deploy-env.ps1 -Environment dev -ImageTag (git rev-parse --short HEAD)

# 3. Push to production — promote the tag dev is running, after verifying dev.
./scripts/azure/deploy-env.ps1 -Environment prod -PromoteFrom dev -Yes
```

`-PromoteFrom dev` reads the tag back from **dev's** running Container App and copies
that image from dev's registry into prod's, so production runs the exact artifact dev
verified and nothing is built a second time. `-Yes` answers the production confirmation;
without it (and outside CI) the script asks you to type `prod`.

Or from GitHub: **Actions → Deploy to Azure → Run workflow → environment: prod**, which
waits on the `prod` environment's reviewers. Leave `image_tag` empty and it promotes what
dev is running; fill it in and it deploys that tag without building, which is the rollback
path.

## Rollback

Three levels, fastest first:

```powershell
# 1. Traffic back to the previous revision (seconds, no rebuild)
az containerapp revision list --name c7ntax-prod --resource-group rg-c7ntax-prod -o table
az containerapp ingress traffic set --name c7ntax-prod --resource-group rg-c7ntax-prod --revision-weight <previous-revision-name>=100

# 2. Previous image tag (that tag already exists, so -SkipBuild deploys it as it is —
#    without it the script refuses rather than rebuilding and overwriting the tag)
./scripts/azure/deploy-env.ps1 -Environment prod -ImageTag <previous-tag> -SkipBuild

# 3. Database: point-in-time restore, prod only, ≤ 35 days
az postgres flexible-server restore --name psql-c7ntax-prod-<suffix> --resource-group rg-c7ntax-prod \
  --source-server <server> --restore-time <UTC timestamp>
```

A schema change is the only thing a revision rollback cannot undo, which is why migrations
run as their own step **before** the new revision takes traffic: the schema is applied
while the old revision still serves, so a bad release is always reversible by shifting
traffic back.

The migration job (`c7ntax-<env>-migrate`) is created and updated by `deploy-env.ps1`, not by
Bicep: it is created on the first run and only has its image moved afterwards, so re-running a
deploy does not delete and recreate it. It pulls the image and reads `DATABASE_URL` through the
same user-assigned identity the app uses.

## Rotating the secrets

Each secret has a different blast radius, and two of them have an order that matters. Every
rotation ends the same way: deploy, then check `/api/ready` (add `?deep=1` to insist that the newest
migration in the image has been applied).

| Secret | How to rotate | What to expect |
|---|---|---|
| `JWT-SECRET` | New value in `JWT_SECRET_VALUE`, deploy, restart the revision. | Every signed-in session is invalidated — people sign in again. Do it in a quiet hour. |
| `KUMO-MASTER-KEY` | **Never rotate without re-encrypting.** The vault's stored credentials are encrypted under it (PLAN-015): a new key without a re-encryption pass makes every stored credential unreadable. | Treat it as a data migration, not a config change. |
| `DATABASE-URL` | Rotate the Postgres password in Azure, then deploy with the new `POSTGRES_ADMIN_PASSWORD` **in the same step** — the connection string in Key Vault is rebuilt from it — and restart the revision. | Between the two the app cannot connect. Keep the break-glass connection open. |
| `SMTP_PASS`, `X_BEARER_TOKEN`, `SSO_CLIENT_SECRET` | Set them in Key Vault, then restart the revision (`az containerapp revision restart`). | They are read from the environment, not from this template. |

`secretRef`s are resolved into the revision when it starts, so every rotation ends with a restart
(or a deploy, which creates a revision anyway) — changing the value in Key Vault alone changes
nothing that is running. Secrets have no expiry date in the templates on purpose: an expiring secret
with no rotation runbook is an outage with a date on it. Calendar the rotations above instead.

## Verification checklist for the first production deployment

- [ ] `node scripts/azure/preflight.mjs` passes
- [ ] `node scripts/azure/validate-bicep.mjs` (or `az bicep build --file infra/main.bicep`) reports no warnings
- [ ] `deploy-env.ps1 -Environment dev -WhatIf` output reviewed
- [ ] `what-if` for **both** environments reviewed and saved alongside the change
- [ ] Dev deploys from `main` and the pipeline goes green end to end
- [ ] Login, tickets, billing, service alerts and the invoice PDF work in dev
- [ ] `prisma migrate status` reports "up to date" against the dev database
- [ ] Secret values are present in Key Vault and **absent** from the Container App's
      environment (they are `secretRef`s)
- [ ] `az containerapp show` lists exactly one revision at 100% traffic
- [ ] Diagnostic settings for Postgres, Key Vault **and the registry** point at Log Analytics,
      and an audit event appears in the workspace after reading a secret and pulling an image
- [ ] Prod postgres has no public endpoint: `publicNetworkAccess: Disabled`
- [ ] Prod Key Vault has no public data plane: `publicNetworkAccess: Disabled`, and
      `az keyvault secret show` from a laptop fails (control-plane reads still work)
- [ ] Rollback rehearsed in dev (shift traffic back, confirm the old revision serves)
- [ ] **A redeploy with no changes reports no subnet or NSG churn** — the subnets are declared
      once, inline, with their NSG (§1.5)
- [ ] **A Bicep-only run does not change the running image, the revision or the traffic weights**
      (§1.3, review §5) — run `deploy-env.ps1 -SkipBuild -WhatIf` against a deployed environment, then
      apply and compare `az containerapp show`: the ingress `traffic` rule should name the same revision
      it named before, because the script reads it and passes it as `activeRevision`
- [ ] Bring dev up, tear it down and rebuild it to prove the template is repeatable. Purge
      protection means vault **names** are reserved for 90 days, so rebuild with a fresh
      `uniqueSuffix`

## Cost shape

| Resource | Dev | Prod |
|---|---|---|
| PostgreSQL Flexible Server | Burstable B1ms, 32 GB, single-zone | D2ds_v5, 128 GB, zone-redundant HA, geo-backup |
| Container Apps | 1–3 replicas, 1 CPU / 2 GiB | 2–10 replicas, 2 CPU / 4 GiB |
| Container Apps environment | Consumption workload profile, single-zone | Consumption workload profile, zone-redundant |
| ACR | Basic | Premium (geo-replication, retention policy) |
| Log Analytics | 30-day retention | 365-day retention |
| Key Vault private endpoint | ~$7/mo (created in dev too, so the private path is proven) | ~$7/mo |
| Front Door + WAF, App Gateway, DDoS Standard | — | added with the ingress layer; these dominate the bill |

## Notes and known gaps

- **Ingress is not in the Bicep yet.** It is a separate module because it is validated
  against a live subscription, and because production should not depend on it being right
  on the first attempt. Until it exists, §4's checklist is what stands between the app and the
  internet.
- **Deliberately not changed by PLAN-030**, each because it is bigger than the infrastructure
  template or needs an application change:
  - **The app still connects as the Postgres administrator** (`postgresAdminLogin`, a member of
    `azure_pg_admin`). The least-privilege role, or passwordless Entra authentication, needs a SQL
    role script and a token path in the Prisma connection — a change of its own.
  - **`sslmode=require`, not `verify-full`.** Verifying the server certificate needs the CA bundle
    in the image.
  - **No private endpoint for the registry**, even in prod (it needs an ACR agent pool or a VNet
    runner, ~$40+/mo). Prod's ACR stays public; Key Vault's endpoint is the one that matters.
  - **No `privatelink.azurecr.io` zone**, because there is no ACR private endpoint to go with it.
  - **Secrets do not expire.** Rotation is a runbook (above), not a field.
  - **Only `snet-postgres` has an NSG.** Adding one to `snet-aca`, `snet-appgw` and `snet-pe` is a
    separate change with real risk — `snet-aca` carries the running environment — so it was not
    bundled with this one. The App Gateway's required rules are written down in §4.
- **The Postgres private DNS zone keeps its default name** (`privatelink.postgres.database.azure.com`),
  which is a choice rather than a requirement: a VNet-injected server needs the zone name to **end in**
  `.postgres.database.azure.com`, so `c7ntax-<env>.postgres.database.azure.com` would resolve too. This
  name is kept because a VNet-injected server never takes a private endpoint, so nothing competes for
  it. Private endpoints get their *own* zones — that, not the Postgres name, is what avoids a collision.
- **Prod's Postgres is created with geo-redundant backup; dev's is not.** That is a creation-time-only
  property on a flexible server: a server built without it can only gain it by being rebuilt and having
  its data migrated, so prod has to have it from its first deployment (~$10–30/mo at 128 GB). It is not
  a DR plan — the compute, VNet, vault and registry are all in this template and can be redeployed into
  the paired region — but it is the only copy of the data that survives losing the region.
- **Dev's Key Vault stays reachable publicly**; prod's does not. Dev is exercised from a laptop that
  cannot reach a private endpoint. The endpoint and zone exist in both, so the prod path is proven
  before prod depends on it.
- **The migration job belongs to `deploy-env.ps1`**, not to the template: declaring it in Bicep is a
  larger change and is reviewed separately.
- **The pipeline's migration step runs as the app's user-assigned identity, like the script**
  (review §3). It previously created the job with `--mi-system-assigned`, which holds no `AcrPull` on
  the registry and no Key Vault Secrets User on the vault, so the job could neither pull its image nor
  read `DATABASE_URL` — and every push to `main` stopped there. It now reads the identity from the app,
  passes `--mi-user-assigned`/`--registry-identity`, supplies `DATABASE_URL` as a `keyvaultref:` secret
  with `identityref:`, and updates-then-starts an existing job rather than re-creating it.
  `deploy-env.ps1` and the workflow do the same thing; keep them in step.
- **`what-if` in `deploy-env.ps1` is informational**, not an approval step: the script
  prints it and applies. Review it on the first run of each environment, then keep moving.
- **`apps/web` is built inside the image**, so a UI-only change still ships a new image.
  That is deliberate: one artifact per commit.
- **The workspace packages publish TypeScript sources**, so the container runs through
  `tsx` rather than a compiled `dist`. Documented in the Dockerfile; revisit if the
  start-up cost matters at scale.
- **Front Door serves only 80/443**, so the port-per-environment verification (`:3010`
  / `:3011`) applies to the Application Gateway listeners, exactly as the plan describes.
