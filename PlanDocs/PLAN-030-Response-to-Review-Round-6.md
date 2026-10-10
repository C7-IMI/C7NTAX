# PLAN-030 — Response to review, round 6

> **For:** the author of `PLAN-030-Review-Round-6.md`.
> **From:** the agent that applied the fixes, 2026-10-10.
> **Answers:** `PLAN-030-Review-Round-6.md`, which checked the round-5 reply against `origin/main` at
> `584a96a1`.
> **Applied in:** BuildNotes **2026.10.10.003** — "A gate that is always red".
> **Status:** **R6-1 fixed.** **R6-2 answered, and preflight is green — 0 failures, 2 warnings.** One of
> the two failures was real and is repaired; the other was a false positive in the check itself. **Still
> not deployed, and so still not ready.**

---

## 1. R6-1 — the script now fails closed, like the workflow

You are right, and the two gates disagreeing on the same condition is the part that matters: whichever
one a given deploy happens to take decides whether an unreadable image is a stop or a shrug.

```powershell
# before — an empty read skipped the check and promoted
if ($runningImage -and $runningImage -notlike "*:$ImageTag") { throw … }

# after
if (-not $runningImage) {
    throw "Could not read the image on revision '$newRevision', so it cannot be checked against '$image'. Nothing has been shifted."
}
if ($runningImage -notlike "*:$ImageTag") { throw … }
```

The `-and` was written to tolerate a query that returned nothing, which is exactly the shape of a guard
that cannot fire in the case it exists for: the call is `2>$null`, so a CLI error and a revision with no
image both arrive as an empty string, and the deploy would have shifted traffic to a revision whose image
nobody had checked. The empty case now has its own message, because "cannot read it" and "it is the wrong
one" are different failures and a single message would hide which happened.

## 2. R6-2, first failure — the dependency baseline was real, not your sandbox

**Confirmed on a normal machine, and it reproduces.** With pnpm on `PATH`:

```
dependency audit: 7 advisories (3 in production), 4 accepted
unaccepted advisories (3):
  x handlebars GHSA-8r5x-fm3f-whwj (critical, production, … vulnerable >=4.0.0 <=4.7.9, patched >=4.7.10)
  x handlebars GHSA-p8wg-vrv2-v86f (critical, production, …)
  x handlebars GHSA-xw65-4hp5-5hc7 (moderate, production, …)
```

Two critical and one moderate, all in production, all one package: `handlebars@4.7.9`, reached through
`packages/email` (which declares `^4.7.8`, so the range was never the problem — the lockfile simply
resolved to the newest version at the time).

**Fixed** the way this repository fixes these: a floor in `pnpm.overrides` and in `pnpm-workspace.yaml`,
both, because the guard checks that the two lists agree — and it caught me: my first attempt added it to
`package.json` only, and `guard:deps` failed with *"handlebars@<4.7.10 is in package.json only — an
override only one package manager reads is a floor that stops applying."* That check earned its place
today.

```
dependency audit: 4 advisories (0 in production), 4 accepted
override parity: 13 security floors declared in both files
no unaccepted production or high-severity advisories
```

The bump is a patch release, and the thing that consumes it was exercised rather than assumed:
`pnpm probe:email` still reports **35/35**, which is the probe that renders every message through the
same template engine.

## 3. R6-2, second failure — one false positive in the check, then document-or-classify

Two things were wrong, and only one of them was the source.

**The check was reporting a variable that does not exist.** The first name in the list was `X`. It came
from `packages/shared/src/appConfiguration.ts`, where two *comment* lines explain a flag test by naming
`process.env.X`. The regex read prose written to document the pattern as a variable. A gate that reports
things that are not there is a gate people stop reading, so the scan now strips block and line comments
before it looks. That matters more than the one name: the check scans source for a pattern and reports
what it finds, and a comment is not source.

**Then every real name is either documented or carries a reason.** Not a bare allow-list — a `Map` of name
to reason, because the reason is the reviewable part:

- **Documented in the template** (six, each marked optional where the code has a default): `PUBLIC_BASE_URL`
  — and this one is worth reading, because behind the App Gateway an unset `PUBLIC_BASE_URL` serves an
  add-in manifest naming an internal host no user's Outlook can reach; `OUTLOOK_ADDIN_GUID`;
  `OUTLOOK_ADDIN_INSTALLER_DIR`; `C7NTAX_INTERNAL_API_BASE`; `EMAIL_OAUTH_DEPLOY_CLIENT_ID`;
  `EMAIL_OAUTH_SECRET_MONTHS`.
- **On the list with a reason** (six new): `WEB_PUBLIC_URL` and `APP_URL` ("an alias of `WEB_ORIGIN`, kept
  as a fallback in one place; `WEB_ORIGIN` is the documented name"), and the three `PROBE_*` plus
  `DEVADMIN_PASSWORD` (a probe's and a seed script's own tuning, defaulted, never set in a deployment).

The failure message now says what to do about a new name rather than only listing it, and the pass line
reports how many names are on the list, so its size is visible instead of accumulated.

**`node scripts/azure/preflight.mjs` now ends `0 failure(s), 2 warning(s)`** — the warnings being
uncommitted files in a working tree, and the skipped image build. That is your point answered: red now
means something, and the next red is a new fact rather than the fourth reading of an old one.

## 4. One correction to your re-run of the same-commit case

Worth recording because it is the case the whole round was about. You wrote that a re-run of the same
commit "passes by design and is correct: a re-run of the same commit returns the existing revision, which
ends in the same suffix and runs the same tag, so it proceeds and promotes the right image."

That is right for the *revision name*, and it is the property the change was for. It is not right for the
*deploy*: `az containerapp update --image` with the same tag does not return the existing revision
unchanged — it creates a new revision, and `latestRevisionName` is that new one, which is why the gate
then waits on a revision that has not served before. Either way the outcome is the one you describe —
traffic ends on an image with the right tag — so the conclusion stands; only the mechanism differs, and it
differs in the safe direction. The **rollback** case is the one where the suffix genuinely already exists
with a *different* tag, and that is the case the three assertions cover.

## 5. What has and has not run

| Check | Result |
|---|---|
| `preflight.mjs`, with pnpm on `PATH` | **0 failure(s), 2 warning(s)** — was 2 failures |
| `pnpm guard:deps` | 4 advisories, 0 production; override parity 13 floors |
| `pnpm --filter @C7NTAX/api probe:email` | 35/35 — the handlebars bump exercised the renderer |
| `pnpm install --lockfile-only` | clean; the lockfile diff is 6 insertions, 5 deletions |
| `deploy-env.ps1` | parses clean under PowerShell's own parser |
| `check-workflow-shell.mjs`, `check-encoding`, `validate-bicep`, `check-route-guards`, `check-api-docs`, `check-help-links` | pass |
| A real deployment, a forced rollback, the prod rehearsal | **not run** — needs a subscription |

**Note on running preflight locally**: this machine has no `pnpm` on `PATH`, so the first run reported
three failures that were all "pnpm is not recognized". With a shim in front the real picture appears. That
is worth knowing before the next person reads a red preflight as a red repository.

## 6. What is left

Your list is the right one and nothing has changed in it: **one replica until the background loops are
leader-safe**, the **`pgaudit` bootstrap**, the **second `prod` confirmation** after the what-if, a
**unique suffix per attempt** (now safe rather than correct — a collision is loud instead of silent), and
the **prod rehearsal**, which is the only thing that can prove the creation-time prod settings and Key
Vault private-endpoint resolution.

And the evidence that no static check can produce: **a dev deploy that includes a deliberate rollback.**
Until that runs, the package is compiled, parse-verified, shell-verified, dependency-audited and exercised
with stubs — **not deployed.**
