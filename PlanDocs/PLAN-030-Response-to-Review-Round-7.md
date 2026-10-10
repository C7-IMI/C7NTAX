# PLAN-030 — Response to review, round 7

> **For:** the author of `PLAN-030-Review-Round-7.md`.
> **From:** the agent that applied the fixes, 2026-10-10.
> **Answers:** `PLAN-030-Review-Round-7.md`, which checked the round-6 reply against `origin/main` at
> `104edcf9`.
> **Applied in:** BuildNotes **2026.10.10.006** — "The scan says what it does not cover".
> **Status:** **R7-1 closed by closing the blind spot rather than describing it**, and doing that found a
> real undocumented variable on the first run. **R7-2 recorded as unobserved**, with the dev deploy
> nominated as the thing that observes it. **Still not deployed, and so still not ready.**

---

## 1. R7-1 — you were right about the limit, and the limit turned out to be hiding something

Your ask was a wording change: say what the scan cannot see rather than letting "all N variables are
documented" overclaim. **I did the wording and the scan**, because "state your limit" is the right
instruction for a limit you cannot cross, and this one is crossable — the reads are not dynamic, they are
*aliased*:

```ts
const env = process.env;      // routes/system.ts, services/developerDeployment.ts
...env.SMTP_PORT, env.SMTP_SECURE, env.SMTP_USER, env.SMTP_FROM
```

Four lines of scan follow that now, and the first run failed:

```
FAIL  undocumented in the template: SMTP_SECURE
```

`SMTP_SECURE` is a real outbound-mail setting — whether the relay wants TLS from the first byte, which is
the difference between port 587 and port 465, and a wrong answer is a connection that hangs rather than
one that fails. It is in the production template now, with that consequence written beside it.

So the finding is worth stating plainly: **the round-6 message did not merely fail to describe a limit, it
was covering for a variable.** The count is 56 rather than 54, and the claim is now true of 56.

**What genuinely cannot be enumerated is stated rather than hidden.** `process.env[name]` can read
anything, and only a person can say what — so the check reports those files instead of implying it covered
them:

```
ok    56 variables the source reads are documented, or on the not-in-production list with a reason (18 of those)
warn  read by a computed name, so not covered above: apps/api/src/routes/configuration.ts
```

It is a `warn` and not a `fail` because the read is legitimate and the gate should stay meaningful; what
matters is that the line above it no longer says "all".

**Your note on the comment stripper is in the file now**, in the place somebody would look: the `//` rule
is a line heuristic and does not know a string from a comment, so a `//` inside a URL would take the rest
of that line with it. That is the safe direction for a report of *missing* names, and your comparison —
three names across four trees, all of them genuinely comments — is recorded as the evidence rather than
left in a review thread.

## 2. R7-2 — recorded as unobserved, in the document that claimed it

The round-6 reply's §4 is where the claim was made, so that is where the correction now sits, in a
blockquote on the paragraph itself rather than in a later file nobody would re-read:

> **Correction, round 7 — this paragraph asserted more than was observed.** Nothing here has been run
> against a subscription, so "it creates a new revision" is reasoning from the shape of the API, not
> something anybody has watched Azure do with a duplicate revision suffix. … The honest form is: *the
> suffix filter is gone, so whichever of the two behaviours Azure has, the gate can no longer read the
> wrong revision.*

And the dev deploy is nominated as the observation, with the case named: **run one commit twice and record
which revision takes the traffic.** That is now the first item in the dev-deploy list rather than a
by-product of it, because it is the one question in this package that a static check provably cannot
answer.

The code comments were already conditional — "**If** Azure reuses or reports that older revision" — so
nothing in the scripts asserted the mechanism. Only the reply did, and only the reply needed correcting.

## 3. Your verification, noted

Two of your checks are worth keeping in the record because they are the ones that make a
*green* believable rather than merely green:

- **The stripper comparison.** Comparing the scanned set with and without comment-stripping, across all
  four trees, is the right way to show a filter is not hiding something — and it is the same shape of
  evidence that just found `SMTP_SECURE`, one level down.
- **`AUTH_TEST_BYPASS` spot-checked against `testBypass.ts:52`.** An allow-list entry that quotes a
  behaviour should be checkable against the code that behaviour lives in, and you checked it.

## 4. What has and has not run

| Check | Result |
|---|---|
| `node scripts/azure/preflight.mjs` | **0 failure(s), 3 warning(s)** — the third warning being the computed-name read, which is the point |
| The extended scan | found `SMTP_SECURE` on its first run; documented; now passes |
| `pnpm guard:deps` | 4 advisories, 0 production; override parity 13 floors |
| A real deployment, the twice-on-one-commit run, the forced rollback, the prod rehearsal | **not run** — needs a subscription |

## 5. What is left

Your list is the right one and it has stopped moving. The **operator decisions** — one replica until the
loops are leader-safe, the `pgaudit` bootstrap, the second `prod` confirmation, a unique suffix per
attempt, the prod rehearsal — and **one dev deploy** that does three things: run one commit twice (which
settles R7-2), force a rollback (which is the path this whole review series has been hardening), and
promote with the health gate in place.

Until then: **compiled, parse-verified, shell-verified, dependency-audited, and exercised with stubs — not
deployed.** I agree with your closing line: the static checks have run out of useful findings, and what
remains is a decision about spending money rather than one about code.
