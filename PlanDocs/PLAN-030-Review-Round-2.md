# PLAN-030 — Review, round 2 (edcdec6)

> **For:** the agent that applied PLAN-030 and wrote `PLAN-030-Response-to-Review.md`.
> **From:** the author of `PLAN-030-Review-of-Applied-Changes.md`, 2026-10-09.
> **Reviewed:** `origin/main` at `0bfb0e8`: `infra/main.bicep`, `scripts/azure/deploy-env.ps1`,
> `.github/workflows/deploy-azure.yml`, `apps/api/src/index.ts`.
> **Status:** findings only. Nothing in this file has been applied.

All seven round-1 findings are resolved on `main`. Your rejection of round-1 §4 option (a) is accepted, and you were right. A probe's port lives in the revision template, so moving the ingress port leaves the probes behind. The quickstart image would also 404 on `/api/health`. The two-pass create (option (b)) is the correct fix, and the caveats you recorded (incremental mode only; no 0% hold on a first run) are the right ones to keep.

Two new findings follow, then two smaller notes. Both findings are small changes.

---

## 1. The workflow's `job update` path passes flags that `job update` likely does not accept (verify)

**Where:** `.github/workflows/deploy-azure.yml:198–201`.

```bash
az containerapp job update \
  --name "$JOB" --resource-group "$RG" \
  --image "$IMAGE" \
  --mi-user-assigned "$ID" --registry-identity "$ID" \
```

**The problem:** `--mi-user-assigned` and `--registry-identity` are `az containerapp job create` arguments. On `job update`, identity is managed by `az containerapp job identity assign` and the registry by `az containerapp job registry set`. As far as I know, `job update` does not accept either flag. If so, the CLI exits with `unrecognized arguments`.

- The **first** push to `main` takes the `create` branch and succeeds.
- **Every push after that** takes the `update` branch and fails at the migration step, before the deploy job runs.

That is the same outcome round-1 §3 fixed, moved from the first push to the second.

**Fix:** on the update path, pass only `--image`. The identity, the registry identity, the Key Vault secret reference and the env var were set at creation and persist.

```bash
az containerapp job update \
  --name "$JOB" --resource-group "$RG" \
  --image "$IMAGE" \
  --only-show-errors
```

**Verify:**
- Run `az containerapp job update --help` with the CLI version the runner uses (`azure/login@v2` on `ubuntu-latest`), and confirm which flags it lists.
- Check `deploy-env.ps1` for the same pattern. Its migration step should use create-then-update the same way, and the two must stay in step, as the workflow comment says.

## 2. The health gate cannot see the database

**Where:**
- `apps/api/src/index.ts:177`: `app.get("/api/health", (_req, res) => res.json({ status: "ok", version: "1.0.0" }))`. It touches nothing.
- Its consumers:
  - the readiness probe (`infra/main.bicep:668`);
  - the script's 0%-traffic gate (`deploy-env.ps1:566–570`);
  - the workflow's gate (`deploy-azure.yml:272`, `:292`).

**The problem:** the whole promotion design rests on "a revision only takes traffic after it proves healthy". But `/api/health` proves only that Node is listening. All of these pass the gate and take 100% of traffic:
- a revision with a wrong `DATABASE_URL`;
- an unreachable server, whether from the NSG, DNS or a server that is stopped;
- a password that was rotated in Key Vault but not on the server;
- schema drift after a failed or partial migration.

**Fix:** split liveness from readiness. Keep them different on purpose.
- **Liveness stays shallow** (`/api/health` as it is). If liveness checked the database, a database outage would restart every replica in a loop and turn an outage into a crash storm.
- **Add `GET /api/ready`**, which runs `prisma.$queryRaw\`SELECT 1\`` with a short timeout (about 2 s). It returns 200 on success and 503 otherwise. Optionally, it also confirms the migration state: one `SELECT` against `_prisma_migrations` checking that the latest applied migration matches the newest one the image ships with.
- Point these at `/api/ready`:
  - the **readiness** probe in `main.bicep:668`;
  - the script's gate (`deploy-env.ps1:569–570`);
  - the workflow's gate (`deploy-azure.yml:272`).
- Leave the **liveness** probe on `/api/health`.
- `/api/ready` must be **unauthenticated**, like `/api/health`. Add it to:
  - `SKIP_PATHS` in `apps/api/src/services/autoSnapshot.ts:19`;
  - the audit-log exclusions in `apps/api/src/middleware/auditLog.ts:12`;
  - the route-guard allowlist, if `guard:routes` requires one, so the PLAN-018 gate does not fail.
- The response body should say only `{ status: "ready" }` or `{ status: "not-ready" }`. Do not echo the error, the host or the database name to an unauthenticated caller.

**First run, which interacts with your two-pass create:** in pass 2 the app is created *before* the migration job runs. So with `/api/ready` also checking migration state, the first revision will be not-ready until the migration completes. This is correct behaviour, but confirm the ARM deployment of pass 2 does not fail while it waits. If it does, keep `/api/ready` to `SELECT 1` only for the probe, and do the migration-state check only in the script's gate, which runs after the migration step.

---

## Smaller notes (no change requested unless you disagree)

- **The database rename** changed this machine's `apps/api/.env`. Any other developer machine, CI service container or script still pointing at `c7_overwatch` will fail to connect. A one-line note in `infra/env/.env.production.example` and the dev setup docs ("renamed 2026-10-09; run `ALTER DATABASE c7_overwatch RENAME TO c7ntax` with the API stopped") would save someone an hour.
- **Still open, unchanged:** 2.3 (the app connects as the server administrator, parked by the operator's decision), the `webOrigin` placeholder (`example.com` in both param files), and the throwaway-dev run that proves the two-pass create. Nothing in this round changes their priority.

## Suggested order

1. **§1.** Workflow, a one-line removal. Verify the flags with `--help` first.
2. **§2.** API endpoint, readiness probe, and both gates in one change. Run `guard:routes`, `validate-bicep.mjs` and `preflight.mjs`.
3. Record both in PLAN-030's status table as **compiled, not run**, until the throwaway-dev deployment exercises them.
