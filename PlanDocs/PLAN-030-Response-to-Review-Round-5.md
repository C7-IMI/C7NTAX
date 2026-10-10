# PLAN-030 — Response to review, round 5

> **For:** the author of `PLAN-030-Review-Round-5.md`.
> **From:** the agent that applied the fixes, 2026-10-10.
> **Answers:** `PLAN-030-Review-Round-5.md`, which checked the round-4 reply against `origin/main` at
> `1ab32342`.
> **Applied in:** BuildNotes **2026.10.10.002** — "The revision that was already there".
> **Status:** **R5-1, R5-2 and B3 are all fixed and evidenced below.** R5-1 is fixed more completely than
> it was asked for: the thing that could match the wrong revision is gone, not merely guarded. **Still
> not deployed, and so still not ready.**

---

## 1. R5-1 — accepted, and the guard is now between the update and the gate rather than after the gate

You are right that this should not have been left as a decision. It is not a policy question: a
promotion path that can report success while running the previous image is a defect, and the fix changes
no names and no contract.

**I did not put the assertion where you asked, because the piece that could read the wrong revision
should not exist at all.** Your version asserts the image after `$REVISION` is resolved by a suffix
query. Mine removes the query:

```bash
# before — could match the revision the *previous* run created
az containerapp update … --revision-suffix "$SUFFIX" --only-show-errors
REVISION=$(az containerapp revision list … --query "[?properties.template.revisionSuffix=='$SUFFIX'].name | [0]" -o tsv)

# after — the update says what it created
REVISION=$(az containerapp update … --revision-suffix "$SUFFIX" --only-show-errors \
  --query "properties.latestRevisionName" -o tsv)
```

`properties.latestRevisionName` is the app's newest revision, which is the one this call created. The
filter is what made a wrong match possible, so removing it removes the failure mode rather than detecting
it afterwards. The image assertion you asked for is kept as a second, independent guard — see §2 — and the
same change is in `deploy-env.ps1`.

Two cases survive the change, and both are now loud:

| Case | Before | After |
|---|---|---|
| Azure **rejects** the duplicate suffix | `containerapp update` fails, loudly | unchanged — `Invoke-Az` throws / the workflow errors |
| Azure **renames** the new revision | the suffix filter matched the *previous* revision, its health passed, traffic moved to the old image, pipeline green | the name does not end in `--$SUFFIX`, so the step stops with both names printed |

## 2. The image assertion, and why it is not a string equality

You asked for `image == $IMAGE`. I compare the **image tag** instead, case-sensitively, on the end of the
reference:

```bash
case "$RUNNING_IMAGE" in *:"$TAG") ;; *) echo "::error::…" ; exit 1 ;; esac
```

The reason is that equality is the one form of this check that can fail for a reason that is not the
defect: `properties.template.containers[0].image` is returned by the service, and a service that
normalises a registry host or expands a reference would make an exact comparison fail on a perfectly good
deploy — and the failure lands before the traffic shift, so it would look exactly like the thing it is
guarding. The tail comparison is immune to the host being rewritten and still decisive for the question
being asked, which is *"is this the image this run built?"* A tag that is a suffix of another tag cannot
produce a false pass, because the pattern requires the `:` before it.

If you want the strict form anyway, it is one line — but I would rather explain a weaker check that cannot
lie than ship a stronger one that can.

**Proved with stubs, all three cases** (the workflow's own step text, a stub `az`, `sleep` as a no-op):

```
[clean update]                                   exit 0
revision c7ntax-…--dev-abc123 is healthy

[suffix collision (renamed revision)]            exit 1
::error::the update produced revision 'c7ntax-…--dev-OLD', which is not 'c7ntax-dev--dev-abc123' —
a revision with that suffix already exists, so this run may not have created the one it asked for,
and the health gate below would have read the older, already-serving revision and passed

[wrong image on the resolved revision]           exit 1
::error::revision c7ntax-…--dev-abc123 is running '…/c7ntax:previous-tag', which is not the image
this run built (tag abc123)
```

The same three behaviours are asserted in `deploy-env.ps1`, where the checks are `-notlike
"*--$revisionSuffix"` and `-notlike "*:$ImageTag"`; the script parses clean under PowerShell's own parser
and still runs under `Set-StrictMode -Version Latest`.

## 3. R5-2 — wired into both gates

- **`preflight.mjs`** now runs it in its existing `workflow` section, so a local deploy refuses to start
  from a tree whose CI shell is broken. It is a **failure** rather than a skip when no bash is found,
  with `BASH_PATH` named in the message: a check that passes by not running is the same class of thing
  this one exists to find, and preflight is the file that already refuses to deploy on it.
- **`security.yml`**, the `guards` job, as *"The deploy workflow's shell is intact"*. That job already
  runs on `windows-latest`, where `check-workflow-shell.mjs` finds Git's bash — and it is the right home
  because the file it guards only ever runs on a deploy.

Your point is the one worth keeping: a check nobody runs would not have saved this round.

## 4. B3 — the log line is true, and the preview is saved

Both `what-if` calls captured their output into `Out-Null`. Now they capture it and write it to
`out/deploy/what-if-<environment>-<timestamp>.txt` — git-ignored, one file per attempt, so two runs
cannot overwrite each other's evidence — and print the path. The line that said *"what-if reviewed"*,
which nobody had done, is gone; it now says where the file is and what is happening next.

**The second `prod` confirmation stays the operator's call**, as you have it: the script already stops
once for `prod` at the top, and adding a second prompt is a behaviour change rather than a repair. The
false statement is fixed either way, which is the part that was not a judgement call.

## 5. The env var my round-3 change left undocumented

`preflight.mjs`'s environment-contract section lists variables the source reads that
`infra/env/.env.production.example` does not document, and `TRUST_PROXY` was among them — my own omission
from round 3, caught by running preflight after wiring the check in. It is now documented there with the
reason it is a hop count rather than `true`. The rest of that list is the known pre-existing failure
recorded in the go-live briefing; this one was not, and is no longer.

## 6. What has and has not run

| Check | Result |
|---|---|
| The workflow's create-revision step, three stub cases | clean passes; a renamed revision fails; a wrong image fails |
| `node scripts/azure/check-workflow-shell.mjs` | 13 blocks over 3 workflows — pass; unchanged by this round |
| `node scripts/azure/preflight.mjs` | runs the new check and reports it; the remaining failures are the two known pre-existing ones plus `pnpm` being absent from this shell's `PATH` |
| `deploy-env.ps1` | parses clean; strict-mode-safe |
| `validate-bicep.mjs` | 0 warnings |
| All three workflows parse as YAML | pass |
| A real deployment, a forced rollback, the prod rehearsal | **not run** — needs a subscription |

## 7. What is left

Your order was R5-1, R5-2, B3, then a dev deploy with a deliberate rollback. All three are done. What
remains is the deploy itself and the four decisions, unchanged from round 4: **the production replica
count** (cap at one until the background loops are leader-safe — I agree), **`pgaudit`** (bootstrap with
the deferred role work rather than a migration that runs everywhere), **the prod rehearsal** (the only
thing that can prove the creation-time prod settings and Key Vault private-endpoint resolution), and
**the revision suffix** — which is now safe rather than correct: a collision is loud instead of silent,
but making the suffix unique per attempt is still the real fix if the operator wants one.

Until the deploy happens: **compiled, parse-verified, shell-verified, exercised with stubs — not
deployed.**
