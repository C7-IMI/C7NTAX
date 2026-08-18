> **Plan ID:** PLAN-008
> **Title:** Token Savings — 10 Options Implementation & Rollback Guide
> **Source:** `TOKEN-SAVINGS.md` (original remains in place)
> **Indexed:** 2026-08-18

# TOKEN-SAVINGS — 10 Options Implementation & Rollback Guide

Each option is implemented as a self-contained, clearly-marked change
(`TOKEN-SAVE-NN` comments). To roll back one option, apply ONLY the revert
listed for that option — all other options stay intact.

Implemented: 2026-08-14 (version 2026.8.14.005)

| Option | What it does | Files touched | Revert |
|---|---|---|---|
| 1 | Morgan skips unauthenticated poller probes (401 spam) | `apps/api/src/index.ts` (QUIET_POLL_PATHS + `skip:` in morgan) | Remove the `skip:` property and the `QUIET_POLL_PATHS` constant |
| 2 | dev-errors.log: 5 MB cap + rotate at API boot | `apps/api/src/services/logger.ts` (`MAX_LOG_SIZE_MB = 5`, `rotateIfNeeded()` in `startup()`) | Restore `MAX_LOG_SIZE_MB = 10` and remove the `rotateIfNeeded();` call in `startup()` |
| 3 | Snapshot capture writes a table file only when content changed | `apps/api/src/snapshot-capture.ts` (TOKEN-SAVE-03 block) | Restore the single `fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));` + log line; delete the compare/unchanged branches |
| 4 | Boot script: rotate boot.log >1 MB; skip prisma generate/db push when schema hash unchanged | `startup/c7ntax-boot.ps1` (TOKEN-SAVE-04 blocks; hash file `startup/.schema.sha256`) | Remove the boot.log rotation block and restore the original unconditional prisma section; optionally delete `startup/.schema.sha256` |
| 5 | BuildNotes generated from root MD (web public copy + api JSON) | `scripts/generate-buildnotes.mjs` (new); JSON now generated | Delete the script; hand-edit the three changelog files again (no runtime impact — JSON has no runtime consumer) |
| 6 | Frontend polling pauses when tab hidden (shared hook) | `apps/web/src/hooks/useVisibilityPolling.ts` (new); wired in `Layout.tsx` + `ServiceAlerts.tsx` | Remove the hook file and restore the original `setInterval` useEffects in both files |
| 7 | `scripts/typecheck-diff.sh` — tsc output filtered to changed files | `scripts/typecheck-diff.sh` (new) | Delete the script (workflow-only, no app code) |
| 8 | Inference: memoized prompt prefix, 6000-char description excerpt, `INFERENCE_MODEL` env override | `apps/api/src/services/inference/LlmProvider.ts` (TOKEN-SAVE-08 blocks) | Restore the original inline `buildPrompt` template and the original `buildRequestBody(provider, prompt)` line |
| 9 | gzip compression for JSON responses + weak ETags | `apps/api/src/index.ts` (TOKEN-SAVE-09 block before helmet) | Delete the gzip middleware block and `app.set("etag", "weak")` |
| 10 | Snapshot delta journal (`snapshots/deltas/*.delta.jsonl`, capped 100 entries, additive) | `apps/api/src/snapshot-capture.ts` (TOKEN-SAVE-10 block) | Remove the TOKEN-SAVE-10 block; optionally delete `apps/api/src/snapshots/deltas/` |

## Dependency & ordering notes (all 10 options implemented; order was independent)

The 10 options are **independent of each other** — no reordering is needed,
and each option remains individually reversible per the table above. The
following cross-cutting notes must be honored by future plans:

- **Any future plan that changes `apps/api/prisma/schema.prisma`** (e.g. PLAN-001
  session models, PLAN-002 `PasskeyCredential`, PLAN-003 tenant columns) **must
  also update `startup/.schema.sha256`** (or delete it so the boot script
  re-syncs once). Option 4 skips `prisma generate` + `db push` when the hash is
  unchanged — if the hash is stale, new tables/columns never reach the database
  and runtime queries fail with Prisma "table/column does not exist" errors.
- **Option 7 (`typecheck-diff.sh`) depends on the `C7NTAX` git repo** (uses
  `git diff`/`git ls-files`). Future plans must keep their work committed or the
  script's changed-file filter has nothing to match.
- **Option 9 (gzip)** was revised 2026-08-18: streaming compression replaced
  with buffered compress-once-and-end (see BuildNotes 2026.8.18.001/002). Any
  future middleware work must preserve the 204/304/HEAD bypass.
- **Option 10 (delta journal)** only records ID add/remove churn; content-only
  changes intentionally do not create journal entries. Future plans that want
  full change capture must extend `snapshot-capture.ts`, not rely on deltas.

## Rollback procedure (example: option 3)

1. Open `apps/api/src/snapshot-capture.ts`.
2. Replace the TOKEN-SAVE-03 section with the pre-change lines (see table).
3. Run `cd apps/api && npx tsx src/verify-post-change.ts` to confirm health.
4. Do NOT touch any other TOKEN-SAVE sections.

## Verification after any change

- Boot pipeline: `powershell -ExecutionPolicy Bypass -File startup/c7ntax-boot.ps1`
- Health: `cd apps/api && npx tsx src/verify-post-change.ts`
- Changed-file typecheck: `scripts/typecheck-diff.sh`
