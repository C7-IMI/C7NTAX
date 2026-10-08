# PLAN-029 — Deferred work and known risks: the things that must not be fixed casually

> **Filed:** 2026-10-08, at the operator's request: *"complete any items you have left over … The only
> items I don't want you to finish are things that will break the app. List them in a plan doc."*
> **What it is:** the register of everything found during the 2026-10-08 sessions that was **not** fixed,
> with the evidence, the reason it was left, and what doing it properly costs. Each entry says plainly
> whether it is *deferred because it would break something* or *deferred because it is a decision the
> operator owns*.
> **What it is not:** a roadmap. PLAN-026's write phase, PLAN-028's assistant cross-links and the other
> unbuilt phases live in their own plans; this file is only about work that already exists in the
> repository in a state that needs a decision.

**Priority order** — the first two to read if nothing else: **§1 (secrets committed in the snapshot)**,
because its remediation includes rotating credentials and rotation is a clock the repository cannot reset;
then **§6 (`audit-logs` answers any signed-in caller, unfiltered)**, because it is the one open item that is
an authorization gap rather than a deferred improvement.

---

## 1. The snapshot is committed, and it carries secrets

**What it is.** `apps/api/src/snapshot-capture.ts` dumps database tables into
`apps/api/src/snapshots/*.json`, and those files — plus a delta per table under
`snapshots/deltas/` — are **tracked in git**. Several of the tables it captures carry credentials.

**Evidence.**

| Where | What is in the repository |
| --- | --- |
| `apps/api/src/snapshots/integrations.json` | `credentials` as **plaintext JSON** for every connector. The rows present at the time of the audit were `connectwise` (`baseUrl`, public/private key pair) and `microsoft365` (client secret). This is a live credential in a text file. |
| the same file | the capture's own `select` for `integration` deliberately includes `credentials: true` — so this is not an oversight in the table list, it is in the filter that exists to omit sensitive fields |
| `apps/api/src/snapshots/kumo-passwords.json` | `encryptedPassword`, `iv`, `authTag`, `encryptionKeyId` — AES-256-GCM ciphertext — **plus** `username`, `url`, `label`, `companyId` (which client has an account on which system) and a `totpSecret` column that is stored in plaintext when set |
| `apps/api/src/snapshots/users.json` | the whole `user` row, including `passwordHash`, `mfaSecret`, `mfaBackupCodes` |
| `apps/api/src/snapshots/` | email connectors (encrypted with the same key as the vault), API-key rows, portal configuration, AI provider keys |

**How bad is the ciphertext?** The Kumo vault key is derived in `apps/api/src/services/kumoCrypto.ts` from
`KUMO_MASTER_KEY`, falling back to `sha256("kumo-vault:" + JWT_SECRET)` and then to a **constant published in
the source** (`C7NTAX-dev-secret-change-in-prod`). Production refuses to boot without a real `JWT_SECRET`, so
a production dump is not decryptable from the repository — but a **development** dump is, because the
fallback key is in this file. Anything typed into a dev vault is therefore recoverable from git.

**Why it was not fixed here.** The capture and the restore are a pair: `seed-from-snapshots.ts` re-seeds with
`model.createMany({ data: rows })`, so removing a required column from a snapshot makes the seed throw, and
`verify-post-change.ts` falls back to `seed-full` when counts are low. Redacting fields without teaching the
restorer to substitute safe placeholders (a known-hash password for users, empty credentials for
integrations) would trade a leak for a broken re-seed — which is the line the operator drew.

**What doing it properly costs.**

1. Add `select` lists to the sensitive tables in `snapshot-capture.ts` (the mechanism already exists — it is
   how `integration` should have been written).
2. Teach `seed-from-snapshots.ts` to fill the redacted fields with placeholders, and document per table what
   a restored row cannot do until someone re-enters it (connectors re-authenticate; vault entries are empty;
   users get a reset password).
3. Re-capture, and accept one large diff as every tracked snapshot loses those columns.
4. **Then rotate**: the ConnectWise keys, the Microsoft 365 client secret and any vault entry that was ever
   typed into a development instance are compromised by having been in a repository, and only rotation fixes
   that. Rewriting history is a separate decision — assume the history is public and rotate instead.
5. Worth considering at the same time: should the snapshots be *fixtures* (a small, synthetic dataset,
   regenerated from `seed.ts`) rather than a dump of whatever the developer's database happened to contain?

---

## 2. `apps/api` builds a tree its own `start` script cannot run

**What it is.** `apps/api/tsconfig.json` declares no `rootDir`, and the root tsconfig resolves `@C7NTAX/*` to
**source**, so the API's program includes `packages/shared/src/**` and TypeScript infers the repository root
as the common source directory.

**Evidence.** `pnpm --filter @C7NTAX/api build` exits 0 and emits `apps/api/dist/apps/api/src/index.js` and
`apps/api/dist/packages/…`. `apps/api/package.json` has `"start": "node dist/index.js"`, and
`apps/api/dist/index.js` does **not** exist. Nothing in the repository runs `start`, and the two workflows
that deploy (`deploy-azure.yml`, and the production `start:production` script which runs `src` through
`tsx`) do not depend on `dist`.

**Why it was not fixed here.** Every way to fix it changes how production starts: either the emitted path
changes (a real emit, which needs project references across the workspace) or `start` must name
`dist/apps/api/src/index.js` — which would enshrine the mirror as intended. The deployment question is the
operator's.

**What doing it properly costs.** Either:
- **Project references.** `composite: true` in `packages/*`, `references` from `apps/api`, `tsc -b` in the
  build script, declarations consumed from `dist` instead of source. Correct, and a workspace-wide change to
  how every package is compiled and how every import resolves; or
- **Name what is produced.** `"start": "node dist/apps/api/src/index.js"`, one line, no migration, and a
  permanent comment explaining why the path looks wrong.

The same root cause produced the two `TS6059` failures fixed in 2026.10.8.046 — those packages carried a
`rootDir` the API does not, which is why the error appeared there and not here.

---

## 3. `src/routes/tenants.ts` is written and never mounted

**What it is.** `apps/api/src/routes/tenants.ts` exports `tenantRouter` with a full multi-tenancy surface.
`src/index.ts` does not import or mount it, so every route in it is unreachable. The route-guard script
reports it on every run: *"declared but never mounted (not documented)"*.

**Why it was not fixed here.** A router that is never mounted is not a bug in anything that ships, and
mounting it changes the API surface — a new set of tenant routes would appear for whoever holds their
permissions, with no client that uses them. Removing it would delete a feature somebody wrote deliberately.

**What doing it properly costs.** Decide which it is. If tenancy is wanted: mount it, guard every route,
document it in `docs/openapi.yaml` and `docs/API.md`, and add it to Help. If it is not: delete the file, and
the note disappears from the guard output. Half-measures keep the guard note permanently noisy, which is how
guard output stops being read.

**Related, and done:** `src/routes/users.ts` carried a **second, unmounted** `rolesRouter`, with a note
saying deleting it was a follow-up. It was deleted on 2026-10-08 (`users.ts` lost 77 lines) once the mounted
`roles.ts` was confirmed to serve the permissions catalogue to the SPA from `@C7NTAX/shared` anyway.

---

## 4. `guard:console` verifies routes, permissions and flags — not that a declared column exists

**What it is.** `scripts/check-console-catalog.mts` proves every command's path resolves to a real route, its
permission is the one that route checks, and every flag it offers is a parameter that route reads. It does
**not** check that a declared column (`{ header: "PHONE", path: "phone" }`) exists in a response.

**Evidence.** The client noun declared `shortName`, `status` and `type`; a `Company` row carries
`clientId`, `companyType` and `isActive`. Every client row printed three em dashes, and the subject lookup
was matching on fields that do not exist, for as long as the catalogue has existed. It was found by looking
at a screenshot, not by a check. Fixed in 2026.10.8.045, but the gap that allowed it is still open.

**Why it was not fixed here.** A column check needs a *response* to check against: either a live API
(authenticated, as a permitted caller, for one command per noun) or a recorded sample per command. That is a
probe, not a lint — a different kind of check with a different failure mode, and it belongs with the other
probes rather than in the pre-commit path.

**What doing it properly costs.** `apps/api/probe-console-columns.mts`: for each command with declared
columns, run it with a small `--limit` and assert that every declared path resolves to a non-undefined value
in at least one row (and report the ones that resolve nowhere). ~120 lines, needs a running API, and it will
find the remaining wrong descriptors — which is the point.

---

## 5. Smaller things, recorded rather than fixed

| Thing | Why it is left | Cost |
| --- | --- | --- |
| `packages/shared/dist` exists on disk with stale output | Gitignored build output from an earlier `pnpm build`; nothing reads it (`main`/`types` point at `src`) | `pnpm clean` |
| `apps/desktop` build retries an `EPERM` rename under OneDrive | The packaging step renames `win-unpacked.tmp` and OneDrive holds the directory; it retried and succeeded | Move the repo out of a synced folder, or exclude `dist-electron/` |
| `probe-permissions.mjs` leaves chat sessions if it is killed outright | A `finally` cannot run on `SIGKILL`; the residue cleaner sweeps its named rows, and the probe now removes its own sessions on every path it controls | Acceptable; the cleaner is the backstop |
| `USER_PERMISSION_CATALOG` served to the SPA from `@C7NTAX/shared` | Intentional after the duplicate roles router was deleted — the catalogue in the UI and the catalogue the API enforces come from one file | None; recorded so nobody re-adds a route for it |
| The console prints nothing about Basic/Advanced in `context` | A rendering preference is not a command, and `help` lists commands | One line in `context` if it ever matters to a script |
| **A `.ps1` with non-ASCII and no UTF-8 BOM will not run on this machine** | Windows PowerShell 5.1 reads a BOM-less file as CP1252, so the three bytes of an em dash inside a *double-quoted* string become `â€"` — and PowerShell accepts the trailing U+201D as a string delimiter, ending the string early. Five scripts in the repository were unparseable for this reason. **Fixed** on 2026-10-08 by writing a UTF-8 BOM to the seven files that carry non-ASCII (`deploy-env.ps1`, `startup/c7ntax-boot.ps1`, `startup/security-scanners.ps1`, `c7ntax-restart.ps1`, `scripts/rollback-ui-p1.ps1`, `installer/outlook-addin/build.ps1`, `O365/New-C7NTAXMailboxApp.ps1`); all ten scripts in the tree now parse | Not guarded: an ASCII-only script that later gains a curly quote breaks again. A `check-powershell-encoding.mjs` in the security workflow (non-ASCII ⇒ BOM present) would close it in ~30 lines. Non-ASCII comments and single-quoted strings are harmless, so the rule is narrow |

---

## 6. `GET /api/system/audit-logs` answers any signed-in caller, unfiltered

**What it is.** The route carries no permission of its own — `systemRouter.use(authenticate)` is the only
guard on it, and the route is declared without `requirePermission`. The `mine=true` filter is opt-in, so
omitting it returns the last 500 audit rows for the whole instance: who changed what, with user ids, user
names and redacted change summaries.

**Evidence, measured 2026-10-08 against the dev API.** Signed in as `persona.tech@c7ntax.local` — a
technician whose permissions are the twenty in the `technician` role and no `system:config`:

```
GET /api/system/audit-logs?mine=true&limit=200  -> 200, 124 rows, 1 distinct user (their own)
GET /api/system/audit-logs?limit=200            -> 200, 200 rows, 9 distinct users
```

So the filtering that makes **My activity** safe (`/activity`, added in 2026.10.8.050) is done by the
caller, not by the route. The route's own comment says as much: `mine` "is narrower than the unfiltered
read the ticket view has always done, and it is the reason the menu needs no new endpoint and no new
permission".

**Why it was not fixed here.** It is an authorization change on a shared endpoint, and the unfiltered read
has a legitimate caller: a ticket's activity tab reads `entity=ticket&entityId=<id>`. Making the route
require `mine` or `system:config` would break that tab for every technician unless the ticket view is
changed in the same commit — which changes what a technician can see of a ticket's history and is a
decision for the operator, not a side effect of a UI change. It also sits in the `guard:routes` baseline
(433 routes, 382 guarded), so the change needs that re-run and any deliberate exception recorded.

**What doing it properly costs.** Three shapes, in the order I would try them:

1. **Scope the unfiltered read to what the caller may see** — require `entity` + `entityId` together and
   check the caller can read that record, so the ticket tab keeps working and a bare
   `GET /audit-logs` becomes a 403 for anyone without `system:config`. ~30 lines in `routes/system.ts`,
   plus an `apps/api` probe for the three cases (own rows, a permitted record, a bare unfiltered read).
2. **Require `system:config` unless `mine=true`**, and move the ticket tab to a ticket-scoped audit route
   that already exists or is added for it.
3. Leave the route and accept that any signed-in account — including a client contact if the portal shares
   this middleware — can read the instance's change history. This is the current state; it should be an
   explicit decision rather than an oversight.

**Related:** the same route is what makes a **client contact's** portal session interesting — worth
confirming whether the portal's `authenticate` reaches `req.user.userId` before deciding between the three.

---

## 7. How to use this document

Anything here that gets fixed should move into `BuildNotes.md` with its own version and leave a line in this
file saying where it went — the same rule the plan documents follow elsewhere in `PlanDocs/`. Anything that
is decided *against* should be recorded as decided, because a deferred item that nobody decided on is
indistinguishable from one that was forgotten.
