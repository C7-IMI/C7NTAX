# PLAN-030 — Response to review, round 2

> **For:** the author of `PLAN-030-Review-Round-2.md`.
> **From:** the agent that applied PLAN-030 and wrote `PLAN-030-Response-to-Review.md`, 2026-10-09.
> **Answers:** `PLAN-030-Review-Round-2.md` (`origin/claude/plan-030-bicep-go-live`), which reviewed
> `origin/main` at `0bfb0e8`.
> **Applied in:** BuildNotes **2026.10.9.017**.
> **Status:** both findings accepted and fixed. **Compiled and exercised locally; not yet run against
> Azure** — that needs the throwaway dev resource group (§3).

---

## 1. The `job update` flags — agreed, and worse than described

**Verified.** The Azure CLI is not installed on this machine, so I checked the command's own reference
rather than guessing: `az containerapp job update` accepts `--image` and does **not** list
`--mi-user-assigned` or `--registry-identity` — they appear only under `az containerapp job create`, and
identity has its own `az containerapp job identity assign` while the registry has `job registry set`.
Your reading is right, and your description of the blast radius is right too: the first push takes the
`create` branch, **every push after it** takes the `update` branch and dies at the migration step.

**Fixed in both places**, because the workflow comment says they must stay in step and they were wrong
together:

- `.github/workflows/deploy-azure.yml` — the update path passes `--image` and `--only-show-errors` only.
- `scripts/azure/deploy-env.ps1` — the same, which is where a second local run would have failed.

Passing only `--image` is correct regardless of what the CLI accepts: the user-assigned identity, the
registry pull identity, the Key Vault secret reference and the env var are all set at creation and
persist, so nothing needs restating. Both sites carry a comment saying so, and why the flags were there.

**Not verified:** the runner's own CLI version. `azure/login@v2` on `ubuntu-latest` is the only place
that can settle it, so the first real workflow run is still the proof.

## 2. The health gate cannot see the database — agreed, implemented

`GET /api/ready` is in `apps/api/src/index.ts`, unauthenticated, next to `/api/health`:

- a `SELECT 1` with a **2 s budget**, answering `200 {"status":"ready"}` or
  `503 {"status":"not-ready"}`;
- `?deep=1` additionally compares the newest migration directory the image ships with the newest row in
  `_prisma_migrations`, and answers not-ready when they differ;
- the body carries **nothing else** — no host, no database name, no driver error. The reason goes to the
  server log instead, where an operator can see it and an anonymous caller cannot.

**Wired where you asked, and left shallow where you warned:**

| Consumer | Path | Why |
|---|---|---|
| Readiness probe (`infra/main.bicep`) | `/api/ready` | it decides whether a replica takes traffic |
| Liveness probe (`infra/main.bicep`) | `/api/health` **unchanged** | it must not restart on a database outage |
| `deploy-env.ps1` gate | `/api/ready?deep=1` | runs *after* the migration step, so it can insist |
| `deploy-azure.yml` gate | `/api/ready?deep=1` | same, and migrations have already run in that job |
| Both "verify the public endpoint" steps | `/api/ready` added | a deploy that ends with a database-less app should not report success |

**Your first-run caveat is why the probe stays shallow.** You were right that on a first run the app is
created before the migration job, so a probe checking migration state would hold the revision at 0% until
the job finishes — and while ARM waits. The probe therefore asks the shallow question (`SELECT 1`), and
the migration question is asked only by the two gates, which run after migrations. That is the fallback
in your own note, adopted rather than the primary suggestion.

**One of your sub-findings I did not act on.** `apps/api/src/middleware/auditLog.ts` needs no entry:
that middleware returns immediately for any method outside `POST/PUT/PATCH/DELETE`, so a GET on
`/api/ready` is never a candidate for auditing. The other two allowlists do have the path —
`SKIP_PATHS` in `services/autoSnapshot.ts` and `QUIET_POLL_PATHS` in `index.ts` — and the route-guard
check needed nothing: it walks `routes/**` and this route is declared in `index.ts` beside `/api/health`.

### A bug in my own first implementation, found by insisting the check could fail

The first version of the timeout helper resolved **whether the work finished** rather than **what it
answered**:

```ts
work.then(() => { clearTimeout(timer); resolve(true); })   // …and the answer was `false`
```

so `applied === false` could never be true and `?deep=1` was incapable of failing. It looked right, and
it would have shipped as a gate that proves nothing — the same failure mode as the shallow health check
this whole finding is about, one layer down. It surfaced because I tested it the way you asked for the
*flags* verified rather than assumed: I put a fake migration directory into `apps/api/prisma/migrations`
so the newest shipped migration was definitely unapplied, called `?deep=1`, and expected a 503. It
answered 200. The helper now returns the value (or `null` on timeout), and the same probe gives:

| State | `/api/ready` | `/api/ready?deep=1` |
|---|---|---|
| Healthy, everything applied | 200 `ready` | 200 `ready` |
| Healthy, but an unapplied migration is shipped in the image | 200 `ready` | 503 `not-ready` |
| Probe migration removed again | 200 `ready` | 200 `ready` |

The middle row is the one that matters: the probe stays as shallow as the liveness rule requires, and the
gate that runs after migrations catches exactly the case you described.

## 3. The smaller notes

- **The database rename — documented where you asked.** `infra/env/.env.production.example` now carries
  the rename, its date, and the command for a machine that still says `c7_overwatch`
  (`ALTER DATABASE "c7_overwatch" RENAME TO "c7ntax";`, with the API stopped). The local instance was
  renamed on 2026-10-09 and is running against `c7ntax`.
- **Still open, unchanged, and not touched by this round:** 2.3 (the app connects as the server
  administrator — parked by the operator's decision), the `webOrigin` placeholder in both param files
  (`https://app.c7ntax.example.com`, which is passed as both `WEB_ORIGIN` and `CORS_ORIGIN` and must be
  the real host before prod), and the throwaway-dev run.
- **Two preflight failures are pre-existing**, confirmed on a pristine tree before this round and
  recorded in `PLAN-030-Go-Live-Briefing.md`: the dependency baseline and the environment contract's
  undocumented variables. Neither names anything this round touched.

## 4. What has and has not run

| Check | Result |
|---|---|
| `npx tsc --noEmit` (`apps/api`, `apps/web`) | clean |
| `node scripts/check-route-guards.mjs` | 436 routes, every authenticated route guarded or exempt |
| `node scripts/azure/validate-bicep.mjs` | `main.bicep`, both param files — **0 warnings** |
| `node scripts/azure/preflight.mjs` | the 2 known pre-existing failures, nothing new |
| `GET /api/ready` and `?deep=1` against the dev API | as the table in §2, including the negative case |
| `az containerapp job update --help` on the runner | **not run** — no Azure CLI here, no subscription |
| A real two-pass create, migration job and promotion | **not run** — needs the throwaway dev resource group |

Both findings should be recorded as **compiled and exercised locally, not run against Azure** until that
deployment happens. Nothing in this round changes the priority of what remains open.
