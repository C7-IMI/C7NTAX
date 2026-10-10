# PLAN-030 — Response to review, round 4

> **For:** the author of `PLAN-030-Review-Round-4.md`.
> **From:** the agent that applied the fixes, 2026-10-10.
> **Answers:** `PLAN-030-Review-Round-4.md`, which checked the round-3 reply against `origin/main` at
> `387f2192` and reproduced one thing the round-3 method could not see.
> **Applied in:** BuildNotes **2026.10.9.037** — "A comment is not always a comment".
> **Status:** **R4-1 accepted, reproduced independently, and fixed.** **R4-2 accepted and fixed**, by a
> different mechanism than the one proposed — see §3. **R4-3 accepted, with one correction**: only one
> of the two comments was the wrong command; the other named the right one. A check now exists for the
> whole class. **Still not deployed, and not ready** — §5 says what is left.

---

## 1. R4-1 — you are right, it was mine, and it reproduces

I did not take this on trust either: I extracted the workflow's own `Run prisma migrate deploy` block,
substituted the GitHub expressions, and ran it with a stub `az` on `PATH` that records argv. **Both of
your claims are exact.**

```
--- the create call ---
containerapp job create --name c7ntax-SUBSTITUTED-migrate --resource-group rg-c7ntax-SUBSTITUTED \
  --environment aca-c7ntax-SUBSTITUTED --image SUBSTITUTED/c7ntax:SUBSTITUTED
--command: MISSING      --secrets: MISSING       --registry-server: MISSING
--env-vars: MISSING     --mi-user-assigned: MISSING

--- step output ---
C:/…/step.sh: line 43: --command: command not found
```

So the create call arrives with `--image` and nothing else, and the flag lines run as a command of their
own. It fails once, in the environment being created, and every later run takes the `update` branch and
never reaches it — which is the worst possible shape for a defect: green forever afterwards.

**The comment now sits above the command**, with a note saying why it has to, because the next person to
tidy that block would otherwise move it back. Re-run through the same stub, the create call is whole
again and the step reports `migration applied`.

**One thing worth adding to your analysis.** This is not only "the round-3 §2 method cannot see it". The
round-3 method *specifically* pointed at the wrong place: it says to read which of two errors comes back,
and the answer here is neither — `az` is never handed the broken line, so there is no error to read.
`bash -n` passes because it is valid shell. A YAML parse passes. The file that would have caught it is
the one that runs the block. That is now `scripts/azure/check-workflow-shell.mjs`.

## 2. The check you asked for, and its four rules

`scripts/azure/check-workflow-shell.mjs` (`pnpm deploy:workflow`, and on the `infra/README.md`
checklist). It walks every `run:` block in every workflow and applies:

| Rule | Catches |
|---|---|
| `bash -n` | a truncated brace, a bad `if` — the ordinary kind |
| a `\`-continued line followed by a `#` line | **R4-1 exactly.** The comment ends the command there, silently |
| a continuation group whose first token begins with `-` | flags that have lost their command — the other half of R4-1 |
| `command not found` naming a `-`-prefixed word, when the block is run with stubs | the runtime symptom, which needs no reasoning about the block's branches |

**Proved in both directions.** With the defect restored, the check fails on the migrate step with both
detectors firing:

```
  FAIL  .github\workflows\deploy-azure.yml · Run prisma migrate deploy
        a comment inside a continued command (after "--image "$IMAGE" \")
        flags with no command: --command npx prisma migrate deploy \
```

With the fix in place, 13 blocks over 3 workflows pass.

**Two things about the stubs that cost me time and will cost the next person the same**, so they are
comments in the file rather than notes here. First, Git for Windows' bash rebuilds `PATH` with its own
`/mingw64/bin` **ahead** of anything the parent process set, so a `curl` and a `sleep` prepared outside
the shell are shadowed by the real ones — the health-gate block duly polled a real `curl` twelve times
with a real `sleep` in between and the check hung for 30 s. Second, `cygpath` is what makes the stub
directory addressable from the shell at all; a Windows path handed to bash literally, `C:/Users/STEPHE~1/…`,
is not something bash will resolve. The stubs are therefore installed from *inside* the shell.

**What it does not prove**, and I have written this into the file's header so nobody over-reads it: that
`az` *accepts* the arguments, or that a call succeeds against a resource group. That is the round-3
method's question, and it stays with it.

## 3. R4-2 — accepted, and fixed by execution name rather than by list index

You and the round-3 branch document are right: `execution list --query "[0]"` is not documented as
newest-first, and on a second deploy the newest row is still the **previous** run, which succeeded — so
the gate reports success before the migration has begun. The workflow's version was worse than the
script's, which at least slept before its first check.

I took the fix you proposed, `job start --query name -o tsv` then `job execution show
--job-execution-name`, in **both** files. Two details:

- **`job start` returns the execution**, which I confirmed against the installed CLI rather than the
  documentation: `JobExecutionBase` is `{name, id}`, and `job execution show --job-execution-name`
  parses. Both commands were run with placeholder names to check that much.
- **The status vocabulary, from the CLI's own enum** (`_sdk_enums.py`, the `JobExecutionStatus` list):
  `Running`, `Processing`, `Stopped`, `Degraded`, `Failed`, `Unknown`, `Succeeded`. The old loop treated
  only `Failed` as failure, so `Degraded` and `Stopped` spun until the timeout — you flagged that too.
  The new loops fail fast on `Failed`, `Degraded` and `Stopped`, and **`Succeeded` is the only thing
  that counts as success**: anything else, including an empty reading, ends in a failure once the wait
  runs out. A gate that cannot tell "finished" from "finished well" is the defect this whole review
  series keeps finding.

The PowerShell side needed one more thing, because the script runs under `Set-StrictMode -Version
Latest`: `$state` is initialised before the loop, so a timeout reports "did not succeed" rather than
throwing an unrelated strict-mode error.

## 4. R4-3 — accepted, with one correction

**`infra/main.bicep` line 193 was the wrong command and is fixed**: it said `az containerapp update
--target-port`, which does not exist; it now says `az containerapp ingress update --target-port`, which
is what the script actually runs.

**Line 105 named the right command but attributed the wrong step to it.** It reads "the ingress-only
`az containerapp ingress update --target-port` that later installs the real image" — the ingress update
does not install an image; the `containerapp update` does. The clause now says "that a later deployment
runs", which is what the sentence meant. Worth correcting rather than deleting, because the point it is
making is true and load-bearing: a probe's port lives in the revision template, so an ingress-only port
change cannot move the probes, and a placeholder-created app keeps probing the placeholder's port.

So: one of the two comments was the defect, the other was a sentence that needed tightening. Both are
changed; the count in your B-item was one too high.

## 5. What this round did not do, and why

Three findings from the round-3 branch document were never answered on `main`, because the summary I
worked from carried the five blockers and not the B-items. They are answered here rather than silently
carried forward.

**B1 — the revision suffix repeats on a re-run or a rollback.** Unresolved, and it is the most
interesting open item, because the two possible behaviours are both bad and I cannot tell which one
happens without a subscription. The suffix is `<environment>-<tag>`, so re-running the same commit — a
workflow "re-run failed jobs", or the documented rollback — asks for a suffix that already names a
revision. If Container Apps **rejects** it, the deploy fails loudly at `containerapp update`, which is
merely annoying. If it **renames**, the health gate's own filter
(`[?properties.template.revisionSuffix=='$SUFFIX']`) matches the *previous* revision, the gate reads the
previous revision's health, passes, and traffic is shifted to a revision that is running the old image —
a green deploy that deployed nothing.

I have not changed the naming scheme, and I want to be explicit about why rather than hide behind
"unverified": sending the suffix unique per attempt (`github.run_number`/`run_attempt` in the workflow,
a timestamp in the script) is a change to a name the rollback path and three documents depend on, and it
would be made against a failure I have not seen. **The cheap decisive guard, if you want one now, is to
assert the image:** after resolving `$REVISION`, read
`properties.template.containers[0].image` and fail unless it is the image this run asked for. That turns
the silent-wrong-revision case into a loud failure without touching the naming contract, and it is the
change I would make first if the operator wants this closed before the first deploy. Your call, or
theirs — it is a change to the promotion path, not a repair of one.

**B3 — the what-if is discarded and the log says it was reviewed.** True as written: both `what-if`
calls pipe to `Out-Null`, and `infra/README.md`'s checklist requires the output to be reviewed and
saved. I have not changed it, because the honest fixes are behavioural — write the output to a dated
file, and stop for a second confirmation on `prod` — and the script already stops once for `prod` at the
top. Adding a second prompt is a decision for the operator. The false log line is the part I would fix
regardless, and it is one line.

**B5 — dev cannot prove the prod-only paths.** Agreed, and unchanged: the closed Key Vault,
zone-redundant HA, the geo-redundant backup and zone-redundant Container Apps are creation-time and
prod-only, so the throwaway rehearsal in §7.3 of the round-3 review remains the only way to prove them.
The Key Vault private-endpoint question you raise is the one that worries me most, and it is precisely
the sort of thing a rehearsal exists to find.

**Replicas and pgaudit** stand as the round-3 reply left them: both are the operator's decision, with
the evidence recorded, and your recommendation to cap at one replica before the first production data
matches mine.

## 6. What has and has not run

| Check | Result |
|---|---|
| The workflow's migrate block, stub `az`, before the fix | create call truncated at `--image`; `--command: command not found` |
| The same block, after the fix | full argv reaches `az`; step reports `migration applied` |
| `node scripts/azure/check-workflow-shell.mjs` | 13 blocks over 3 workflows — pass. **Fails on the restored defect**, on both detectors |
| `job execution show --job-execution-name`, `job start --query name` | both parse (CLI 2.91.0) |
| `JobExecutionStatus` values | read from the installed CLI's `_sdk_enums.py`, not from documentation |
| `scripts/azure/deploy-env.ps1` | parses clean under PowerShell's own parser; strict-mode-safe |
| `node scripts/azure/validate-bicep.mjs` | re-run after the comment fix — still 0 warnings |
| A real deployment, a forced-rollback run, the suffix question in §5 | **not run** — needs a subscription |

## 7. Where this leaves the package

Your order was R4-1, R4-2, the check, then a dev deploy with a forced rollback. The first three are done
and each is evidenced above. What is left is the deploy, and the four decisions: the production replica
count, `pgaudit`, the prod rehearsal, and now the revision-suffix question in §5 — which is the one that
could turn a green pipeline into an unchanged environment, and so the one I would settle before the
first production run rather than after.

Until the deploy happens this package should be recorded as **compiled, parse-verified, shell-verified
and exercised with stubs; not deployed.**
