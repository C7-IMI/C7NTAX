# PLAN-030 — Azure Bicep go-live hardening: deployment blockers, security, and cost

> **Filed:** 2026-10-09, at the operator's request: *"check over this bicep plan, give me an approximate
> monthly cost, and also check for any security issues before we go live"*, then *"make a plan"*.
> **What it is:** the fixes PLAN-016's deployment package (`infra/main.bicep`, `infra/params/*.bicepparam`,
> `scripts/azure/deploy-env.ps1`) needs before its first real run, in the order they have to land.
> **Status:** ✅ **applied and revised** — Phase 1 (1.1–1.8) and the safe Phase 2 items (2.1, 2.2, 2.4,
> 2.5, 2.6, 2.7, 2.10, 2.11) landed in `infra/`, `scripts/azure/` and `.bicepparam`, and the templates
> **compile** against the real Bicep CLI (0.48.1, no warnings). Four items were deliberately **not**
> applied and six decisions are still the operator's: see *§7 What landed, and what did not* below.
>
> **The static review is closed at round 9.** Nine rounds took this from "cannot complete a deployment" to
> "no further findings"; round 9 raised nothing and fixed one defect the reviewer had deliberately left
> out (the mail transport authenticating with credentials that were never configured —
> **2026.10.10.014**). **It is still not deployed and not ready.** Nothing further can be settled by
> reading: the next evidence is a dev deploy that runs one commit twice and then does a deliberate
> rollback, plus the prod rehearsal and the four operator decisions listed in
> `PLAN-030-Response-to-Review-Round-9.md` §3.
>
> **Revised against the review of the applied changes** (`PLAN-030-Review-of-Applied-Changes.md`, §1–§6
> applied; §7 there — the least-privilege Postgres role, this plan's 2.3 — is tracked separately and
> deliberately not applied):
> geo-redundant backup is now **on in prod** and off in dev (§9.1, §9.3); every claim that `SameZone`
> "halves the compute" is corrected, because a standby is billed in **both** HA modes and only
> `Disabled` is ×1 (§2 of the review, §4, §8.5, §9.1–§9.4); the pipeline's migration step now runs as
> the app's user-assigned identity, like the script (§3 of the review, §8.10); the template creates and
> probes the app on the bootstrap image's port 80 and the script moves it back to 4000 (§4);
> `ingress.traffic` is **declared** — restating the revision that is serving — instead of omitted (§5);
> and the private-DNS comment states the actual rule (§6).
>
> **Revised again 2026-10-09 (second pass)**, after the reply below was written: the first-run hand-off is
> now **implemented** as the review's option (b) — the app is created once, against the real image, in two
> passes — so the failure the review predicted for an empty environment is designed out rather than
> documented (§8.13); the database is renamed **`c7ntax`** from `c7_overwatch`, in the template, the
> vault secret, the documentation and the local development instance together (§8.12); and **2.3 is
> deferred by the operator's decision**, which leaves it the last High item on the bar and not a
> forgotten one (§8.11).
>
> **Confirmed against Microsoft documentation** (these were *(verify)* items, and are not any more):
> geo-redundant backup storage for Flexible Server is settable **only at server creation**, which is why
> prod has to have it from the first deployment; and for a VNet-injected server the private DNS zone
> name only has to *end in* `.postgres.database.azure.com`, so the name used is a choice rather than a
> requirement (§9.1, §9.3).
> **Still unverified without a subscription**, and settled by the first `what-if` and the first dev
> deployment: the two-pass create itself — pass 1 without the app, the image build, pass 2 with it
> (§8.13) — because no call in this package has ever reached ARM; whether a creation-time-only backup
> property can be *proved* from a template, which it cannot; and the four §3 checks below. Compiling is
> not deploying.
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
| 2.3 | **High** | The app connects as the **server administrator** (`DATABASE-URL` is built from `postgresAdminLogin`), which is a member of `azure_pg_admin`. | Create an `app_c7ntax` role that owns the **`public` schema of the `c7ntax` database** (renamed from `c7_overwatch` — see §8.12 — and the database is not a schema: see the correction in §8.1) and has no server-level rights. Run migrations as that role too. Keep the admin for break-glass only. Better still, enable Entra auth (`activeDirectoryAuth: 'Enabled'`) and let the user-assigned identity from 1.2 sign in **without a password**. That needs token acquisition in the API's Prisma connection, so it is a decision (§5, D2). **Deferred by decision on 2026-10-09** — see §8.11; the plan of record in §8.1 stands and is now technically correct. |
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
| PostgreSQL compute (D2ds_v5 with zone-redundant HA, so compute ×2 / B1ms single-zone; **either** HA mode bills a standby, so only `Disabled` would be ×1 — §8.5) | ~$260 | ~$12 |
| PostgreSQL storage (128 GB / 32 GB) + backup (35-day retention / 7-day) — prod's copies are **geo-redundant** (~$10–30/mo of this line at 128 GB; §9.1, §9.3) | ~$45–85 | ~$4 |
| Container Apps (2 always-on replicas at 2 vCPU/4 GiB / 1 at 1 vCPU/2 GiB; idle → busy) | ~$95–310 | ~$20–75 |
| Container Registry (Premium / Basic) | ~$50 | ~$5 |
| Log Analytics (prod 5–10 GB/mo, 365-day retention) | ~$20–50 | ~$5 |
| Key Vault, private DNS, VNet, NSGs | <$5 | <$2 |
| **This template** | **≈ $480–760** | **≈ $45–100** |
| Ingress, needed for go-live (Front Door Premium ~$330 + traffic, *or* App Gateway WAF_v2 ~$325 + capacity units) | +$330–700 | — |
| Private endpoints (Key Vault, ACR: ~$7–8 each) | +~$15 | — |
| **Realistic go-live total** | **≈ $810–1,480** | **≈ $45–100** |

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

## 7. What landed, and what did not

**Applied** — the templates compile with Bicep CLI 0.48.1 (`node scripts/azure/validate-bicep.mjs`, exit
0, no warnings), and `scripts/azure/preflight.mjs` gained a regression guard for the items most likely
to come back — the running image, the serving revision, the revisions mode and the secrets:

| Item | Where |
|---|---|
| 1.1 workload profile, delegation kept | `infra/main.bicep` |
| 1.2 user-assigned identity, both role grants, attached to the app and the app's `secretRef`s | `infra/main.bicep` |
| 1.3 `imageTag` required with no default; `activeRevisionsMode: Multiple`; the script reads the running tag (or the public placeholder) and sets the mode before it updates. **Revised by the review §5:** the `traffic` block is declared after all — it restates `activeRevision`, read by the script before it creates a revision — because an omitted rule resets to `latestRevision` | `infra/main.bicep`, `scripts/azure/deploy-env.ps1` |
| 1.4 ACR policies prod-only | `infra/main.bicep` |
| 1.5 every subnet inline, one VNet PUT, no duplicate subnet resource | `infra/main.bicep` |
| 1.6 `postgres` depends on the DNS link | `infra/main.bicep` |
| 1.8 migration job on the user-assigned identity, create-or-update, `DATABASE_URL` from Key Vault | `scripts/azure/deploy-env.ps1` |
| **1.8's workflow half** (review §3): the pipeline's migration step now uses the app's user-assigned identity, `--mi-user-assigned`/`--registry-identity`, `DATABASE_URL` as a `keyvaultref:` secret with `identityref:`, and create-or-update before `job start` | `.github/workflows/deploy-azure.yml` |
| **Review §1**: geo-redundant backup on in prod, off in dev, with the creation-time constraint stated as fact | `infra/main.bicep` |
| **Review §2**: the HA-cost claim corrected everywhere a standby is billed or a reservation is sized | `infra/main.bicep`, PLAN-030 §4, §8.5, §9 |
| **Review §4**: the app is created and probed on the bootstrap image's port, and the script moves it back to 4000 with the real image | `infra/main.bicep`, `scripts/azure/deploy-env.ps1` |
| **Review §5**: ingress `traffic` restates `activeRevision`; the script reads the serving revision before creating one; `preflight.mjs` guards all three | `infra/main.bicep`, `scripts/azure/deploy-env.ps1`, `scripts/azure/preflight.mjs` |
| **Review §6**: the private-DNS comment states the rule (`end in`, not `match`) | `infra/main.bicep` |
| 2.1 Front Door restriction behind a switch + the `X-Azure-FDID` checklist item | `infra/main.bicep`, `infra/README.md` §4 |
| 2.2 `@minLength` on the three secrets; params read `readEnvironmentVariable` | `infra/main.bicep`, both `.bicepparam` |
| 2.4 Key Vault private endpoint + zone group; `publicNetworkAccess: Disabled` **prod only** | `infra/main.bicep` |
| 2.5 NSG: 5432 from `snet-aca`, intra-subnet allowed, `VirtualNetwork` denied at 4000 | `infra/main.bicep` |
| 2.6 Key Vault and ACR audit to Log Analytics; `pgaudit` enabled | `infra/main.bicep` |
| 2.10 Postgres `2024-08-01`, ACR `2023-07-01` | `infra/main.bicep` |
| 2.11 zone redundancy on the Container Apps environment in prod (the server already has zone-redundant HA) | `infra/main.bicep` |
| 2.12's documentation half: the secret rotation runbook | `infra/README.md` |

**Four deliberate deviations** from this plan, each decided during review and recorded in the
templates or the README:

1. **The `traffic` block restates the revision that is serving, rather than being removed** — the
   review (§5) reversed the original decision here. Omitting it does not preserve traffic: a deployment
   is a PUT of the whole resource, and an absent rule reads as the default, `latestRevision: true,
   weight: 100`, so a Bicep-only run would hand 100% to a revision the health gate had just rejected.
   The template now declares `traffic` and pins `activeRevision`, which the script reads *before* it
   creates a new revision; the promotion path still owns moving traffic, after the gate.
2. **The Postgres private DNS zone keeps its name** (1.7), though the reason recorded here was wrong
   until the review corrected it (§6). For a VNet-injected server the zone name only has to **end in**
   `.postgres.database.azure.com`, so `c7ntax-<env>.postgres.database.azure.com` would have resolved
   too; this name is kept because a VNet-injected server never takes a private endpoint, so nothing
   competes for it. Key Vault gets its own `privatelink.vaultcore.azure.net` zone because it *does*
   take one — and no ACR zone, because 2.8 defers that endpoint.
3. **The Key Vault private endpoint is created in dev too**, with public access left on there, so the
   zone-group wiring is exercised before prod depends on it.
4. **No `priority` or `ipSecurityRestrictionsDefaultAction` on the ingress rule** — neither exists in
   a GA API version, and this plan's own 2.10 is about getting off previews.

**Not applied, for the operator to decide** (each is written up in `infra/README.md` as an open item):

| Not applied | Why |
|---|---|
|---|---|
| 2.3 least-privilege Postgres role and Entra database auth | Needs a SQL role script and a token path in the Prisma connection. The app still connects as the server administrator — the highest-value open item in this plan. |
| 2.8 private ACR in prod | D3 defers it: an ACR agent pool or a VNet runner is ~$40+/mo. Prod's registry stays public, which is why no ACR private DNS zone is created. |
| 2.9 `sslmode=verify-full` | An application change, not an infrastructure one: it needs the CA bundle in the image. |
| 2.12 secret expiry (`attributes.exp`) | Expiry without a rotation process is a scheduled outage. The runbook landed instead; expiry is now a decision with a process behind it. |
| NSGs on `snet-aca`, `snet-appgw`, `snet-pe` (the rest of 2.5) | Deferred as riskier than the Postgres rules; README §4 records the `GatewayManager` 65200–65535 and `AzureLoadBalancer` rules App Gateway will need. |
| The migration job declared in Bicep (1.8's second half) | The script remains its owner for now; the identity, image and update path are fixed. |
| §4's cost estimate and §5's D1–D4 | The operator's, unchanged. Dev now carries one extra private endpoint (~$7/mo), recorded in the README cost table. |

## 8. Recommendations on the open items

Written after applying §7. Each is a recommendation with the reasoning, the cost, the trigger that
should make it happen, and what "done" looks like — so the decision can be taken without re-reading
this plan.

### 8.1 — 2.3: a least-privilege database role, before there is production data

**Recommendation: create `app_c7ntax` and switch the app to it now. Treat passwordless Entra auth as a
spike, not a go-live blocker.**

Today the API connects as `c7ntaxadmin`, a member of `azure_pg_admin`. That means one bug in any query
path — a string-built `ORDER BY`, a future raw SQL endpoint, a dependency compromise — has
server-level rights: create or drop databases, read every schema, `COPY … TO PROGRAM`. Nothing about
this application needs that. It needs one schema and the tables in it.

- **Do:** `CREATE ROLE app_c7ntax LOGIN PASSWORD …` with `NOINHERIT`; **make it own the `public` schema
  of the `c7ntax` database** (`ALTER SCHEMA public OWNER TO app_c7ntax`), `GRANT CONNECT ON
  DATABASE c7ntax TO app_c7ntax`, and leave `REVOKE CREATE ON SCHEMA public FROM PUBLIC` in place;
  run `prisma migrate deploy` as that role (it needs `CREATE` only inside the schema it owns, which it
  has). Keep the admin credential in Key Vault behind a policy that the *operator* holds and the app
  does not. Write the password like the other secrets, from `deploy-env.ps1`.
  **Corrected 2026-10-09:** this bullet previously said `CREATE SCHEMA c7_overwatch AUTHORIZATION
  app_c7ntax`. That is wrong, and following it would produce an application with no rights to its own
  data: **`c7_overwatch` was the *database* name, not a schema**, and the app's tables are in `public` —
  Prisma is given a plain `DATABASE_URL` with no `?schema=`, and the local one carries `?schema=public`
  explicitly. `CREATE SCHEMA c7_overwatch` would have created a second, empty schema beside the real one
  while the app went on reading `public`, where it would have had no grants. The role must own the schema
  the application actually uses. *(The database itself has since been renamed `c7ntax` — §8.12 — so the
  form above is the one to follow; the wrong instruction is kept here only so the correction can be
  read against what it corrects.)*
- **Why now:** before data exists this is a five-minute ownership change. After it exists it is a
  migration: every object the admin created must be reassigned (`REASSIGN OWNED BY c7ntaxadmin TO
  app_c7ntax`) and the schema owner changed, in the right order, with a rehearsal.
- **Entra (passwordless) auth:** worth having — it removes a password from the whole system — but it is
  not free: tokens last about an hour, so the API needs a connection wrapper that fetches a token with
  `DefaultAzureCredential` and recycles the Prisma connection before expiry. That is a self-contained
  piece of work and a good spike, not a prerequisite for going live.
- **Cost:** about half a day, plus a rehearsal against a scratch database using `migrate deploy` (no
  shadow database is needed in CI, which is why this is cheaper than it looks).
- **Done when:** `\du` shows the app connecting as `app_c7ntax`; the API's environment holds no
  administrator credential; a migration run as the app role succeeds; and `SELECT rolsuper FROM
  pg_roles WHERE rolname = 'app_c7ntax'` is `false`.

### 8.2 — 2.8: keep the registry public, and spend the money elsewhere

**Recommendation: defer the prod ACR private endpoint (D3 stands). Do three cheaper things instead —
and revisit when the build itself moves into the VNet.**

The risk a private endpoint removes is *reachability of the registry endpoint*. With the admin user
disabled and `AcrPull` held only by the user-assigned identity applied in §7, the exposure is not
anonymous pulls; it is credential theft, and a private endpoint does not stop that. Meanwhile it costs
an ACR agent pool (~$40+/mo) or a VNet-connected runner, and it breaks the simplest build path
(`az acr build` from a laptop).

- **Do instead:** disable the ACR admin user and delete any registry password from the environment;
  keep the ACR on the audit path §2.6 added and alert on pushes and pulls from unexpected identities or
  addresses; and consider content signing, which is the control that actually protects an image.
- **Revisit when:** a contract or a SOC 2 commitment demands no public registry endpoint, or the build
  moves into the VNet for its own reasons — at that point the endpoint is nearly free to add. The plan's
  own §2.8 notes the same thing; this is just the ordering.
- **Note:** because 2.8 stays deferred, no `privatelink.azurecr.io` zone was created. Creating one now
  would be an unused zone and an unnecessary bill.

### 8.3 — 2.12: expiry for the secret that has a rotation path, and none for the two that do not

**Recommendation: set `exp` on the database credential only. Leave `JWT_SECRET_VALUE` and
`KUMO_MASTER_KEY` without expiry until rotation exists for them — and say so in the vault, in words.**

An expiring secret is a promise that somebody will rotate it before the date. Where that promise
cannot be kept, expiry converts a security nicety into a production outage with a calendar entry.

- **Database credential — expire it (12 months).** Rotation is mechanical, the runbook now exists
  (§2.12's documentation half), and the blast radius of a rotation is one restart.
- **`JWT_SECRET_VALUE` — no expiry yet.** Rotating a signing key invalidates every token signed with
  the old one: it is a user-visible event (every session re-authenticates). Doing it well needs a
  **key ring** — sign with the new key, keep *verifying* with the previous one for one token lifetime,
  then retire it. That is an API feature, and it is the right precondition for expiry.
- **`KUMO_MASTER_KEY` — no expiry.** Rotation re-encrypts the vault (PLAN-015): a batch operation with
  a half-re-encrypted state as its failure mode. It belongs on a maintenance window with a backup of
  the encrypted column taken first, not on a date the platform enforces.
- **Also do:** label the two unexpiring secrets in Key Vault with the reason (a tag such as
  `rotation=manual, reason=key-ring-not-implemented`) so the next reviewer sees a decision rather than
  an oversight.

### 8.4 — 2.9: do `verify-full`, as an image change, and keep `require` behind a flag for one release

**Recommendation: implement it before go-live. It is the cheapest item left on the list and it closes a
real hole.**

`sslmode=require` encrypts the connection but does not verify *who* is on the other end. Anyone who can
influence routing or DNS for `*.postgres.database.azure.com` from inside the VNet can present their own
certificate, take the credential and read the traffic. `verify-full` makes that fail.

- **Do:** vendor the Azure Postgres CA chain (or fetch it in the Dockerfile with a pinned SHA-256) to
  `/etc/ssl/certs/azure-postgres.pem`, and set the connection URL to
  `sslmode=verify-full&sslrootcert=/etc/ssl/certs/azure-postgres.pem`. With `pg-connection-string`,
  that maps to Node's `ssl.ca` correctly.
- **Why the flag:** if the bundle is wrong the API cannot connect at all, so ship `require` as a
  fallback for one release and flip the default in the next. Verify in dev first, where a broken
  connection costs nothing.
- **Cost:** about an hour plus a container build. **Done when:** the API boots with `verify-full`
  against dev, and a deliberately wrong `sslrootcert` refuses to connect (which is the test that proves
  it is doing something).

### 8.5 — §4: treat the estimate as an envelope, and let Cost Management police it

**Recommendation: adopt the plan's numbers as a budget range, replace the guesswork with a calculator
export and a budget alert, and make two decisions the table cannot.**

The table is honest that it is from memory, and its own ranges show where the uncertainty is: prod
Container Apps spans $95–310 — a factor of three, and the largest single variance in the template.

- **Do:** resolve the template's parameters (the emitted ARM from §7 has every concrete SKU), price
  those exact SKUs in the Azure Pricing Calculator, save the export next to this plan, and set a Cost
  Management **budget alert at 80%** on the subscription. The alert is the mechanism that catches a
  wrong estimate; another table is not.
- **Two decisions worth an hour each:** (a) Postgres HA mode — a standby is billed in **both** HA
  modes, so `ZoneRedundant` and `SameZone` cost the same ×2 compute and only `Disabled` (no standby)
  is ×1, about $130/mo less on D2ds_v5. The real choice is therefore *availability*: survive the loss
  of a zone (`ZoneRedundant`), survive a host failure only (`SameZone`), or have no standby at all
  (`Disabled`) — not a saving. (b) Front Door **Standard vs
  Premium** — see 8.6, where Premium is recommended for a non-cost reason.
- **Reservations:** a 1-year reservation on the Postgres compute is the single biggest saving (~35–40%),
  and Container Apps has savings plans. Buy after 30 days of real usage, never before.
- **New in §7:** dev now carries one extra private endpoint (~$7/mo), already reflected in
  `infra/README.md`'s table.

### 8.6 — D1: Front Door **Premium alone**, and the reason is not only cost

**Recommendation: Front Door Premium alone, in Blocking mode, with a Private Link origin — and drop App
Gateway from the production path.**

This agrees with the plan's cost argument (~$325+/mo saved) but adds the reason that matters more:
**Premium is what gives you Private Link origins**, which is the difference between an origin that is
*restricted* by a service tag (what 2.1 can do today) and one that is **not reachable from the internet
at all**. That is the property this plan actually wants. Standard DNS-fronting plus a firewall rule is
a weaker control for a smaller saving.

- **Do:** Front Door Premium, WAF in Blocking (not Detection), origin via Private Link, `allowInsecure`
  off, health probe on `/api/health`, and set `lockIngressToFrontDoor = true` once the origin is private
  — at which point the `AzureFrontDoor.Backend` rule and the `X-Azure-FDID` check become belt and
  braces rather than the control.
- **Condition:** the `:3010`/`:3011` verification story must work through Front Door alone (route by
  port where possible, otherwise verify on the revision's own FQDN with the script's existing health
  gate). If that turns out to be impossible, say so explicitly and keep App Gateway for the port
  listeners — but then budget it as a deliberate cost, not an accident.
- **Cost:** ~$330/mo before traffic, plus per-request and WAF charges. This is the largest single line
  in the go-live budget and belongs in the plan on purpose.

### 8.7 — D2: the password role now, Entra later — with one clause that applies either way

**Recommendation: 8.1's role now, Entra as a planned follow-up. In both cases, the application never
holds the administrator credential, and the admin's vault access is narrower than the app's.**

The migration path is the point: if the app starts on a least-privilege role, adopting Entra later is a
connection-string change (plus the token wrapper). If it starts as the admin, adopting Entra later
still leaves the ownership problem from 8.1 to solve.

### 8.8 — D3: deferred, with a trigger

**Recommendation: defer, as §8.2 argues, and record the trigger rather than a date** — a contract that
requires no public registry endpoint, or a VNet-integrated build. A date would only create pressure to
spend $40/mo on the wrong control.

### 8.9 — D4: closed

**Recommendation: closed as decided and implemented — with one correction from the review §5.** The
template no longer owns the running image: `imageTag` has no default, and the script passes what is
actually running. Traffic is handled differently from the original decision, which was to declare no
`traffic` block at all: omitting it does not preserve traffic, because a deployment is a PUT of the whole
resource and an absent rule reads as the default, `latestRevision: true, weight: 100`. The template
therefore *declares* the rule and restates `activeRevision` — the revision the script reads before it
creates a new one. Traffic is still moved only by the promotion path, after the health gate.
`preflight.mjs` fails if an `imageTag` default reappears, if `activeRevision` stops being the traffic
target (or gains a default that names a revision), if `activeRevisionsMode` is not Multiple, or if the
script stops reading and passing the serving revision.

### 8.10 — The workflow defect: fixed in the next infrastructure change

`.github/workflows/deploy-azure.yml` created the migration job with `--mi-system-assigned` and no
`DATABASE_URL` — the defect 1.8 fixes in the script, on the path a production deploy actually takes, so
every push to `main` stopped at the migration step.

**Done** in the review's follow-up (§3 of the review): the step reads the app's user-assigned identity,
passes `--mi-user-assigned`/`--registry-identity`, supplies `DATABASE_URL` as a `keyvaultref:` secret
with `identityref:`, and updates-then-starts the job when it already exists — mirroring
`deploy-env.ps1`, which remains the reference for both.

### 8.11 — The go-live bar I would hold

Minimum before a production deployment, in this order, leaving 2.8 and secret expiry to follow:

1. **2.3** — the least-privilege role (8.1). Still open, and deliberately not part of the review
   follow-up (§7 of the review, tracked separately). **Deferred by the operator's decision on
   2026-10-09** — not dropped, and not to be forgotten: it is the last High item, and after production
   holds data it becomes a credential rotation as well as a change of grants.
2. **2.9** — `verify-full` with the bundle in the image (8.4).
3. **2.1 + D1** — the ingress decided (8.6) and the origin not publicly reachable, with the
   `X-Azure-FDID` check in the API.
4. ~~The workflow fix (8.10)~~ — **applied**: the pipeline's migration step now uses the app's
   user-assigned identity, so this is no longer a bar item.
5. **The four §3 checks** that only a subscription can confirm, run against dev first, then prod with a
   saved `what-if`.

### 8.12 — The database is named `c7ntax`, and why the name is not a secret

**Applied 2026-10-09.** The template created a database called `c7_overwatch`, after a product this one
absorbed. It is now **`c7ntax`**, named for the product it holds.

The question this answers — *should the database have a common name, or a randomly generated one?* — is
answered **common name**, and the reasoning belongs here because it is the kind of thing that gets
re-litigated:

- **A database name is an identifier, not a control.** Reaching this server requires network
  reachability *and* a credential, and the name is involved in neither. Anyone who can connect can list
  databases — `pg_database` is readable — and the name is printed in every connection string, diagnostic
  log and `psql` invocation the moment it is used. A name held only in Key Vault is a name that is not
  held only in Key Vault.
- **What protects the server, in the order it matters:** the private network (this server is
  VNet-injected with no public endpoint — §9.1), authentication without a stored password (Entra, D2),
  the role the app connects as (2.3/§8.1), `sslmode` verification (2.9/§8.4), and `pgaudit` plus
  Defender to notice a breach if one happens (2.6).
- **Obscurity has a cost that is paid in an incident.** A name nobody can reconstruct is a name that
  lives in fewer heads, and in a restore-at-3am the name is one of the few things you need *before* you
  can read anything. Predictability is a feature in recovery, and automation, runbooks, dashboards and
  backup policies all reference this name.
- **The narrow cases where a random name helps** are a shared server with several tenants' databases on
  it, and a staging environment that is reachable from the internet and scanned. In both, the correct
  fix is `REVOKE CONNECT` and a network rule; a random name decorates the problem. This deployment has
  neither: one database, one server, no public endpoint.

**Blast radius, all updated in the same change:** the `database` resource and the `DATABASE-URL` secret
in `infra/main.bicep` (now one home: `param databaseName = 'c7ntax'`); the `DATABASE_URL` example in
`infra/env/.env.production.example`; §8.1 and the 2.3 row above.

**The local development database was renamed as well, on 2026-10-09**, because the alternative was a
document that says one name while every developer's machine says another. It cost ten minutes and it did
not need a reseed:

- `ALTER DATABASE c7_overwatch RENAME TO c7ntax` is **metadata-only** — every table and row moved with
  it. Verified afterwards: 119 tables in `public`, 104 tickets, 17 users, and the API answering
  `/api/health` with `{"status":"ok"}` and the queue rendering through the interface.
- It needs **no other session connected** to the database, so the dev API was stopped for it and
  restarted; a running pool blocks the rename with a clear error rather than doing anything half-way.
  The failure mode is "it refuses", never "it loses data".
- One line followed it: `apps/api/.env`, the only live reference to the name outside the templates
  (`.env` is not in the repository, so this was a local change and not a commit).
- Nothing in the repository *creates* the local database — no `CREATE DATABASE`, no compose file — so
  the old name cannot come back by accident. The only other mentions are historical: BuildNotes entries
  describing the earlier infrastructure work, and the generated copies of that changelog.

### 8.13 — The first-run hand-off: applied as option (b)

**Applied 2026-10-09.** §4 of the review found that a first deployment into an empty environment could
not finish, and that the fix it recommended — moving the ingress port — was not enough, because a probe's
`port` belongs to the **revision template** while `--target-port` moves the **ingress**. The reviewer's
option (b) was recorded as the correct fix and deliberately not implemented then, because a flow change
wants a real run rather than a second blind edit. It is implemented now; the real run is still owed.

**What it does.** The app is created **once, against the real image**, in two passes:

1. **Pass 1** (`createApp=false`) — everything except the app, the container registry above all, since
   the image step builds into it.
2. **Image** — built and pushed, unchanged from before.
3. **Pass 2** (`createApp=true`, `imageTag=<the tag just built>`, no `activeRevision`) — the app is
   created with the image it will actually run, so its probes are on port 4000 from its first breath.
   The port hand-off that made the old first run fail cannot happen, because there is no hand-off.
4. From there the run continues through the **same** migration, revision, health-gate and traffic steps
   every later deployment uses — so a first run exercises the normal path rather than a special one.

`infra/main.bicep` gained `param createApp bool = true` and a conditional app resource
(`if (createApp)`), with the `containerAppFqdn` output tolerating its absence. Checked rather than
assumed: the app is referenced in exactly three places in the template — its declaration, that output,
and a comment — because there is **no Front Door module and no migration job in this file** (the script
owns the job). Every other deployment path is the single pass it was: a normal redeploy never passes
`createApp`, and the deployment workflow never calls the creation path at all.

**Three caveats, stated because a reader will otherwise assume more than is true:**

- **Nothing has run against Azure.** The two-pass create, pass 2's revision and the first `-WhatIf` are
  all compiled, parsed and reviewed, not executed. That is the same bar as everything else in this plan.
- **Pass 1 depends on the default (incremental) deployment mode.** No `--mode` is passed anywhere, and a
  `Complete`-mode deployment with `createApp=false` would **delete** the app rather than skip it. The
  comment says so in the script, next to the call.
- **On a first run the health gate does not hold the revision at 0%.** The gate's guarantee — traffic
  never moves before a revision has been checked — comes from the template's `traffic` rule restating
  the *serving* revision, and on a first run there is nothing serving to restate, so the app's first
  revision takes traffic and is then checked. Nothing that was working is at risk (there is no previous
  deployment), but the property belongs to redeploys and should not be claimed for first runs.

**Verified here:** the templates compile with Bicep CLI 0.48.1 and **0 warnings**; `deploy-env.ps1`
parses with **0 errors** under Windows PowerShell 5.1; the `-WhatIf` path describes both passes in order;
and the three cases — first run, redeploy, dry run — were read back from the code. The infrastructure
contract guards still pass (`imageTag` with no default, `activeRevision` defaulting to `''` and used as
`revisionName`, `activeRevisionsMode: 'Multiple'`, the script still reading `properties.trafficWeight`).

### 8.14 — Review round 2: the workflow's second push, and a gate that could not see the database

**Applied 2026-10-09.** Two findings from `PLAN-030-Review-Round-2.md`, both accepted, fixed and
exercised locally — **compiled and run against the dev instance, not against Azure**.

- **The workflow's `job update` path passed creation-only flags.** `az containerapp job update` accepts
  `--image` and neither `--mi-user-assigned` nor `--registry-identity` (checked against the CLI's own
  reference, since no Azure CLI is installed here). The first push took the `create` branch and worked;
  **every push after it** took the update branch and failed at the migration step. Both the workflow and
  `deploy-env.ps1` now move only the image, which is all that needs to move — identity, the registry pull
  identity, the Key Vault secret reference and the env var are set at creation and persist.
- **The promotion gate could not see the database.** `/api/health` proves only that Node is listening, so a
  revision with a wrong `DATABASE_URL`, an unreachable server, a rotated password or a failed migration
  passed the readiness probe and both gates and took 100% of traffic. `GET /api/ready` now runs a
  `SELECT 1` with a 2 s budget and answers `{ "status": "ready" | "not-ready" }` — with nothing else in
  the body, because it is unauthenticated. `?deep=1` adds "the newest migration this image ships has been
  applied". The **readiness probe** and **both gates** ask it; the **liveness probe** is deliberately left
  on `/api/health`, because a liveness check that queries the database restarts every replica in a loop.
- **The first-run interaction is resolved by keeping the probe shallow.** On a first run the app is created
  before the migration job, so a probe that waited on migration state would hold the revision at 0% — and
  the migration question is only answerable after migrations have run. Only the two gates pass `deep=1`.
- **A defect in my own first version, worth recording because it is the same class of mistake as the
  finding.** The timeout helper resolved *whether the work finished* rather than *what it answered*, so
  the deep check computed `false` correctly and the gate read `true`: it could never fail. It surfaced by
  shipping a fake migration directory so the newest migration was definitely unapplied and **expecting**
  `503` — the endpoint answered `200`. With that fixed, the three states are: healthy `200/200`; an
  unapplied migration shipped in the image `200` shallow / **`503` deep**; probe removed `200/200`.

**Verified here:** `npx tsc --noEmit` clean in `apps/api` and `apps/web`; `check-route-guards.mjs` passes
(436 routes); `validate-bicep.mjs` compiles all three files with **0 warnings**; `preflight.mjs` reports
only the two known pre-existing failures; and the endpoint was exercised live in all three states above.
**Not run:** the runner's CLI version, and any real deployment.

## 9. Two review comments, assessed
### 9.1 — "Probably don't need geo redundancy. That'll shave the cost."

**That comment was answered, and the answer was wrong. It is reversed: geo-redundant backup is on in
prod and off in dev (§9.3).**

Three things this template calls redundancy are worth separating, because only one of them is geo — and
the conclusion is no longer the one this section first drew.

| Where | What it actually is | Cost | Verdict |
|---|---|---|---|
| `postgres.backup.geoRedundantBackup` | Backups replicated to the **paired region** | ~$10–30/mo at 128 GB | **On in prod, off in dev — reversed after the review (§1 of the review)** |
| `postgres.highAvailability.mode = 'ZoneRedundant'` in prod | A standby in a **second availability zone, in the same region** | ≈ doubles the compute — about **$130/mo** | **Deliberate: this is the availability decision. `SameZone` costs the same and survives less — `Disabled` is the only ×1 mode** |
| `containerAppsEnvironment.zoneRedundant` in prod (2.11) | Replicas spread across zones | small | Keep |

**Why the original reasoning did not hold.** It said there was "nothing to restore *to*", which treats the
compute as the hard part. Here it is the easy part: the VNet, the Container Apps environment, the vault
and the registry are all in `infra/main.bicep` and can be redeployed into the paired region in about an
hour. **The data is the one thing that cannot be rebuilt**, and a geo-redundant backup is the only copy
of it that survives losing the region. It is not the second half of an unwritten disaster plan; it is the
precondition for ever writing one.

**And it cannot be added later.** Microsoft documents geo-redundant backup storage for Flexible Server as
settable **only at server creation**; it cannot be changed on a server that already exists (*Backup and
restore in Azure Database for PostgreSQL – Flexible Server*). A prod server created without it can only
gain it by being rebuilt as a new server and having its data migrated into it. That is a one-way door and
the reason this is the review's highest-priority finding rather than a cost preference; everything else
in the template is reversible by redeploying it. The alternative is not "keep it off until the second
region exists" — it is to accept in writing that the only copy of the data that survives losing the
region does not exist, rather than assume the switch will still be there later.

So: **geo on in prod, off in dev**, and **zone redundancy kept as a conscious choice** — one word,
`postgresHaMode`, whose description states what each mode buys and what each one costs.

Two things to carry forward:

- **Confirmed against documentation, no subscription needed:** the creation-time constraint above. It was
  a *(verify)* in both this section and the template, and it is a fact: prod has to have geo-redundant
  backup from the first deployment, because there is no later deployment that can add it.
- If a contract or a SOC 2 commitment requires region-level backup retention, the honest answer is still
  to **build the second region** — the backup is what makes that possible, not a substitute for it.

On *"it did find some security issues in the design so I'd check those"*: agreed, and they are already
triaged in this plan. §1 is the set that stops the deployment working at all; of the High items, **2.2**
and **2.4** are applied, **2.1** is behind a switch waiting on D1, and the one that matters most is still
open: **2.3**, the application connecting as the server administrator. §8.11 is the short bar.

### 9.2 — "Getting reservations configured will bring the price down a lot."

**Agreed — it is the single largest saving available on this design.** Concretely, for the SKUs this
template deploys:

| Instrument | Covers | Typical saving | Buy it when |
|---|---|---|---|
| **PostgreSQL Flexible Server reserved capacity**, 1 year (3 year is bigger) | The Postgres **compute**, the largest line | ~35–40% (3-year ≈55%) | **After the HA decision settles** — a standby is billed in *both* HA modes, so reserve **×2** the SKU for `ZoneRedundant` **or** `SameZone`, and **×1** only for `Disabled`. A reservation sized ×1 on the belief that `SameZone` halves the compute under-reserves by half |
| **Container Registry Premium reserved capacity**, 1 year | The ACR Premium daily fee (~$50/mo) | Modest but certain | Once prod's registry exists |
| **A savings plan for compute**, or the service's own reserved offering if the region has one | Container Apps compute | Variable | After 30 days of real usage, when the always-on floor is known |
| **Log Analytics commitment tier** | Ingestion | *Do not buy it* — at 5–10 GB/month the per-GB tier is cheaper; a commitment tier is for ≥100 GB/day | Only if ingest grows by an order of magnitude |
| Stop the dev database out of hours | Dev Postgres compute | ~30–40% of the dev line | Immediately — a runbook job, not a purchase |

**Why none of it is in the code.** A reservation is a **purchase against a live subscription**, priced
per SKU *and* per region, and it depends on decisions that are still open: the HA mode decides the
Postgres reservation size, and D1 decides whether Front Door Premium is bought at all. Buying now
reserves the wrong thing — so the deliverable here is a shopping list, not a parameter.

**Do these two things at the same time as the purchase:** a **Cost Management budget alert at 80%** of
the figure you choose (the mechanism that catches a wrong estimate, rather than a better table), and a
diary note for the **30-day** mark, because that is when the always-on floor is real rather than
guessed.

*(I am deliberately not asserting Container Apps' eligibility for a savings plan as fact — it varies by
offer and region, and a verify item is more useful than a confident error.)*

### 9.3 — What was applied, and what the review changed

- **`geoRedundantBackup` is on in prod and off in dev**, exposed as `postgresGeoRedundantBackup`
  (allowed values `Enabled`/`Disabled`). It was off in **both** environments when this plan was applied;
  the review reversed that for prod, because the property is settable **only at server creation** and
  the data is the one thing here that cannot be rebuilt. The reasoning is written beside the parameter
  in `infra/main.bicep`.
  **Verified:** the templates still compile with Bicep CLI 0.48.1, no warnings.
- **The HA parameter's description now states the consequence correctly**: `postgresHaMode` says that a
  standby is billed in **both** HA modes — `ZoneRedundant` survives the loss of an availability zone,
  `SameZone` only a host failure — and that `Disabled`, with no standby, is the only ×1 mode, so the
  ~$130/mo decision is legible where it is made. (It previously said `SameZone` "halves the compute",
  which would have bought nothing and cost zone resilience.)
- **§4's storage-and-backup line goes up, not down.** Prod's backups are geo-redundant now, charged at
  a higher rate than local copies: roughly **$10–30/mo** at 128 GB with 35-day retention, already
  reflected in §4. Worth confirming in the calculator, and still far smaller than the two levers above
  it.

### 9.4 — The reservation shopping list, from the template's own defaults

Take these to the reservations blade *after* the HA and D1 decisions, and confirm the resolved SKUs from
a saved `what-if` rather than from this table:

1. **PostgreSQL Flexible Server**, `Standard_D2ds_v5` / `GeneralPurpose`, **×2 for *either* HA mode —
   `ZoneRedundant` or `SameZone`, because both bill a standby — and ×1 only for `Disabled`**, in the
   deployment region, 1 year. Only `Disabled` halves the compute; the two HA modes cost the same.
2. **Azure Container Registry**, Premium tier, 1 registry, 1 year.
3. **Container Apps compute** via a savings plan for the always-on floor — amount from 30 days of
   observed usage, not from an estimate.
4. **Nothing** for Log Analytics, Key Vault, private DNS, private endpoints or the VNet: none of them
   has a reservation, and the commitment tier is the wrong shape at this volume.
5. **Dev**: nothing reserved. Stop the database out of hours instead, which is a bigger saving on that
   line than any reservation would be.



