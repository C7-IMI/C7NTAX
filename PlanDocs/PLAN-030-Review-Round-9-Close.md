# PLAN-030 — Review, round 9 close-out

Scope: the follow-up to round 9, checked against `origin/main` at `30ae6fef`.

## Verdict

Round 9 is closed. The `EmailService` credential fix is on the remote and does what was described. The review series ends here; the next document should be a deploy transcript. Still not deployed, so not ready.

## Delivery

My previous check was right: at the time, `origin/main` was `209195c0` and the fix was not there. It is now. `c80f3251` carries the mail fix and the round-9 records; `30ae6fef` corrects the response with commit hashes. Both round-9 files are in the tree of `origin/main`. Accepted that hashes in the response header are the habit that removes the ambiguity.

## Verified

- `packages/email/src/EmailService.ts`: `resolveSmtpCredentials` returns `{user, pass}` when either is truthy and `null` otherwise, and the constructor spreads `auth` only when it is non-null (L44, L236–240).
- I ran the function's logic against the five credential cases: nothing set → `null`; explicit empty strings → `null`; both → `{u,p}`; user only → `{user:"u",pass:""}`; pass only → `{user:"",pass:"p"}`. The sixth case (`secure` still reaching the transport) is unchanged at L27 from round 8; I read it, I did not construct the service.
- Preflight on `origin/main`: 0 failures.

## What changed in the deploy source since the last reviewed commit

`209195c0` to `30ae6fef` is 166 files, about 11,000 lines, almost none of it PLAN-030: the Modern/Classic rename (`ff030e4b`, 125 files), MFA as a policy, an instance permission tier and password history. Nothing under `infra/`, `scripts/azure/`, `.github/workflows/` or the Dockerfile changed. Three migrations ride along, and they are the part that matters for a deploy because the migration job runs them:

- `20261010120000_mfa_policy`: four `ADD COLUMN` on `User` (one `NOT NULL DEFAULT 'default'`), plus an `UPDATE` backfilling `mfaEnrolledAt`.
- `20261010140000_instance_permission_tier`: `UPDATE`s on `Role` that add three `instance:*` permissions to `super_admin` and `developer_admin`, and **remove** them from `admin`.
- `20261010160000_password_history`: one `ADD COLUMN ... TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`.

Reading them, they are additive or small data updates and look safe for the migration job; I have not run them. Two things to know before the first deploy: the second migration changes what existing `admin` accounts can do the moment it applies, so someone should confirm that is intended for the first production data; and because `/api/ready?deep=1` requires every shipped migration to be applied, a revision carrying these will answer 503 until the job has run, which is the gate working as designed.

## What remains

Unchanged from round 9, none of it checkable by reading: a dev deploy (one commit twice, a deliberate rollback through the health gate), the prod rehearsal, and four owner decisions (replica count until the loops are leader-safe, `pgaudit`, a second confirmation after the what-if, a unique suffix per attempt). All need a subscription and spend money.
