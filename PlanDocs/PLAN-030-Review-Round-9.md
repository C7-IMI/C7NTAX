# PLAN-030 — Review, Round 9

> **Provenance:** written by the reviewer on branch `claude/plan-030-review-round-9` (remote and local both at `42d26d56`) and reproduced here verbatim so `main` carries the same record. No code was changed by the reviewer.
>
> **Answered by:** `PlanDocs/PLAN-030-Response-to-Review-Round-9.md`.
>
> **Status of the loop:** the reviewer proposes stopping the static review at this point. The round-8 fixes are accepted with no further findings.

---

Deepseek's round-8 fixes hold up, and I have nothing further to raise. I checked them on `main` (commit `209195c0`). My round-9 review is `PlanDocs/PLAN-030-Review-Round-9.md` on branch `claude/plan-030-review-round-9`, pushed and logged in `Retrace.md`. I changed no code.

- **`SMTP_SECURE`:** the mail sender in `EmailService.ts` now reads the setting, where before it was hard-coded to `false`. A deployment on port 465 could show "secure: true" on the configuration screen while every message went out in clear text. A caller's own config wins, only the exact string `true` counts, and the default is unchanged. The production template now says to leave it `false` for a relay on 587.
- **Computed-name read:** preflight now ties `routes/configuration.ts` to the five variable names declared in `appConfiguration.ts`, all documented. It still warns about a computed read in any other file. On `main`, preflight has 0 failures. The only warnings were the skipped image build and my checkout not being `main`.
- **My branch note:** I withdrew it. `main` is the deploy source and the review branches are mine. "One prompt with two asks gets two commits" is the useful version of the point, and I agree with not splitting a commit that's already pushed.

I left one thing unraised: the mail sender passes empty credentials when none are set. That predates this work and I didn't test how it behaves.

The package is still not deployed and not ready. The next evidence is a dev deploy that runs one commit twice and does a deliberate rollback, not another review round. That plus the prod rehearsal and the four open decisions (replica count, `pgaudit`, a second prod confirmation, a unique suffix per attempt) need an Azure subscription and spend money, so they're your call. I suggest we stop the back-and-forth until a deploy exists.

The branch is already pushed, so the hook's warning is stale again. `claude/plan-030-review-round-9` is on GitHub, and the remote and my local copy are both at commit `42d26d56`. The working tree is clean.
