# PLAN-030 — Review, Round 9 Close-Out

> **Provenance:** written by the reviewer on branch `claude/plan-030-review-round-9-close` (remote and local both at `3025dbab`) and reproduced here verbatim so `main` carries the same record. No code was changed by the reviewer.
>
> **Answered by:** `PlanDocs/PLAN-030-Response-to-Review-Round-9-Close.md`.
>
> **Status of the loop:** round 9 is closed. The reviewer confirms the credential fix on `origin/main` and agrees that the review rounds stop here.

---

Round 9 is closed. The credential fix is on `origin/main` now (commit `c80f3251`), and it works as Deepseek described. I wrote a short close-out as `PlanDocs/PLAN-030-Review-Round-9-Close.md` on branch `claude/plan-030-review-round-9-close`, pushed and logged in `Retrace.md`. I changed no code. The package is still not deployed and not ready.

**Verified:**

- **Delivery:** I confirmed the commits on the remote, and both round-9 files are in the tree. Putting commit hashes in the response header is the right habit.
- **Credential fix:** `resolveSmtpCredentials` returns the credentials when either the user or the password is set, and nothing otherwise. The mail transport only gets an `auth` setting when there is something to authenticate with. I ran that logic against the five credential cases (nothing set, explicit empty strings, both, user only, pass only) and each gave the expected result. I read the `secure` setting from round 8, which is unchanged, but didn't build the service to test it.
- **Preflight:** it ends with 0 failures on `origin/main`.

**Unreviewed changes since the last reviewed commit.** The deploy source gained about 11,000 lines across 166 files, almost none of it PLAN-030: the Modern/Classic rename, an MFA policy, an instance permission tier and password history. Nothing under `infra/`, `scripts/azure/`, the workflows or the Dockerfile changed. Three new migrations ride along, and the migration job will run them. They are additive or small data updates and look safe, but I haven't run them. Two things to know before a first deploy:

- The permission-tier migration strips three instance-level permissions from the `admin` role, so existing admin accounts can do less the moment it applies. Someone should confirm that's intended for the first production data.
- A revision carrying these migrations will answer 503 on the deep readiness check until the job has run. That is the gate working as designed.

I agree with stopping the rounds. What's left needs an Azure subscription and spends money: a dev deploy that runs one commit twice and does a deliberate rollback, the prod rehearsal, and your four decisions (replica count until the background loops are leader-safe, `pgaudit`, a second prod confirmation after the `what-if`, a unique suffix per attempt).

The branch is already pushed, so the hook's warning is stale again. `claude/plan-030-review-round-9-close` is on GitHub, and the remote and my local copy are both at commit `3025dbab`. The working tree is clean.
