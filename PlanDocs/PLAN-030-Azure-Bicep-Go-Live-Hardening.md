# PLAN-030 — Azure Bicep go-live hardening: deployment blockers, security, and cost

> **Filed:** 2026-10-09, at the operator's request: *"check over this bicep plan, give me an approximate
> monthly cost, and also check for any security issues before we go live"*, then *"make a plan"*.
> **What it is:** the fixes PLAN-016's deployment package (`infra/main.bicep`, `infra/params/*.bicepparam`,
> `scripts/azure/deploy-env.ps1`) needs before its first real run, in the order they have to land.
> **Status:** 📋 plan only, **nothing applied**. Found by reading; `az` and the Bicep CLI are not available
> in the review environment, so every item marked *(verify)* is confirmed or dropped by the first
> `what-if` against a subscription.
> **Depends on:** nothing. **Gates:** PLAN-016's first deployment of dev and prod.

**Read first:** §1 (it will not deploy as written) and §2.1 (the app is internet-facing with no WAF).

---

## 1. Phase 1 — deployment blockers (the first run fails without these)

| # | Where | Problem | Fix |
|---|---|---|---|
| 1.1 | `main.bicep` `acaEnv`, `snet-aca` | `snet-aca` is delegated to `Microsoft.App/environments`, but the environment declares no `workloadProfiles`, which makes it a *consumption-only* environment, and that kind requires an **undelegated** subnet. | Add `workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]` (the current model; consumption-only is legacy). Keep the delegation. |
| 1.2 | `containerApp`, `acrPullRole`, `kvSecretsUserRole` | The app uses a **system-assigned** identity, so the AcrPull and Key Vault Secrets User grants can only be created *after* the app. Its first revision tries to pull the image and resolve three Key Vault secret refs before either grant exists. | Add a `Microsoft.ManagedIdentity/userAssignedIdentities` resource. Grant it both roles. Attach it to the app (`identity: 'UserAssigned'`, `registries[].identity` and `secrets[].identity` set to its resource id), and make the app `dependsOn` both role assignments. |
| 1.3 | `deploy-env.ps1` order + `containerApp.template` | The script runs Bicep **before** it builds, passing `imageTag=<new tag>`. So every normal deploy points the app at an image that does not exist yet, and on a `-Create` run the registry is empty. Because the template also sets `traffic: latestRevision 100%`, a Bicep run that does succeed **bypasses the script's 0%-traffic health gate**. | Bicep should not own the running image. Either (a) pass Bicep the tag the app is *currently* running (or a public placeholder such as `mcr.microsoft.com/k8se/quickstart:latest` when none exists), and let the script's `containerapp update` → health gate → traffic shift remain the only thing that moves the image; or (b) move the build before the Bicep step. **(a) is recommended:** it keeps the gate authoritative. Also set `activeRevisionsMode: 'Multiple'` in the template, so a Bicep run does not flip back the mode the script sets. |
| 1.4 | `acr.properties.policies.retentionPolicy` | The retention policy is Premium-only, and dev is Basic, so the dev deployment is rejected. | Apply `policies` only when `environment == 'prod'`. |
| 1.5 | `vnet.subnets` + `postgresSubnet` | `snet-postgres` is declared twice: inline in the VNet without the NSG, and as a child resource with it. Each redeploy detaches the NSG and re-attaches it, and can fail with `AnotherOperationInProgress`. | Declare every subnet inline only, with its NSG there; reference them with `vnet::` or `existing`. Drop the separate `postgresSubnet` resource. |
| 1.6 | `postgres` | No dependency on `privateDnsLink`, so the server can be created before its DNS zone is linked to the VNet. | `dependsOn: [privateDnsLink]`. |
| 1.7 | `privateDnsZone` name *(verify)* | `privatelink.postgres.database.azure.com` is the zone **private endpoints** use. A VNet-injected server sharing it with a future endpoint in `snet-pe` invites a collision. | Rename to `c7ntax-${environment}.postgres.database.azure.com`. |
| 1.8 | `deploy-env.ps1` migration job *(verify)* | `containerapp job create … --mi-system-assigned` gives the job its **own** new identity, which has no AcrPull on the registry, so the pull fails. A second run also re-creates an existing job. | Use the user-assigned identity from 1.2 (`--mi-user-assigned`, `--registry-identity`). Declare the job in Bicep and only `job update --image` + `job start` from the script. |

**Exit condition:** `az bicep build` is clean, and `what-if` is reviewed for both environments. `deploy-env.ps1 -Environment dev -Create` then completes on an empty resource group in **one** run, and a second run with no change reports no resource changes.

## 2. Phase 2 — security issues that block go-live

| # | Severity | Problem | Fix |
|---|---|---|---|
| 2.1 | **High** | `ingress.external: true` publishes the app on `*.azurecontainerapps.io` with **no WAF**. Front Door and Application Gateway are a separate, unwritten module. Even after they exist, the origin stays reachable directly. | Do not go live before the ingress module (PLAN-016 / `infra/README.md` §4). On the app, add `ipSecurityRestrictions` allowing only the `AzureFrontDoor.Backend` service tag (or the App Gateway subnet). In the API, reject any request whose `X-Azure-FDID` header is not this Front Door's id. |
| 2.2 | **High** | `jwtSecret`, `kumoMasterKey` and `postgresAdminPassword` are `''` in both `.bicepparam` files. `deploy-env.ps1` refuses to run without them, but a direct `az deployment group create --parameters infra/params/prod.bicepparam` writes an **empty JWT signing key and vault master key** into Key Vault. | `@minLength(32)` on `jwtSecret` and `kumoMasterKey`, and `@minLength(16)` on the password. In the `.bicepparam` files, replace `''` with `readEnvironmentVariable('JWT_SECRET_VALUE')` (and so on), so a missing value fails at compile time. |
| 2.3 | **High** | The app connects as the **server administrator** (`DATABASE-URL` is built from `postgresAdminLogin`), which is a member of `azure_pg_admin`. | Create an `app_c7ntax` role that owns the `c7_overwatch` schema and has no server-level rights. Run migrations as that role too. Keep the admin for break-glass only. Better still, enable Entra auth (`activeDirectoryAuth: 'Enabled'`) and let the user-assigned identity from 1.2 sign in **without a password**. That needs token acquisition in the API's Prisma connection, so it is a decision (§5, D2). |
| 2.4 | **High** | Key Vault has `publicNetworkAccess: 'Enabled'` with `defaultAction: 'Allow'`, and it holds the vault master key. | Add a private endpoint in `snet-pe` with a `privatelink.vaultcore.azure.net` zone linked to the VNet. Then `publicNetworkAccess: 'Disabled'`. The deploy identity writes secrets through ARM, so this does not affect deploys. |
| 2.5 | Medium | The Postgres NSG's "allow from ACA" rule restricts nothing, because the default `AllowVnetInBound` (65000) admits **every** subnet. `snet-aca`, `snet-appgw` and `snet-pe` have no NSG. | On `nsg-postgres`: allow 5432 from `snet-aca`, allow all traffic **within** `snet-postgres` (HA replication needs it), then deny `VirtualNetwork` inbound at 4000. Add NSGs to the other subnets. App Gateway v2 needs `GatewayManager` 65200–65535 and `AzureLoadBalancer` inbound. |
| 2.6 | Medium | No diagnostic settings on Key Vault or ACR, so there is no record of who read a secret. The Postgres comment says "audit", but `pgaudit` is not enabled. These are SOC 2 evidence gaps (PLAN-007). | Send `AuditEvent` (Key Vault) and `ContainerRegistryLoginEvents`/`RepositoryEvents` (ACR) to Log Analytics. Add `configurations` for `shared_preload_libraries=pgaudit`, `pgaudit.log='ddl,role'` and `azure.extensions=pgaudit`. |
| 2.7 | Medium | `imageTag` defaults to `'latest'`. | Make it required (no default). Folds into 1.3. |
| 2.8 | Medium | ACR has public network access in both environments. Prod pays for Premium, which supports a private endpoint, but does not use one. | Prod: private endpoint in `snet-pe` and `publicNetworkAccess: 'Disabled'`. `acr build` then needs a dedicated agent pool or a VNet runner, so this is a decision (§5, D3). Dev: leave public. |
| 2.9 | Low | `sslmode=require` encrypts but does not verify the server certificate. | `sslmode=verify-full` with the DigiCert/Microsoft root bundle in the image. |
| 2.10 | Low | Preview API versions for Postgres (`2023-12-01-preview`) and ACR (`2023-11-01-preview`). | Postgres `2024-08-01`; ACR `2023-07-01`. |
| 2.11 | Low | Prod ACA environment is not zone-redundant while its database is. | `zoneRedundant: true` in prod (requires the `/23` the subnet already has). |
| 2.12 | Low | Secrets have no expiry, and there is no rotation runbook. | Set `attributes.exp` and document rotation for each secret. `KUMO_MASTER_KEY` rotation re-encrypts the vault (PLAN-015). |

**Exit condition:** every High item is closed. From outside Azure, `curl https://<app>.azurecontainerapps.io/api/health` is refused, and the same call through Front Door returns 200. A `--parameters prod.bicepparam` run with no secrets exported fails at compile time. `\du` on the server shows the app connecting as `app_c7ntax`.

## 3. Phase 3 — validation before the first production deployment

Add these to the checklist in `infra/README.md`:

- [ ] `what-if` for both environments reviewed, with the output saved alongside the change.
- [ ] A redeploy with no changes reports **no** subnet/NSG churn (1.5).
- [ ] A Bicep-only run does not change the running image or traffic (1.3).
- [ ] Key Vault and ACR audit events appear in Log Analytics after a secret read and an image pull (2.6).
- [ ] The origin is unreachable except through the ingress layer (2.1).
- [ ] Bring dev up, tear it down and rebuild it to prove the template is repeatable. Purge protection means vault **names** are reserved for 90 days, so use a fresh `uniqueSuffix` for the rebuild.

## 4. Approximate monthly cost

These are East US 2 pay-as-you-go list prices in USD, from memory rather than a live quote. Check them in the Azure pricing calculator before committing a budget.

| Resource | Prod | Dev |
|---|---|---|
| PostgreSQL compute (D2ds_v5 with zone-redundant HA, so compute ×2 / B1ms) | ~$260 | ~$12 |
| PostgreSQL storage (128 GB ×2 / 32 GB) + backup (35-day geo-redundant / 7-day) | ~$40–60 | ~$4 |
| Container Apps (2 always-on replicas at 2 vCPU/4 GiB / 1 at 1 vCPU/2 GiB; idle → busy) | ~$95–310 | ~$20–75 |
| Container Registry (Premium / Basic) | ~$50 | ~$5 |
| Log Analytics (prod 5–10 GB/mo, 365-day retention) | ~$20–50 | ~$5 |
| Key Vault, private DNS, VNet, NSGs | <$5 | <$2 |
| **This template** | **≈ $470–730** | **≈ $45–100** |
| Ingress, needed for go-live (Front Door Premium ~$330 + traffic, *or* App Gateway WAF_v2 ~$325 + capacity units) | +$330–700 | — |
| Private endpoints (Key Vault, ACR: ~$7–8 each) | +~$15 | — |
| **Realistic go-live total** | **≈ $800–1,450** | **≈ $45–100** |

**Not included:** Defender for Cloud plans, DDoS Network Protection (~$2,900/mo, which Front Door makes unnecessary at this size), and egress beyond 100 GB.

**Levers:**
- A 1-year reservation on the Postgres compute saves about 35–40%.
- Dev Postgres can be stopped out of hours.
- Running **both** Front Door Premium and App Gateway WAF_v2, as PLAN-016 §2 describes, is the single largest line. See D1.

## 5. Decisions the operator owns

| # | Decision | Recommendation |
|---|---|---|
| D1 | Ingress: Front Door Premium **and** App Gateway (PLAN-016's design, which keeps the `:3010`/`:3011` port listeners), or Front Door alone | Front Door alone in production saves ~$325+/mo. Port-based prod verification can use the revision's own FQDN with the health gate the script already has. |
| D2 | Entra (passwordless) database auth vs a least-privilege password role | Password role now (2.3) and Entra as a follow-up. Entra needs a token refresh in the Prisma connection. |
| D3 | Private ACR in prod (needs an ACR agent pool, ~$40+/mo, or a self-hosted runner in the VNet) | Defer. Key Vault's private endpoint (2.4) matters more. |
| D4 | Fix 1.3 by pinning Bicep to the running image (a) or by building first (b) | (a) |

## 6. Order of work

1. Phase 1, as one change to `main.bicep` and `deploy-env.ps1`, proven on a throwaway dev resource group.
2. Phase 2 High items (2.2, 2.3, 2.4 in the same change; 2.1 lands with the ingress module).
3. Phase 2 Medium/Low items.
4. Phase 3 checklist, then PLAN-016's first production deployment.
