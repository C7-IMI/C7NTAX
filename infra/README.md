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

## What is in the package

| Path | What it is |
|---|---|
| `Dockerfile`, `.dockerignore` | One image: the API on port 4000 **and** the built SPA from the same origin. Non-root, healthcheck, locked install. |
| `infra/main.bicep` | VNet, subnets and NSG, Log Analytics, Key Vault (+ the three secrets), ACR, PostgreSQL Flexible Server (VNet-injected, no public endpoint), Container Apps environment and app, and the app's `AcrPull` / `Key Vault Secrets User` role assignments. |
| `infra/params/dev.bicepparam`, `prod.bicepparam` | Per-environment sizing: dev is Burstable, single-zone, 7-day backup; prod is General Purpose, zone-redundant HA, 35-day backup with geo-redundant copies. |
| `infra/env/.env.production.example` | Every environment variable the API reads, with the ones that must be set in Key Vault called out. |
| `scripts/azure/preflight.mjs` | Fails before a deploy does: stale lockfile, missing migration, undocumented env var, unguarded route, new advisory, non-root image. |
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

# 2. Export the secrets for this shell (they go into Key Vault, never into a file)
$env:PG_ADMIN_PASSWORD   = '<generated>'
$env:JWT_SECRET_VALUE    = '<openssl rand -base64 48>'
$env:KUMO_MASTER_KEY_VALUE = '<32 random bytes, base64>'

# 3. Create dev: the resource group (-Create) and everything inside it
./scripts/azure/deploy-env.ps1 -Environment dev -Create

# 4. Create prod the same way, with its own secrets (never reuse dev's)
./scripts/azure/deploy-env.ps1 -Environment prod -Create
```

The first run of an environment creates its registry, then builds into it. If the
Container App starts before the image exists it will be unhealthy for a minute; the
deploy finishes by updating the revision to the freshly built tag and shifting traffic
to it.

After that, `-Create` is never needed again — leave it off, and the script will stop
with a clear message rather than create a resource group by mistake if one is missing.

### 4. Ingress (before production)

`infra/main.bicep` deliberately stops at the Container App. Production should not go live
until the ingress layer is added:

1. **Application Gateway v2 (WAF_v2)** in `snet-appgw`, with the TLS certificate and the
   two listeners the plan calls for (dev :3010, prod :3011) so prod can be verified on its
   own port by refreshing the browser.
2. **Front Door Premium** in front of it for the 80/443 entry point, edge cache, WAF
   policies and DDoS absorption, with the App Gateway locked to Front Door's ranges.
3. **Private endpoint + private DNS for Key Vault and Storage**, and diagnostic settings
   from both into the immutable log container.

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
az containerapp ingress traffic set --name c7ntax-prod --resource-group rg-c7ntax-prod --revision <previous> --weight 100

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

## Verification checklist for the first production deployment

- [ ] `node scripts/azure/preflight.mjs` passes
- [ ] `az bicep build --file infra/main.bicep` reports no warnings
- [ ] `deploy-env.ps1 -Environment dev -WhatIf` output reviewed
- [ ] Dev deploys from `main` and the pipeline goes green end to end
- [ ] Login, tickets, billing, service alerts and the invoice PDF work in dev
- [ ] `prisma migrate status` reports "up to date" against the dev database
- [ ] Secret values are present in Key Vault and **absent** from the Container App's
      environment (they are `secretRef`s)
- [ ] `az containerapp show` lists exactly one revision at 100% traffic
- [ ] Diagnostic settings for Postgres and the Container App point at Log Analytics
- [ ] Prod postgres has no public endpoint: `publicNetworkAccess: Disabled`
- [ ] Rollback rehearsed in dev (shift traffic back, confirm the old revision serves)

## Cost shape

| Resource | Dev | Prod |
|---|---|---|
| PostgreSQL Flexible Server | Burstable B1ms, 32 GB, single-zone | D2ds_v5, 128 GB, zone-redundant HA, geo-backup |
| Container Apps | 1–3 replicas, 1 CPU / 2 GiB | 2–10 replicas, 2 CPU / 4 GiB |
| ACR | Basic | Premium (geo-replication, retention) |
| Log Analytics | 30-day retention | 365-day retention |
| Front Door + WAF, App Gateway, DDoS Standard | — | added with the ingress layer; these dominate the bill |

## Notes and known gaps

- **Ingress is not in the Bicep yet.** It is a separate module because it is validated
  against a live subscription, and because production should not depend on it being right
  on the first attempt.
- **The `what-if` in `deploy-env.ps1` is informational**, not an approval step: the script
  prints it and applies. Review it on the first run of each environment, then keep moving.
- **`apps/web` is built inside the image**, so a UI-only change still ships a new image.
  That is deliberate: one artifact per commit.
- **The workspace packages publish TypeScript sources**, so the container runs through
  `tsx` rather than a compiled `dist`. Documented in the Dockerfile; revisit if the
  start-up cost matters at scale.
- **Front Door serves only 80/443**, so the port-per-environment verification (`:3010`
  / `:3011`) applies to the Application Gateway listeners, exactly as the plan describes.
