# PLAN-030 — Review, round 8

Addressed to the agent that applied PLAN-030. Scope: the round-7 reply against `origin/main` at `e644a18b`.

## Verdict

R7-1 and R7-2 are closed. I found no defect in this round's changes. Static review of PLAN-030 has converged: the findings of rounds 3–7 are fixed or recorded. The package is still not deployed, so still not ready.

## Verified

- **R7-1.** `node scripts/azure/preflight.mjs` on `main`: 0 failures, 3 warnings. The pass line now reads "56 variables the source reads are documented, or on the not-in-production list with a reason (18 of those)", followed by a warning naming `routes/configuration.ts` as read by a computed name and so not covered. The "all" overclaim is gone and the unreachable part is stated.
- **The alias scan found a real gap.** `system.ts` (L265–282) and `developerDeployment.ts` read `env.SMTP_SECURE` through `const env = process.env`, and `SMTP_SECURE` was missing from the production template. It is now there (`SMTP_SECURE=<true|false>`, line 77). Good: the scan now follows the aliased form that was hiding it.
- **R7-2.** Recorded as unobserved on the paragraph that made the claim, and the dev deploy is named as the observation. Accepted.

## Notes

- `SMTP_SECURE` is a placeholder in the template (`<true|false>`), so an operator who copies the template without editing it gets a literal string; code compares `=== "true"`, so that reads as false. Harmless, but the template should state the 587/465 rule beside it. I did not check that the comment is there beyond the variable line.
- The reply also bundled an unrelated ticket-UI change (scroll margin for the pinned toolbar, commit `e644a18b`, and `4d983534`). Not reviewed here; outside PLAN-030. Worth keeping out of the deploy-readiness branch so a rollback of one does not take the other.
- `computed-name` read in `configuration.ts` is the only part of the environment contract still unenumerated. Someone should list what that route can read once, by hand.

## What remains, none of it code

1. A dev deploy: the same commit twice (observe which revision takes traffic), a forced rollback, promotion through the health gate.
2. Operator decisions: replica count (one until the background loops are leader-safe), `pgaudit` bootstrap, a second prod confirmation after what-if, a unique suffix per attempt.
3. The prod rehearsal, the only way to prove creation-time prod settings (closed Key Vault, zone-redundant HA, geo-redundant backup) and Key Vault private-endpoint secret resolution.

Items 1 and 3 need an Azure subscription and spend money. I recommend stopping the review loop here: further rounds will find little that a static check can reach.
