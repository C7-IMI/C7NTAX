# C7NTRL RMM Product Line & PSA Integration Plan (PLAN-014)

**Plan ID:** PLAN-014 | **Status:** Proposed (planning phase)
**Companion:** C7NTRL-001 (`C7-IMI/C7NTRL` repo, `docs/PLAN-C7NTRL-Architecture-and-Integration.md` — the RMM-side plan this mirrors).
**Contract:** `docs/INTEGRATION-CONTRACT.md` (committed to both repos; C7NTAX copy lives at `docs/INTEGRATION-CONTRACT.md`).

## 1. Decision

C7NTAX stays the **PSA**. All RMM features from PLAN-013's RMM line are split out into a **separate application, C7NTRL**, in a separate repository (`C7-IMI/C7NTRL`, private) with separate development branches (`main`/`develop`). The two integrate through a versioned HTTPS + signed-webhook contract.

**Why separate:** RMM workloads (agents, high-frequency telemetry, remote sessions, patch engine) would destabilize the production PSA; separate repos keep C7NTAX releasable independently; licensing of reviewed open-source RMMs forbids code merging anyway (Endar CC BY-NC-ND; NetLock/Breeze AGPL — concepts only, clean-room implementation).

## 2. Review basis (re-reviewed 2026-08-18)

Shallow reference clones at `../_ref/` (endar, NetLock-RMM, breeze) were re-examined and used as the integrated base for C7NTRL's feature scope and layout:

- **Endar** → compliance validation/enforcement pairs (C7NTRL phase 5).
- **NetLock RMM** → sensor categories, patch rings + rollback, policy hierarchy (most-specific-wins), remote tool set, status-first UI hierarchy (C7NTRL phases 2–7, 10).
- **Breeze** → risk-classified AI actions, webhook alerting, console density/filter chips, agent watchdog (C7NTRL phases 3–4, 9).
- **Theme:** C7NTRL console reuses the C7NTAX dark cyber-blue token set and sidebar/card/dialog patterns for a cohesive feel.

## 3. C7NTAX-side changes required per C7NTRL phase

| C7NTRL phase | C7NTAX counterpart (this repo) |
|---|---|
| 1 agent/inventory | `POST /api/rmm/devices/sync` → Kumo asset upsert (additive) |
| 2 tenants/policies | `POST /api/rmm/tenants/sync` (Company→tenant mapping) |
| 3–4 monitoring/alerts | `POST /api/rmm/alerts` webhook (HMAC) → ticket automation reusing PLAN-009 deduction patterns |
| 5 compliance | Compliance results on client/ticket views (read-only display) |
| 6 patching | Patch approval dialog + `/api/rmm/patches/approval`; usage feed into billing agreements |
| 7 remote tools | Ticket detail "Open device" deep link to C7NTRL console (signed JWT) |
| 8 uptime (moved from PLAN-013 #4) | C7NTAX Service Alerts keeps vendor RSS/DownDetector only; endpoint monitoring lives in C7NTRL |
| 9 RMM AI actions | Shares PLAN-011's risk-tier taxonomy + approval dialog pattern |
| 10 app/USB/network control | No PSA-side change (RMM-internal) |

**Moved-items notes (explicit, per convention):**
- **PLAN-013 #4** website/SSL/DNS monitoring **moved to C7NTRL phase 8** (RMM owns endpoint monitoring; PSA Service Alerts remains vendor-status-only). PLAN-013 updated to reference this plan.
- **PLAN-013 #6 RMM line** (device agents, patch, sensors, remote tools) **fully absorbed by C7NTRL-001** and removed from C7NTAX scope.
- **PLAN-013 #7 AI risk engine stays in C7NTAX** (PLAN-011); C7NTRL phase 9 implements the RMM-side twin with the same taxonomy.
- **PLAN-013 #3 customer portal stays in C7NTAX** (PSA surface); it will read device data from C7NTRL through the contract at a later phase.

## 4. Integration & bidirectional change checks

- Contract: `docs/INTEGRATION-CONTRACT.md` — versioned endpoints, webhook events, auth (C7NTAX-issued JWTs trusted by C7NTRL; HMAC-signed webhooks), and `contract-fixtures/` vendored in both repos.
- **Every C7NTAX change touching contract surface must be checked against C7NTRL** (CI job `integration-contract` validates C7NTAX handlers against C7NTRL's fixtures), and **every C7NTRL change must be checked against C7NTAX** (mirror job in C7NTRL).
- Counterpart PRs must land in the same release window; drift is a merge-blocker in both repos.

## 5. Non-breaking guarantees

- All C7NTAX-side additions are new routes/tables/dialogs; no existing route, schema field, or UI flow changes.
- Contract v0.1 is additive-only; both apps must run against the previous minor contract for one release (degraded-mode tolerant: C7NTRL buffers alerts up to 24h if PSA is down).
- Feature flags: `RMM_INTEGRATION_ENABLED` gates the C7NTAX integration surface (default off until C7NTRL phase 3 ships).

## 6. Verification

- Bidirectional contract fixtures green in both repos' CI.
- Round-trip E2E: device heartbeat → inventory → policy → sensor alert → C7NTAX ticket; patch approval C7NTAX → C7NTRL → device.
- Theme parity check: C7NTRL console tokens match C7NTAX build.

## 7. Open decisions (Phase 0 gate)

1. Auth posture: shared-JWT (as drafted) vs OIDC IdP for both consoles.
2. C7NTRL DB hosting (self-host Postgres, same box initially).
3. Agent language Go vs Rust; auto-update channel mechanics.
4. Sensor count/selection for v1 (draft: ~40 from NetLock categories).
