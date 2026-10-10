# PLAN-030 — Response to review, round 8

> **For:** the author of `PLAN-030-Review-Round-8.md`.
> **From:** the agent that applied the fixes, 2026-10-10.
> **Answers:** `PLAN-030-Review-Round-8.md`.
> **Applied in:** BuildNotes **2026.10.10.007** — "A screen that contradicts the wire".
> **Status:** your three notes are answered, and **one of them was a defect rather than a note.** The
> computed-name read is now bounded rather than listed by hand. **Still not deployed, and so still not
> ready** — and I agree this is the end of what static review can do.

---

## 1. The `SMTP_SECURE` note was a defect, and it was mine

Three things had to agree about one setting, and only two did:

| Where | Before |
|---|---|
| `infra/env/.env.production.example` | documented `SMTP_SECURE` (added in round 7) |
| `routes/system.ts`, `services/developerDeployment.ts` | **reported** `secure: env.SMTP_SECURE === "true"` |
| `packages/email/src/EmailService.ts` | hard-coded `secure: false`, and never read the variable |

So a deployment on port 465 could show *"secure: true"* on the configuration screen while every message
was attempted in clear text — a connection that hangs, with a screen that says everything is fine. That
is the same shape of failure this whole review series has been finding, one layer further out: **the
report and the action disagreed**, and my round-7 change is what made it visible by documenting a
variable that only half the system honoured.

**Fixed at the transport**, which is the end that was wrong: `secure: config?.secure ?? process.env.SMTP_SECURE
=== "true"`. The config object wins when a caller passes one (nothing does today), and the default is
unchanged — the variable is not set anywhere in this repository, so behaviour is identical unless an
operator sets it.

**Proved rather than asserted**, with a throwaway probe constructing the service four ways and reading the
transporter's own options:

```
SMTP_SECURE unset    : secure=false port=587
SMTP_SECURE=false    : secure=false port=587
SMTP_SECURE=TRUE     : secure=false port=587      ← only the exact string counts, as everywhere else
SMTP_SECURE=true,465 : secure=true  port=465
```

You also asked whether the 587/465 rule was beside the placeholder. **It is** — it went in with the
variable in round 7, three comment lines above it in `infra/env/.env.production.example`. What was *not*
there is the part your other sentence implies, so it is now: that only the exact string `true` counts, so
the placeholder stays `false` for a relay on 587 and is changed only for one on 465.

## 2. The computed-name read — bounded, not listed by hand

You asked for someone to list once, by hand, what `configuration.ts` can read. The list exists, and it is
already machine-readable, so the check reads it instead:

```ts
// routes/configuration.ts
const missing = (requirement.env ?? []).filter(name => {
  const value = process.env[name];        // ← the computed read
```

`name` comes from a requirement declaration, so the set is **declared**, in
`packages/shared/src/appConfiguration.ts`, one `env: ["SMTP_HOST", …]` per requirement. Five names in
total: `EMAIL_OAUTH_REDIRECT_URI`, `SMTP_HOST`, `SSO_ISSUER`, `WEBAUTHN_RP_ID`, `X_BEARER_TOKEN` — all
five already documented. The scan now extracts those declarations and counts them, which is the same
choice that closed the alias gap one round ago, and it worked the same way: the last line of the section
went from a warning to a statement of coverage.

```
ok    56 variables the source reads are documented, or on the not-in-production list with a reason (18 of those)
ok    the one computed read (apps/api/src/routes/configuration.ts) is bounded by
      packages/shared/src/appConfiguration.ts, which is 5 of the names above
```

**And the check still watches for the case that has no declaration.** A computed read in any *other* file
is a `warn` naming it, because that is a new fact rather than a known pair. That is what makes the green
above mean "understood" rather than "assumed".

Preflight is back to **0 failures, 2 warnings** — the two being a dirty working tree and the skipped image
build, which is the baseline.

## 3. The commit-hygiene note — the fair half owned, the other half explained

**The fair half, owned:** `e644a18b` does contain two unrelated changes — the ticket toolbar's scroll
margin and the preflight scan — because your prompt carried both asks in one message and I committed them
together. You are right that reverting the deploy-side change would take the UI fix with it. That is a
real cost to whoever reverts, and the fix is behavioural rather than cosmetic: **one prompt with two asks
gets two commits**, even when they arrive in the same minute.

**The other half does not apply to this repository, and it is worth saying why rather than agreeing.**
There is no deploy-readiness branch to keep anything off. `main` *is* the deploy source — the workflow
builds from it and `deploy-env.ps1` tags the image with the commit — and the `claude/plan-030-review-*`
branches are the reviewer's, not a staging area. Every change in this series lands on `main` as its own
commit, which is what makes a revert of one possible at all:

```
e644a18b  fix(preflight,tickets): clear the pinned toolbar, and close the env scan's blind spot   ← the one to split
4d983534  feat(tickets): the composer comes before the client's other open work
104edcf9  fix(security,deploy): two critical handlebars advisories, and a preflight that can go green
```

Splitting a commit that is already pushed, on a branch a background job also commits to, would be a
riskier operation than the tidiness is worth. The lesson is recorded and applied forward instead.

## 4. What has and has not run

| Check | Result |
|---|---|
| The transport's own options, four ways | as the table in §1 — unset and `"TRUE"` are false; `"true"` is true |
| `node scripts/azure/preflight.mjs` | **0 failure(s), 2 warning(s)** — the computed read is now counted, not warned about |
| `pnpm --filter @C7NTAX/api probe:email` | 35/35 |
| `npx tsc --noEmit` (`packages/email`, `apps/api`) | clean |
| A real deployment, the twice-on-one-commit run, the forced rollback, the prod rehearsal | **not run** — needs a subscription |

## 5. Where this ends

I agree with your verdict: **the static review has run out of findings**, and the three things left are
yours or the operator's rather than a code change anyone here should make unasked —

1. a dev deploy running one commit twice, forcing a rollback, and promoting through the health gate;
2. the operator decisions — one replica until the loops are leader-safe, the `pgaudit` bootstrap, a second
   `prod` confirmation, a unique suffix per attempt;
3. the prod rehearsal, the only thing that can prove the creation-time prod settings and the Key Vault
   private-endpoint resolution.

Until that happens the package is **compiled, parse-verified, shell-verified, dependency-audited and
exercised with stubs — not deployed.**
