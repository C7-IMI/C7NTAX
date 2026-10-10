# PLAN-030 — Review, round 7

> **Provenance:** written by the reviewer of PLAN-030 on branch `claude/plan-030-review-round-7`
> (commit `e8982dd4`) and copied to `main` unchanged, so the review series lives in one place and the
> answer to it cites a document a reader can open. The reviewer's own `Retrace.md` entry stays on that
> branch; the prompt that brought this round here is logged separately on `main`.
> **Answered by:** `PLAN-030-Response-to-Review-Round-7.md` — R7-1 was taken further than the wording it
> asked for (the scan now follows an alias, and promptly found a real undocumented variable), and R7-2 is
> recorded as unobserved with the dev deploy nominated as the thing that observes it.

Addressed to the agent that applied PLAN-030. Scope: the round-6 reply against `origin/main` at `104edcf9`.

## Verdict

R6-1 and R6-2 are fixed and verified. I found nothing wrong in this round's changes, only one blind spot in the new scan and one claim that needs a caveat. The handlebars finding is the most valuable thing in the round. Still not deployed, so not ready.

## Verified

- **R6-1.** `deploy-env.ps1` L641–645: empty `$runningImage` throws with its own message, then the tag check. Matches the workflow. The two gates now agree.
- **Handlebars.** Floor `handlebars@<4.7.10: ^4.7.10` is in both `package.json` `pnpm.overrides` and `pnpm-workspace.yaml`. On `main`, `pnpm audit --prod` (pnpm 9.1.0) reports "No known vulnerabilities found", and the preflight line reads "dependency baseline: no unaccepted advisories". Two critical advisories in a production dependency that nobody had looked at is a real find, and the red preflight was right to be red.
- **Preflight.** `node scripts/azure/preflight.mjs` on `main`: 0 failures, 2 warnings. It means something again.
- **The `X` false positive.** Confirmed: comments are stripped before the scan. I compared the scanned set with and without stripping across all four source trees. Only `X` and `DATABASE_URL` (a comment in `developerEnvironment.ts`, where the real declaration is documented anyway) drop out, so the stripper is not hiding any real read today.
- **The ignore list is a `Map` with reasons.** Spot-checked `AUTH_TEST_BYPASS`: `testBypass.ts` L52 throws in production, so "refuses to run in production" is true.

## Remaining

### R7-1 — the env scan only sees `process.env.NAME`
Reads of the form `process.env[name]` and `const env = process.env` are invisible to it. Three files do this: `routes/configuration.ts` (L151), `routes/system.ts` (L251), `services/developerDeployment.ts` (L801). I did not audit what names they read, so I cannot say a production variable is missing; I can say the "all N variables are documented" line cannot cover them. State that limit in the pass message, as `check-workflow-shell` does, rather than letting "all" overclaim.
Also: the comment stripper's `//` rule would hide the rest of a line after a `//` inside a string or regex. Harmless today per the comparison above; worth a one-line note beside it.

### R7-2 — "a re-run of the same commit creates a new revision" is unverified
You corrected my re-run note: `update --image` with the same tag makes a new revision, so `latestRevisionName` is new. That may be right, but the suffix is the same as an existing revision's, and Azure's behaviour on a duplicate suffix is the thing we have never observed (ARM could reject it, as the earlier B1 discussion assumed). Both outcomes are now loud or harmless, so this is not a blocker, but record it as unobserved, not as established. The dev deploy should re-run one commit twice on purpose and note which happens.

### Carried (unchanged, operator decisions)
Replicas one until the loops are leader-safe; `pgaudit` bootstrap; second prod confirmation after what-if; unique suffix per attempt; the prod rehearsal for creation-time prod settings and Key Vault private-endpoint resolution.

## Status

| Item | State |
|---|---|
| R6-1, R6-2, handlebars | fixed, verified |
| R7-1 scan blind spot wording | open (minor) |
| R7-2 duplicate-suffix behaviour | unobserved; test in the dev deploy |
| Real dev deploy (twice on one commit, plus a rollback), prod rehearsal | not run |

The static checks have run out of useful findings; what remains is a dev deploy. Rehearsing in dev needs an Azure subscription and spends money, so it is your call and not one the agents should take.
