# C7 Overwatch — Architecture

## Overview

C7 Overwatch is a full-stack Professional Services Automation platform. It follows a modular monorepo pattern with clear separation of concerns.

## Layers

```
┌────────────────────────────────────────┐
│           Desktop (Electron)           │  Native Windows app
├────────────────────────────────────────┤
│           Web (React + Vite)           │  Responsive SPA
├────────────────────────────────────────┤
│          API (Express + TS)            │  REST + WebSocket
├──────────┬──────────┬─────────────────┤
│  Email   │ Billing  │  Integrations   │  Domain packages
├──────────┴──────────┴─────────────────┤
│          Shared (Types + Schemas)      │  Cross-cutting
├────────────────────────────────────────┤
│        PostgreSQL + Redis              │  Data layer
└────────────────────────────────────────┘
```

## Key Design Decisions

1. **Monorepo with Turborepo**: Each app/package is independently buildable. Changes to `shared` cascade. This prevents coupling.

2. **Zod schemas in shared**: Both frontend and backend validate against the same Zod schemas, ensuring type safety across the network boundary.

3. **Adapter pattern for integrations**: Every third-party service implements `IIntegrationAdapter`. Adding a new service means creating one adapter file — no other code changes needed.

4. **RBAC via permission map**: Permissions are granular string keys (e.g., `ticket:view`, `billing:manage`). Roles are collections of permissions. The `ROLE_PERMISSIONS` map in `packages/shared/src/enums.ts` is the single source of truth.

5. **Background workers with setInterval**: Currently uses in-process timers. For production scale, swap to BullMQ + Redis with the same worker functions. The `worker.ts` module is ready for this.

6. **Client data scoping**: Non-admin users can only see their company's data. This is enforced at the API layer via `req.user.companyId` checks in every relevant route.

## Database

PostgreSQL 16 via Prisma ORM. The schema (`apps/api/prisma/schema.prisma`) defines 17 models covering users, companies, tickets, boards, invoices, integrations, and audit logs.

## API Design

RESTful JSON. All endpoints under `/api`. Documented in `docs/openapi.yaml`. Key patterns:
- `GET /api/resource` — list with pagination (`?limit=&offset=`)
- `GET /api/resource/:id` — single entity
- `POST /api/resource` — create
- `PATCH /api/resource/:id` — partial update
- `DELETE /api/resource/:id` — soft delete (deactivate)

Authentication: JWT Bearer token. MFA via TOTP (authenticator app) or email code.

## Adding a New Feature

1. Add types/schemas to `packages/shared/src/`
2. Add Prisma model if needed
3. Add API route in `apps/api/src/routes/`
4. Add page component in `apps/web/src/pages/`
5. Register route in `App.tsx` and nav in `Layout.tsx`
6. Document endpoint in `docs/openapi.yaml`

No other files should need changes.
