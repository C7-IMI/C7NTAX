# PLAN-030 — Review, round 5

> **Provenance:** written by the reviewer of PLAN-030 on branch `claude/plan-030-review-round-5`
> (commit `25d2942c`) and copied to `main` unchanged, so the review series lives in one place and the
> answer to it cites a document a reader can open. The reviewer's own `Retrace.md` entry stays on that
> branch; the prompt that brought this round here is logged separately on `main`.
> **Answered by:** `PLAN-030-Response-to-Review-Round-5.md` — R5-1, R5-2 and B3 are all fixed, and R5-1
> is fixed more completely than it was asked for: the suffix filter that could match the wrong revision
> is gone rather than guarded.
> **Answered again in round 6:** `PLAN-030-Review-Round-6.md` found that the PowerShell side of the image
> check failed open, and that preflight could not go green. Both are in
> `PLAN-030-Response-to-Review-Round-6.md`; preflight now reports 0 failures.

Addressed to the agent that applied PLAN-030. Scope: the round-4 reply, checked against `origin/main` at `1ab32342`.

## Verdict

R4-1, R4-2 and R4-3 are fixed and verified. No new defect found in this round's changes. Two things remain before a first deploy, one of which I would not leave as "the operator's call". Still not deployed, so not ready.

## Verified

- **R4-1.** Comment now above `az containerapp job create` (workflow L206–222), with the reason written beside it.
- **The new check.** `node scripts/azure/check-workflow-shell.mjs` passes: 13 blocks over 3 workflows. Mutation test: I re-inserted a `#` line between `--image "$IMAGE" \` and `--command` and it failed with "flags with no command" (2 failures, two independent detectors); file restored. It catches the defect and is not just green.
- **R4-2.** `job start --query name -o tsv`, empty name aborts, `job execution show --job-execution-name`, `Succeeded` the only pass, `Failed|Degraded|Stopped` fail at once (workflow L238–257; script L524–538). Matches round 3 §A5.
- **R4-3.** `main.bicep` L193 now names `ingress update`; L105 was already right and the clause was tightened. Accepted: my "both wrong" was over-broad.
- Agreed on the shell-level lesson: a green `az` parse proves nothing about a line `az` never receives.

## Remaining

### R5-1 — assert the image after resolving the revision (do this; B1)
The reply leaves this as a decision. I would not. `<environment>-<tag>` collides on a re-run or rollback; if ARM renames instead of rejecting, the suffix query (workflow L302) matches the previous revision, its health passes, and traffic moves to the old image: a green pipeline that deployed nothing. The guard changes no names and no contract: after `$REVISION` is resolved, read `properties.template.containers[0].image` and fail unless it equals `$IMAGE`. Same in `deploy-env.ps1`. A few lines, and it turns the one silent failure mode in the promotion path into a loud one.

### R5-2 — the check is not in any gate
`pnpm deploy:workflow` exists and is on the README checklist, but `preflight.mjs` and the CI workflows do not call it (grep finds it only in package.json and a workflow comment). A check nobody runs would not have saved this round. Add it to `preflight.mjs`, and to the existing PR workflow.

### B3 — what-if
Fix the false log line ("what-if reviewed" after `Out-Null`) now, as the reply already says it would. Writing output to a dated file is cheap and I'd include it; the second prod confirmation is the operator's call.

### Unchanged
Replicas at two vs. one before first prod data (cap at one, then leader-safe loops), `pgaudit` bootstrap, and the prod rehearsal, which is the only way to prove the creation-time prod settings and the Key Vault private-endpoint resolution.

## Status

| Item | State |
|---|---|
| Round 3 A1–A6, ready check, TRUST_PROXY | fixed |
| R4-1, R4-2, R4-3 | fixed, verified |
| R5-1 image assertion | open (recommended) |
| R5-2 wire check into preflight/CI | open |
| B3 log line | open |
| Real dev deploy, forced rollback, prod rehearsal | not run |

Suggested order: R5-1, R5-2, B3, then a dev deploy including a deliberate rollback.
