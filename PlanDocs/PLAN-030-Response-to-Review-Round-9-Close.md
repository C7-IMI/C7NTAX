# PLAN-030 — Response to Review, Round 9 Close-Out

> **Answers:** `PlanDocs/PLAN-030-Review-Round-9-Close.md`.
> **Round 9 closed.** Both pre-deploy items confirmed: one is intended and one is the gate working, and the first carries an operational check worth doing before a production deploy.

---

## 1. The `admin` demotion is intended, and it is the whole point of the migration

You are right to flag it, and the answer is yes — deliberately. The three instance permissions
(`instance:security`, `instance:config`, `instance:maintenance`) are being taken from `admin` because
until now `Admin` and `Super Admin` differed by two developer keys and nothing else, so an ordinary
administrator could turn multi-factor authentication on **and enforce it for the whole instance**, change
the session ceiling, switch authentication hardening off, change what every client sees in the portal,
and pause the instance's background workers. That was the request that produced the tier.

**What an admin account loses**, precisely: the ability to *write* the MFA policy, the Sessions & Security
settings and the single sign-on provider; the Workspace settings, the Customer Portal defaults and Client
Apps; and the instance maintenance operations. **What it keeps**: everything it had for people — resetting
one person's second factor, locking, unlocking, resetting passwords and signing sessions out — plus roles,
clients, boards, billing, branding, integrations and the rest. Reads are unchanged: an administrator can
still *see* those settings, which is how they answer "why was I signed out".

**The check this implies, which is worth doing before the first production deploy and is not in your
list.** The migration removes the ability to change the instance's authentication policy from every account
that is not a Super Admin. If a deployment has no account on the Super Admin role, then after this applies
**nobody can change the MFA policy or the session settings at all** — including to turn them off. The seed
ships one, so this is a check rather than a fix, but it is the same shape as the four lockouts already
found inside this feature, one layer out: organisational rather than technical. Confirm there is at least
one active Super Admin before the migration job runs.

It is also reversible without a schema change — put the account on the Super Admin role, or add the keys
back to the admin role — and nothing is deleted by it, so "we do not want this" is a two-minute answer.

## 2. The 503 is the gate working, and the ordering is what makes it safe

Correct on both counts. The deep readiness check demands that the newest shipped migration equal the newest
applied one, so a revision that has shipped three migrations the job has not yet run fails its own health
check and stays out of service. **That is a feature rather than a race**: without it, a revision could take
traffic against a schema it does not match, and the failures that produces look like application bugs
rather than an unrun migration.

It is safe because of the order in the workflow — the migration job completes before the revision update,
so the 503 is transient and the gate is what holds traffic until the job finishes. If that ordering were
ever reversed, this check is what would notice.

## 3. Two smaller points

**`secure` is verified by observation, not only by reading.** It was one of the six readings taken from the
transport's own options in the fix: with `secure: true` passed in, the transport's `options.secure` is
`true`. Round 8's behaviour is intact in the same object as round 9's auth spread, so the two cannot
disagree about which settings reached the transport.

**The deploy surface really is untouched.** Confirmed independently rather than agreed to: `git diff
--name-only 209195c0..HEAD -- infra scripts/azure .github/workflows Dockerfile` returns **0 files**. The
three migrations are `20261010120000_mfa_policy` (four nullable or defaulted columns on `User`),
`20261010140000_instance_permission_tier` (the data update discussed above) and
`20261010160000_password_history` (one array column, starting empty). Preflight on `main` is **0 failures**,
which matches your reading.

## 4. Agreed, and closed

Round 9 is closed and the rounds stop here. The remaining work is a dev deploy that runs one commit twice
and then does a deliberate rollback, the prod rehearsal, and the four operator decisions — all of which
need a subscription and spending authority. **The next document in this series should be a deploy
transcript**, and the pre-deploy checklist now has five items rather than four: the original four, plus the
Super Admin check above.
