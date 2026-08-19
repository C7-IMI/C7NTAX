# INTEGRATION CONTRACT — C7NTAX (PSA) ⇄ C7NTRL (RMM)

**Version:** 0.1.0 (planning) | **Status:** Draft | **Owner:** both teams
**Rule:** This file is committed to **both** repositories (`C7NTAX/docs/INTEGRATION-CONTRACT.md` and `C7NTRL/docs/INTEGRATION-CONTRACT.md`). The C7NTRL copy is canonical for RMM-owned surface; the C7NTAX copy is canonical for PSA-owned surface. They must stay in sync; a copy drift is a merge-blocker.

## 1. Principles

1. **Separate apps, one platform.** No shared database, no shared process. All integration is over versioned HTTPS APIs + signed webhooks.
2. **Non-breaking first.** Contract changes are additive (new fields/endpoints) until a major version bump. Either app must run against the previous minor contract version for one release.
3. **Degraded-mode tolerant.** If one side is down, the other keeps working: C7NTRL buffers alert events (max 24h), C7NTAX keeps tickets editable without device data.
4. **Auth separation.** PSA users → C7NTAX JWTs accepted by C7NTRL (shared issuer). RMM agents → C7NTRL API keys only, never PSA credentials. Webhooks are signed with per-app HMAC keys.

## 2. Identity & trust

| Item | Spec |
|---|---|
| JWT issuer | `c7ntax` (PSA-issued). C7NTRL verifies with the shared public key/secret configured in both apps' env. |
| RMM API keys | `ct_` prefixed, SHA-256 hashed at rest in C7NTRL; scope: `agent`, `relay`, `integration`. |
| Webhook signing | HMAC-SHA256 over raw body, header `X-C7-Signature`, per-direction keys (`C7NTRL_WEBHOOK_KEY` in C7NTAX, `C7NTAX_WEBHOOK_KEY` in C7NTRL). |
| Tenant/Company mapping | C7NTAX `Company.externalId` ⇄ C7NTRL `Tenant.id`. Provisioned via `/api/rmm/tenants` sync (see §3). |

## 3. Endpoint surface (draft)

### C7NTAX → C7NTRL (PSA calls RMM; C7NTAX implements server-side of these, C7NTRL implements client calls)
| Method/Path | Purpose |
|---|---|
| `POST /api/rmm/tenants/sync` | Push company → tenant mapping (create/update). |
| `POST /api/rmm/alerts` | RMM webhook: alert created/resolved → C7NTAX ticket automation (reuses PLAN-009 `createTicketFromEmail`-style deduction). |
| `POST /api/rmm/devices/sync` | Device → Kumo asset upsert (C7NTRL pushes). |
| `POST /api/rmm/patches/approval` | Patch approval decision from C7NTAX UI → C7NTRL. |
| `GET /api/rmm/usage` | Device/agent counts for C7NTAX billing agreements. |

### C7NTRL → C7NTAX (RMM calls PSA; C7NTRL implements server-side, C7NTAX client)
| Method/Path | Purpose |
|---|---|
| `GET /api/integration/companies` | Company list + mapping for tenant provisioning. |
| `GET /api/integration/tickets/:rmmKey` | Resolve alert-ticket linkage status. |
| `POST /api/integration/portal/tickets` | (later) customer portal ticket create. |

## 4. Webhook events (v0.1)

| Event | Payload core |
|---|---|
| `alert.opened` | alertId, tenantId, deviceId, severity, title, sensor, timestamp |
| `alert.resolved` | alertId, tenantId, resolvedAt |
| `device.online` / `device.offline` | deviceId, tenantId, ts |
| `patch.approval_requested` | patchId, devices, severity, window |
| `usage.snapshot` (daily) | tenantId, activeDevices, agentCount |

## 5. Contract fixtures & CI (cross-check mechanism)

- Each repo vendors `contract-fixtures/` — JSON request/response examples for every endpoint + webhook payload samples, plus an `openapi.integration.yaml` subset.
- **C7NTAX CI job `integration-contract`:** loads C7NTRL's fixture set (vendored) and validates its own handlers against them.
- **C7NTRL CI job `integration-contract`:** loads C7NTAX's fixture set and validates its own handlers against them.
- Contract version bump required when any fixture changes; the other repo's vendored copy must be updated in the same release window.

## 6. Change review process (bidirectional)

For every change in either codebase:
1. Does it touch contract paths, event payloads, mapped models, or auth? → go to 2, else normal review.
2. Bump contract version if shape changed (semver; additive = minor, breaking = major + migration note).
3. Update fixtures + vendored copies in both repos (PR in the counterpart repo).
4. Run both `integration-contract` CI jobs.
5. Verify the counterpart feature/plan item exists (e.g., PLAN-014 phases list the counterpart changes on both sides).

Violations: a merged change that breaks the other app's contract fixtures is a merge-blocker for both repos until repaired.

## 7. Version history

- 0.1.0 — initial draft (2026-08-18), created with C7NTRL planning.
