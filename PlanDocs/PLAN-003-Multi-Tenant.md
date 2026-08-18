> **Plan ID:** PLAN-003
> **Title:** Multi-Tenant Architecture Implementation Plan
> **Source:** `MultiTenant.md` (original remains in place)
> **Indexed:** 2026-08-18

# Multi-Tenant Architecture — Implementation Plan

> **Status**: Step 1 Complete
> **Protocol**: Tenant-scoped data isolation with MSP management plane

## Database Schema

The `Tenant` model has been added to Prisma schema with `tenantId` on the Company model. Full tenant isolation will expand to all entities in Step 3.

## Dependency-ordered implementation steps (prerequisites first)

### Step 1 — Tenant foundation *(Complete)*
- [x] `Tenant` model (id, name, domain, settings, isActive)
- [x] `Company.tenantId` foreign key
- [x] Schema pushed to PostgreSQL (prisma db push)
- [x] `GET/POST /api/tenants` routes created
- [x] Tenant router wired into Express app
- [x] 3 seed tenants: C7NTAX Default, Acme Holdings, TechCorp
- **Dependency note:** no prerequisites — this is the foundation. Skipping it blocks Steps 2–3: middleware has no `Tenant` model to resolve against, no `/api/tenants` routes to manage, and no seeded tenants to select.

### Step 2 — Tenant Middleware *(Next; formerly Phase 2)*
- Add `x-tenant-id` header to API client
- Middleware scopes queries to current tenant
- MSP Dashboard with tenant switcher
- **Dependency note:** depends on Step 1 (`Tenant` model + tenant routes + `Company.tenantId`). Risk if Step 1 is skipped: the middleware cannot resolve or persist a tenant context, the `x-tenant-id` header has no source of tenant ids, and the switcher has nothing to list.

### Step 3 — Full Isolation *(formerly Phase 3)*
- tenantId on all major entities
- Row-level security policies
- **Dependency note:** depends on Step 2 (middleware that actually scopes queries). Risk if Step 2 is skipped: adding `tenantId` columns without the middleware leaves queries unscoped — cross-tenant rows are readable/writable during the gap — and RLS policies would lock out legitimate queries that the middleware was supposed to route.

> Note: original phase names preserved — Step 2 was "Phase 2 — Tenant Middleware (Next)", Step 3 was "Phase 3 — Full Isolation". Only the numbering and dependency notes were revised.
