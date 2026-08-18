# PlanDocs — Plan Registry Index

Central registry of every plan created or requested during the C7NTAX project.
Each plan has a unique **Plan ID** for easy reference in implementation work,
commits, and future updates. Copies live here; the original files remain in
place at their `Source` paths.

**Indexed:** 2026-08-18

| Plan ID | Title | File | Source (original) | Created | Status |
|---|---|---|---|---|---|
| PLAN-001 | Session-Based Authentication & Permissions Implementation Plan | `PLAN-001-Session-Auth.md` | `docs/SESSION_AUTH_PLAN.md` | 2026-08-10 | Implemented |
| PLAN-002 | Passkey Authentication Implementation Plan | `PLAN-002-Passkey-Auth.md` | `PassKey.md` | 2026-08-10 | Planning |
| PLAN-003 | Multi-Tenant Architecture Implementation Plan | `PLAN-003-Multi-Tenant.md` | `MultiTenant.md` | 2026-08-12 | See document |
| PLAN-004 | Native Mobile Applications Plan | `PLAN-004-Native-Mobile.md` | `mobile-native-plan.md` | 2026-08-12 | See document |
| PLAN-005 | Native Desktop Clients Plan (Windows / Linux / macOS) | `PLAN-005-Native-Desktop.md` | `native-desktop-plan.md` | 2026-08-12 | See document |
| PLAN-006 | Native Desktop Clients Plan — Open-Source Edition | `PLAN-006-Native-Desktop-OSS.md` | `native-desktop-oss-plan.md` | 2026-08-12 | See document |
| PLAN-007 | C7NTAX SOC 2 Readiness Plan | `PLAN-007-SOC2-Compliance.md` | `SOC2.Compliance.md` | 2026-08-14 | Proposed |
| PLAN-008 | Token Savings — 10 Options Implementation & Rollback Guide | `PLAN-008-Token-Savings.md` | `TOKEN-SAVINGS.md` | 2026-08-14 | Implemented |
| PLAN-009 | Monitored Mailbox Email-to-Ticket Connector Plan | `PLAN-009-Email-to-Ticket-Connector.md` | `PLAN-Monitored-Mailbox-Email-to-Ticket-Connector.md` | 2026-08-18 | Planning |

## Conventions

- **ID format:** `PLAN-NNN` assigned chronologically by the plan document's
  original creation date. IDs are stable and never reused.
- **Updates:** when a plan changes, update its document here (keep the header
  `Plan ID` block) and note the change date in the document. Prefer updating
  the source file first, then re-copy here.
- **New plans:** copy into `PlanDocs/` as `PLAN-NNN-<slug>.md` with the next
  sequential ID and add a row to this index.
- Each copy carries a header block at the top recording its Plan ID, title,
  source path, and indexing date. The originals are never moved or deleted by
  this registry.
- **Dependency-ordered items (mandatory for all plans):** every plan must list
  its implementation items in dependency order (prerequisites first) and add a
  `Depends on:` / `Risk if skipped:` note to every dependent or reordered item.
  Preserve original item names, paths, and details when renumbering. Applied to
  all nine plans on 2026-08-18 (see each plan's dependency notes).

## Coverage note

Search performed 2026-08-18 across the repository (`*plan*` filenames, `^# … Plan`
headings, BuildNotes plan entries, roadmap/blueprint keywords). All nine plan
documents found are registered above. No requested plan was found without a
document, so no new plan documents were authored in this pass.
