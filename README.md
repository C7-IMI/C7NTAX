# C7NTAX — PSA Platform

Syntax refers to the rules that govern structured language and code. It positions C7NTAX as the "correct grammar" for how a modern, secure MSP should operate.

Every MSP runs on code, workflows, and communication. But without clear alignment, operations will often break down.
C7NTAX (pronounced syntax) is the intelligent PSA solution designed to bring perfect structure to your service delivery. Built with a security-first architecture and deep automation at its core, C7NTAX bridges the gap between client ticketing, SLA tracking, automated billing, and resource management.
By standardizing your daily operations into a single, cohesive workflow engine, C7NTAX minimizes manual overhead, accelerates response times, and gives MSP leadership complete visibility into profitability and team utilization.
Stop wrestling with fragmented tools and rigid legacy software. Speak the language of high-efficiency MSP operations with C7NTAX.

## What's New

> Sourced from [`BuildNotes.md`](BuildNotes.md) — the authoritative changelog.  
> Badge legend: 🟢 `[New]` = New Feature &nbsp;|&nbsp; 🟡 `[Update]` = Enhancement &nbsp;|&nbsp; 🔴 `[Fix]` = Bug Fix

### 2026.8.10.003 — Header Descriptions & Section Landing Pages
| Badge | Feature |
|---|---|
| 🟢 New | **Dynamic section header** — every page now displays its section name alongside a brief contextual description rendered on a single line in the top navigation bar, replacing the previous title-only header. |
| 🟢 New | **36 section descriptions** — mapped across all application routes with intelligent parent-path fallback so nested pages (e.g., `/kumo/assets/abc123`) inherit their parent section's description. |
| 🟢 New | **Collapsible resizable sidebar** — icon-only mode (64 px) with persistent width stored in localStorage; drag-to-resize handle on the right edge of the sidebar. |
| 🟢 New | **Section landing pages** — clicking a parent section while the sidebar is collapsed navigates to a card-grid landing page listing every subsection with icon, label, and description. |
| 🟢 New | **Breadcrumb navigation bar** — hierarchical path rendered on every page with clickable parent segments and a Home icon linking to the new Home landing page. |
| 🟢 New | **Auto-snapshot capture** — the database state is automatically dumped to 38 snapshot fixture files after any successful POST/PUT/PATCH/DELETE operation, with 5-second debouncing to coalesce rapid writes. |
| 🟢 New | **Snapshot capture-to-reseed pipeline** — the `db:capture` and `db:reseed` scripts provide a full round-trip: wipe the database in dependency order, re-seed from captured fixtures, and verify record counts. |
| 🟢 New | **Recently Viewed tracking** — browsing Kumo assets, passwords, configurations, and documents now automatically records views via `POST /api/kumo/recently-viewed`; the Kumo Dashboard polls every 10 seconds for live updates. |
| 🟢 New | **Header toolbar** — Search, Recent, AI, Help, Settings, and My Account placeholder buttons added to the top-right of the application header bar. |
| 🟡 Update | **CloudConnect rebrand** — the Integrations navigation item and all associated routes, file names, component labels, and documentation strings have been renamed to CloudConnect. |
| 🟡 Update | **Extended contacts seed** — the database seed script now creates 13 contacts (up from 5) with full PSA fields: phone, mobile, title, department, and isActive. |
| 🟡 Update | **Date-based versioning** — version numbers resequenced to `Year.Month.Day.Build` format across the What's New changelog, BuildNotes.md, and all documentation. |
| 🟡 Update | **Manage Roles rename** — "Roles & Permissions" has been renamed to "Manage Roles" in all UI labels, navigation links, page titles, and documentation. |
| 🟡 Update | **Home breadcrumb** — the top-level breadcrumb label changed from "Dashboard" to "Home", with a new Home landing page containing a welcome message and Getting Started cards. |

### 2026.8.10.002 — Recently Viewed on Kumo Dashboard
| Badge | Feature |
|---|---|
| 🟢 New | **Recently Viewed card** — replaces the "Implementation Status" card on the Kumo Dashboard with a live-updating list of recently accessed Kumo items. |
| 🟢 New | **Cross-type tracking** — tracks user access across Passwords, Configurations, Flexible Assets, Documents, Domains, Certificates, and Universal Links with color-coded type indicators. |
| 🟢 New | **RecentlyViewedItem model** — new Prisma database model with per-user deduplication via a `@@unique([userId, entityType, entityId])` composite key. |
| 🟢 New | **API endpoint `POST /api/kumo/recently-viewed`** — upserts view records whenever a user accesses a Kumo item; used by all Kumo detail pages. |
| 🟢 New | **API endpoint `GET /api/kumo/recently-viewed`** — returns the last 20 items for the current user, ordered by most recently viewed. |
| 🟢 New | **Real-time polling** — the Recently Viewed list refreshes every 10 seconds without requiring a manual page reload. |
| 🟢 New | **Relative timestamps** — each entry displays its age in human-readable format ("just now", "5 m ago", "2 h ago", "3 d ago") using a client-side time-ago function. |
| 🟢 New | **Click-through navigation** — clicking a Recently Viewed item navigates directly to its detail page (assets link to `/kumo/assets/:id`, other types link to their list pages). |
| 🟡 Update | **Theme preservation** — all new components use the existing C7NTAX dark navy/cyber color scheme with consistent card, badge, and hover styles. |
| 🟡 Update | **Navigation relocation** — CloudConnect (formerly Integrations) and What's New have been repositioned in the Administration sidebar menu. |
| 🟡 Update | **Route migration** — `/integrations` → `/cloudconnect`, `/api/integrations` → `/api/cloudconnect`, and `Integrations.tsx` → `CloudConnect.tsx`. |

_For the complete changelog with all historical entries, see [BuildNotes.md](BuildNotes.md)._

## Architecture

```
C7NTAX/
├── apps/
│   ├── api/          # Express + TypeScript REST API
│   ├── web/          # React + Vite + Tailwind CSS
│   └── desktop/      # Electron desktop wrapper
├── packages/
│   ├── shared/       # Shared types, schemas, constants
│   ├── email/        # Email sending, templates, ingestion
│   ├── billing/      # Service agreements, invoicing, payments
│   └── integrations/ # Third-party API connectors
├── docs/             # OpenAPI spec, architecture docs
└── scripts/          # Devops and utility scripts
```

## Tech Stack

| Layer          | Technology                              |
|----------------|------------------------------------------|
| Frontend       | React 18, TypeScript, Tailwind CSS, Vite |
| Backend        | Node.js 20, Express, TypeScript          |
| Database       | PostgreSQL 16 + Prisma ORM               |
| Auth           | JWT + TOTP (authenticator) + Email MFA   |
| Email          | Nodemailer + MJML templates              |
| Desktop        | Electron 30                              |
| Integrations   | REST/SOAP SDKs per service               |
| Real-time      | WebSocket (ws)                           |
| Background Jobs| BullMQ + Redis                           |

## Getting Started

```bash
pnpm install
pnpm db:generate
pnpm db:push
pnpm dev
```

## License

Proprietary - Cyber 7 Group
