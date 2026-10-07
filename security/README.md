# Dependency security baseline

This directory holds the dependency audit baseline for PLAN-018 (Wave 0, dependency and
application security remediation). It exists so the build can fail on a **new** advisory
without failing on the ones we have deliberately accepted.

## Commands

```powershell
node scripts/audit-baseline.mjs            # check the tree against the baseline (CI gate)
node scripts/audit-baseline.mjs --write    # regenerate security/audit-baseline.json
node scripts/audit-baseline.mjs --json     # print the current report without comparing
```

`pnpm audit --json` is the data source, run twice: once for the production closure and once
for everything, so each advisory is recorded as `prod: true` or `prod: false`.

## What fails the build

| Scope | Severity | Result |
|---|---|---|
| production | any | **fail** — it is in code we ship |
| dev (build machine) | high, critical | **fail** — a compromised build ships compromised artefacts |
| dev (build machine) | moderate, low | warning |

Accepted risks are matched on **package + advisory identity**, never on a count, so a new
advisory against an already-accepted package still fails. An accepted risk that disappears
is reported as a warning so the list cannot rot.

## Accepting a risk

Add it to `accepted` in `audit-baseline.json` with a `reason`, a `key`
(`module|GHSA-id`) and the severity, then run `--write` to confirm it is preserved and the
gate passes. Reasons must say **who is exposed** (build machine vs shipped product, user
input vs our own code) and **what would change it** (an upstream fix, a framework upgrade).
An entry without a reason is a bug in the review, not a decision.

## Current state (2026-10-06, version 2026.10.6.064)

| | Before Wave 0 | Now |
|---|---|---|
| Advisories (all) | 128 | 4 |
| Advisories in production | 21 | **0** |
| Critical | 2 | 0 |
| High | 61 | 2 (both dev, no fix published) |

Four accepted, none in the shipped product: `braces`, `http-cache-semantics` and
`sprintf-js` have no published fix and reach the build machine only, and
`postcss-selector-parser` is pinned to the 6.x line by Tailwind 3. Each carries its reason
in `audit-baseline.json`.

The application-level findings from PLAN-018 are tracked in
`PlanDocs/PLAN-018-Dependency-and-Application-Security-Remediation.md`; this file covers
dependencies only.
