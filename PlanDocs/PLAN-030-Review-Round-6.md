# PLAN-030 — Review, round 6

Addressed to the agent that applied PLAN-030. Scope: the round-5 reply against `origin/main` at `584a96a1`.

## Verdict

R5-1, R5-2 and B3 are fixed and verified by reading. One small inconsistency remains, and `preflight` does not yet pass. Still not deployed, so not ready.

## Verified

- **R5-1.** The revision name now comes from `az containerapp update --query properties.latestRevisionName` (workflow "Create the revision"; script ~L598–609). The suffix filter is gone. Three outcomes are loud: empty name, name not ending `--$SUFFIX`, and image tag not matching. I agree with the tail comparison rather than whole-string equality: a false failure before the traffic shift is as bad as the thing guarded. One case I thought of passes by design and is correct: a re-run of the same commit returns the existing revision, which ends in the same suffix and runs the same tag, so it proceeds and promotes the right image.
- **R5-2.** `preflight.mjs` runs `check-workflow-shell.mjs` and fails (not skips) when it fails; `security.yml` runs `pnpm deploy:workflow` in CI. Re-ran: 13 blocks over 3 files, ok.
- **B3.** What-if output saved to `out/deploy/what-if-<env>-<timestamp>.txt`; the "what-if reviewed" line is gone (grep finds none).
- `TRUST_PROXY` added to the production env template. Good catch on your own omission.

## Remaining

### R6-1 — the PowerShell image check fails open
Workflow: an empty `RUNNING_IMAGE` falls through the `case` and stops the run. Script (`deploy-env.ps1` ~L636–640): `if ($runningImage -and $runningImage -notlike "*:$ImageTag")` — an empty result (the call is `2>$null`, so any CLI error yields empty) skips the check and promotes. The two gates disagree on the same condition. Make the script match the workflow: throw when `$runningImage` is empty or does not end `:$ImageTag`.

### R6-2 — preflight is red, and a gate that is always red stops being read
In this review's environment `node scripts/azure/preflight.mjs` ends `2 failure(s)`:
1. `dependency baseline` (ELIFECYCLE). I could not tell whether this is my sandbox (no network/audit) or real; please confirm on a normal machine.
2. `environment contract`: ~13+ variables read by the source but undocumented in the production template (PROBE_*, DEVADMIN_PASSWORD, OUTLOOK_ADDIN_GUID, PUBLIC_BASE_URL, APP_URL, WEB_PUBLIC_URL, C7NTAX_INTERNAL_API_BASE, EMAIL_OAUTH_*, …). You note this is pre-existing and listed in the go-live briefing. Agreed, but R5-2 told operators "a local deploy refuses to start from a broken tree", and today it refuses for an unrelated reason. Either document each variable (stating whether production must set it) or classify them in an allow-list with a reason, so preflight can go green and a new red means something.

### Carried (unchanged, operator decisions)
Replicas one until loops are leader-safe; `pgaudit` bootstrap; second prod confirmation after what-if; unique suffix per attempt (now safe, not correct); the prod rehearsal for creation-time prod settings and Key Vault private-endpoint resolution.

## Status

| Item | State |
|---|---|
| R5-1, R5-2, B3, TRUST_PROXY template | fixed, verified |
| R6-1 PowerShell image check fails open | open |
| R6-2 preflight green | open (env contract; baseline unconfirmed) |
| Real dev deploy, forced rollback, prod rehearsal | not run |

At this point the remaining risk is what static checks cannot reach. After R6-1 and R6-2, the next evidence is a dev deploy with a deliberate rollback.
