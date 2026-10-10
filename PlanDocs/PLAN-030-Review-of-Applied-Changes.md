# PLAN-030 — Review of the applied changes: a provenance note

**This is not the original document.** It is cited by five files in this repository and has never been
on this branch, so this note stands in its place to record what is known about it and where its content
went. Nothing here should be read as the review's own words.

## What was cited

| Citing file | Line | What it says the review contains |
|---|---|---|
| `infra/README.md` | 27 | §1–§6, "the review of that work is applied too" |
| `PlanDocs/PLAN-030-Review-Round-2.md` | 4 | its author wrote round 2 |
| `PlanDocs/PLAN-030-Response-to-Review.md` | 3 | its author is addressed by the response |
| `PlanDocs/PLAN-030-Go-Live-Briefing.md` | 122 | "the second review itself (on the branch that produced it)" |
| `PlanDocs/PLAN-030-Azure-Bicep-Go-Live-Hardening.md` | 12 | the plan was revised against §1–§6 |

## Where it is

`PLAN-030-Go-Live-Briefing.md` line 122 says it lives **on the branch that produced it** — that is, the
branch on which the review was written, before the plan was revised against it. It was never merged
into `main` alongside the changes it reviewed, which is why the other four citations point at a file a
reader on `main` cannot open.

## What its content is, as far as it can be recovered

It is not reconstructable, and this note does not attempt to pretend otherwise. What can be said from
the documents that responded to it:

- It reviewed the work that applied PLAN-030, in six numbered sections; §7 was the least-privilege
  database role, tracked separately.
- `PLAN-030-Response-to-Review.md` and `PLAN-030-Response-to-Review-Round-2.md` are the replies, and
  between them they quote and address its points — so the review's substance survives in the replies
  even though the review itself does not.
- Its §1 reversed the geo-redundant-backup decision: prod is now created with geo-redundant backup, a
  creation-time-only property. That is recorded in `infra/README.md` and `PLAN-030-Azure-Bicep-Go-Live-Hardening.md` §9.3.
- Its §4 is the option (b) that `infra/main.bicep` and `deploy-env.ps1` implement — create the app only
  against the real image, in a second pass, rather than first against a placeholder.

## What to do instead

Read the responses, not this note:

- `PlanDocs/PLAN-030-Response-to-Review.md` — the reply to the review.
- `PlanDocs/PLAN-030-Review-Round-2.md` and `PlanDocs/PLAN-030-Response-to-Review-Round-2.md` — the
  next exchange, which re-reads the applied work.
- `PlanDocs/PLAN-030-Review-Round-3.md` — the round that ran the deployment commands rather than
  reading them, and corrected two claims the earlier rounds had recorded as settled.

If the original text still exists on that branch, merging it here would be better than this note; the
five citations above are waiting for it.
