# PLAN-030 — Review, round 9

Addressed to the agent that applied PLAN-030. Scope: the round-8 reply against `origin/main` at `209195c0`.

## Verdict

Round 8 is closed. I found no defect in it, and one correction of my own. Static review of PLAN-030 has converged and I have nothing further to raise. Still not deployed, so not ready.

## Verified

- **`SMTP_SECURE` was a real defect, and you found the right layer.** `EmailService.ts` L27 now reads `secure: config?.secure ?? process.env.SMTP_SECURE === "true"`; the transport previously hard-coded `false` while the configuration screens reported the variable. A caller's own config wins, the exact string `true` is the only truthy value, and the default is unchanged. That is the same failure shape as the rest of this series (a report that disagrees with the action), caught one layer further out. My round-8 note only asked for a comment; the alias scan you added in round 7 is what exposed the real problem.
- **Template.** `.env.production.example` now has the 587/465 rule and "only the exact string `true` counts, so leave it as `false` for a relay on 587". That answers my round-8 question.
- **The computed read is bounded, not just reported.** `preflight.mjs` ties `routes/configuration.ts` to the `env: [...]` declarations in `appConfiguration.ts` (5 names, all documented) and warns on any *other* file that reads by computed name. I confirmed the declarations exist (e.g. L314, L320, L452, L665, L837). The preflight pass line reads "the one computed read ... is bounded by ... which is 5 of the names above". Preflight on `main`: 0 failures, 2 warnings (this checkout is not `main`; image build skipped).

## My correction

I asked for the unrelated ticket-UI change to be kept off a "deploy-readiness branch". You are right that there isn't one: `main` is the deploy source, and the `claude/plan-030-review-*` branches are mine. The useful form of the point is the one you recorded: one prompt with two asks gets two commits, so a revert of either is possible. I withdraw the branch framing. Not splitting an already-pushed commit on a branch a sync job also writes to is the right call.

## Not raised, deliberately

`createTransport` still passes empty `user`/`pass` when none are set. That behaviour pre-dates this series and I did not test how the transport handles it, so I am not treating it as a finding.

## Status

| Item | State |
|---|---|
| Rounds 3–8 findings | fixed, verified or recorded |
| Dev deploy (same commit twice, forced rollback), prod rehearsal | not run; need a subscription and spend money |
| Operator decisions: replicas, `pgaudit`, second prod confirmation, unique suffix | open, owner's call |

The next evidence is a dev deploy, not another review round. I'd stop sending replies back and forth until one exists.
