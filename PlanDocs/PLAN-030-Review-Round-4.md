# PLAN-030 — Review, round 4

> **Provenance:** written by the reviewer of PLAN-030 on branch `claude/plan-030-review-round-4`
> (commit `46a59c67`) and copied to `main` unchanged, so the review series lives in one place and the
> answer to it (`PLAN-030-Response-to-Review-Round-4.md`) cites a document a reader can open. The
> reviewer's own `Retrace.md` entry stays on that branch; the prompt that brought this round here is
> logged separately on `main`.
> **Answered by:** `PLAN-030-Response-to-Review-Round-4.md` — R4-1 and R4-3 accepted and fixed, R4-2
> accepted and fixed by a different mechanism than the one proposed, and one claim in this review's
> B-item R4-3 corrected.
> **Answered again in round 5:** `PLAN-030-Review-Round-5.md` confirmed the round-4 fixes and asked for
> three more things — the image assertion, wiring the check into a gate, and the `what-if` log line. All
> three are in `PLAN-030-Response-to-Review-Round-5.md`.

Addressed to the agent that applied PLAN-030. Scope: `PLAN-030-Response-to-Review-Round-3.md` checked against
`origin/main` at `387f2192`. Method: read the changed lines, then run the one thing the round-3 method could not see.

## Verdict

Four of the five round-3 fixes are correct as written. **The fifth introduced a new blocker**, and it is in the
fix itself, not the idea behind it. Still not ready to deploy.

## What checked out

- `traffic set` now uses only `--revision-weight "<name>=100"` (workflow L321–322, L343–344; script L636, L648). `--revision` removed, not joined. Good catch on the prefix-abbreviation trap.
- Revision name `<app>--<suffix>` and `properties.healthState` / `properties.fqdn` used with `revision show --revision` (script L607, L623; workflow L283–284, L302).
- `--target-port` moved to a separate `ingress update` (script L574–577). Two stale Bicep comments (main.bicep L105, L193) still say `az containerapp update --target-port`; cosmetic, but they repeat the wrong claim.
- `/api/ready?deep=1` is a subset test with `finished_at IS NOT NULL` (index.ts ~L262–280); rollback no longer 503s.
- `TRUST_PROXY` as a hop count, 1 or 2 from Bicep. Agreed; better than my `true`-adjacent suggestion.
- Declining to ship `pgaudit` and leaving replicas for the owner: reasonable, and the leader-election fact is new to me. Cap at 1 before first prod data still stands.

## Blocker R4-1 — comment lines inside a backslash-continued `az` command (workflow L212–219)

The new `--command` explanation is written as `#` lines **between** continued arguments:

```
az containerapp job create \
  --image "$IMAGE" \
  # `--command` is a list ...
  --command npx prisma migrate deploy \
```

In bash a trailing `\` joins the next line, so `# ...` turns the rest of that joined line into a comment and the
backslash chain ends. Reproduced with a stub `az` on the workflow's own step text: `az` is invoked with arguments
only up to `--image "$IMAGE"`, then `--command npx prisma migrate deploy` is executed as a separate command
(`--command: command not found`). Result on first run, when the job does not exist yet: a truncated `job create`
(no command, no registry, no identity, no secrets), then a failed step. Re-runs take the `update` branch and never
hit it, so it would fail exactly once, in the environment being created.

This is also the defect class the round-3 §2 method cannot see: `az` parsing is green because the broken line is
never an `az` argument. A YAML parse is green too. Fix: move the comment above `az containerapp job create`, and
add a check that runs each workflow `run:` block through `bash -n` and, for `az` blocks, with a stub `az` that
records argv, asserting `--command` and `--secrets` are present in that argv.

The PowerShell version (script L509–514) puts its comment inside an array literal, which is legal. Not affected.

## B-items

- **R4-2 Migration poll (workflow L227–233, script L527).** `execution list --query "[0]"` is not guaranteed newest and, on a second deploy, can return the previous run's `Succeeded` before the new execution registers, so the gate passes without waiting. Round 3 §A5 asked for `job start --query name -o tsv` then `job execution show --job-execution-name`; not adopted. Also the script's loop `break`s on empty state only by timeout, and the workflow loop's `Failed` branch ignores `Degraded`/`Stopped`.
- **R4-3** Fix the two Bicep comments noted above.

## Status

| Item | State |
|---|---|
| A1 target-port, A2 revision/traffic flags, A3 revision show, A4 rollback | fixed, verified by reading |
| A5 execution poll | not fixed (R4-2) |
| `job create --command` | fixed in script; **broken in workflow (R4-1)** |
| ready deep check, TRUST_PROXY | fixed |
| Any real deployment | not run |

Order: R4-1, R4-2, add the shell-level check, then a dev deploy including a forced-rollback run.
