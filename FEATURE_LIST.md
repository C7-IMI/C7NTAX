# C7NTAX — Feature List Summary
## Version: 2026.8.10.003 | Last Updated: 2026-08-10

---

### Versioning Scheme
- Date-based: `Year.Month.Day.Build` (e.g., `2026.8.10.001`)
- First three octets set to the release date
- Build number starts at `001` each day, increments sequentially for same-day entries
- This file is the authoritative source for the What's New changelog

---

## 2026.8.10.003 — Header Descriptions & Section Landing Pages
- Dynamic section header — every page displays its section name with a brief contextual description on a single line
- 36 section descriptions mapped across all routes with parent-path fallback for nested routes
- Collapsible resizable sidebar — icon-only mode (64px) with persistent width stored in localStorage
- Section landing pages — clicking a parent section in collapsed sidebar opens a card grid of all subsections with descriptions
- Breadcrumb navigation bar — hierarchical path shown on every page with clickable parent segments and Home icon
- Auto-snapshot capture — database state automatically dumped to 38 snapshot fixture files after any successful POST/PUT/PATCH/DELETE
- Snapshot capture-to-reseed pipeline — `db:capture` + `db:reseed` scripts with dependency-order cleanup and seeding
- Recently Viewed tracking — browsing Kumo assets, passwords, configs, and documents records views automatically via POST /api/kumo/recently-viewed
- Header toolbar — Search, Recent, AI, Help, Settings, and My Account placeholder buttons in the top bar
- CloudConnect rebrand — Integrations renamed to CloudConnect with updated routes, files, navigation, and API mount paths
- Extended contacts seed — 13 contacts with full PSA fields (phone, mobile, title, department, isActive) across 5 companies
- Resequenced version numbering to date-based Year.Month.Day.Build format across all changelogs

## 2026.8.10.002 — Recently Viewed on Kumo Dashboard
- Replaced "Implementation Status" card on Kumo Dashboard with "Recently Viewed" card
- Recently Viewed tracks user access to Kumo items: Passwords, Configurations, Flexible Assets, Documents, Domains, Certificates, and Universal Links
- New `RecentlyViewedItem` Prisma model with per-user deduplication via `@@unique([userId, entityType, entityId])`
- API endpoint `POST /api/kumo/recently-viewed` upserts view records when users access items
- API endpoint `GET /api/kumo/recently-viewed` returns last 20 items for the current user, ordered by most recent
- Real-time 10-second polling keeps the Recently Viewed list current without manual refresh
- Items display with color-coded type indicators (amber=passwords, green=configs, cyber=assets, purple=docs, blue=domains, yellow=certs)
- Each entry shows the item name, type label, and relative timestamp ("just now", "5m ago", "2h ago", "3d ago")
- Clicking an item navigates to its detail page (assets link to specific asset, others link to their list pages)
- Preserved C7NTAX dark navy/cyber theme across all new components
- Renamed Integrations navigation → CloudConnect; moved What's New below CloudConnect in Administration menu
- Route /integrations → /cloudconnect; API /api/integrations → /api/cloudconnect; frontend page Integrations.tsx → CloudConnect.tsx

## 2026.8.9.003 — Comprehensive Reporting Suite
- Reporting section added to navigation tree with Dashboards, Standard Reports, Analytics sub-items
- Dashboard tab: KPI cards (total tickets, SLA response%, revenue, outstanding), ticket status/pie chart, priority distribution, SLA compliance gauges, technician utilization table, monthly revenue bars
- Standard Reports tab: 6 pre-built report cards (Ticket Volume, SLA Performance, Revenue Summary, Technician Utilization, Aging Report, Board Summary) with live preview and run capability
- Analytics tab: ticket volume by status/priority/board visual bars, SLA met/breached gauges, technician billable hours ranking, monthly revenue history chart
- 4 new API endpoints: GET /reports/data/ticket-volume, /sla-compliance, /technician-utilization, /revenue-summary
- Visual bar charts implemented with pure CSS + JS (no chart library dependency)
- Report data refreshes on tab switch
- Consistent card-based layout matching all other application pages

## 2026.8.9.002 — Comprehensive Billing Suite
- Tabbed billing interface: Invoices, Agreements, Payments, Time & Expenses, Reports
- Invoices tab: list with status + date filtering, generate from unbilled time, send, PDF, record payment
- Agreements tab: service agreement management with billing period, amount, auto-invoice toggles
- Payments tab: full payment history with method, reference, linked invoice, client
- Time & Expenses tab: billable/non-billable time entries with invoice status, total tracked
- Reports tab: revenue summary (total invoiced, collected, overdue), aging summary, quick actions
- New API endpoints: GET /billing/payments, GET /billing/reports/revenue
- Invoice status badges: Draft, Sent, Partial, Paid, Overdue, Void
- Payment method tracking: credit_card, ach, check, wire, flexpoint, other
- All pages maintain consistent dark theme design patterns

## 2026.8.9.001 — Past Due Tasks Auto-Update
- Added `isOverdue` boolean field to Ticket model in Prisma schema
- Worker job `processPastDueTickets` runs every 15 minutes:
  - Finds tickets where `dueDate < NOW()` and status is not resolved/closed/cancelled
  - Sets `isOverdue = true` and notifies assigned technician
- "OVERDUE" badge displayed on ticket list rows (red background, next to status)
- "OVERDUE" badge displayed on ticket detail view near the due date
- Updated shared Ticket TypeScript interface with `isOverdue: boolean`
- Prisma db push syncs the new column to PostgreSQL

## 2026.8.8.002 — Bug Fixes & Audit
- Fixed user creation: API now looks up Role by systemRole name, uses roleId FK
- Fixed user list display: role field now returned as flat string from API
- Fixed auth route: user.active → user.isActive (2 instances causing login failures)
- Fixed users GET endpoint: properly maps role systemRole + company name
- Fixed dashboard resolvedToday: now fetches resolved tickets count directly
- Full frontend audit: Dashboard, Settings, Opportunities, Projects, Clients, Integrations, Knowledge Base, Inference — all verified no additional bugs

## 2026.8.8.001 — Collapsible Tree Navigation & Section Expansion
- Sidebar restructured as collapsible tree with parent sections
- Sections: Administration, Clients, Assets, Users & Roles, Projects
- Expand/collapse state persisted to localStorage
- Administration expanded with: General Settings, Service Boards, Audit Logs, Integrations
- New AdminServiceBoardsPage: board list with inline SLA/auto-close/follow-up settings
- "New Board" button moved to Administration → Service Boards page
- Board settings: SLA response/resolution times, auto-close toggle/days, follow-up toggle/intervals
- Clients section with Client List sub-item
- Assets section with Asset Inventory and Procurement sub-items
- Users & Roles section with Manage Users and Roles & Permissions sub-items
- Projects section with Project List sub-item
- New Procurement placeholder page created
- Administration landing page shows card grid linking to all admin sub-sections
- Ticket list header button renamed from "New Ticket" to "Create"

## 2026.8.7.004 — Service Boards Dashboard & Ticket Board Filtering
- Boards page redesigned: each board is a metric card with 10+ live KPIs
- Metric cards show: open, workable, new, on hold, waiting, escalated, avg age
- Stale ticket tracking: >3d, >7d, >30d with color-coded severity
- Most active client per board (last 30 days)
- Real-time polling: metrics refresh every 10 seconds while page is open
- Cards are clickable — navigates to tickets filtered by that board
- `GET /boards/metrics` API endpoint with all computed stats
- Ticket list: added Service Board column
- Ticket list: board filter dropdown to switch between boards
- Breadcrumb navigation when viewing board-filtered tickets
- Sidebar C7 branding updated to red #C42D4B

## 2026.8.7.003 — Invoice PDF & Auth Token in Query
- Double-click any invoice row to open styled PDF invoice in new tab
- PDF button in invoice table actions and detail modal
- `GET /billing/invoices/:id/pdf` returns dark-themed styled HTML invoice
- Invoice PDF shows: C7NTAX branding, bill-to/from, line items, totals, payments, balance
- Authenticate middleware now accepts `?token=` query param (for new-tab PDF links)
- seed-full.ts restored (was corrupted by cache hygiene)
- Full database reseeded with 6 users, 5 companies, 8 tickets, etc.

## 2026.8.7.002 — Layout Restructure & Client Type
- Merged Classification and Details cards into single right-column card
- Left column now: General, Dates & Times only (cleaner layout)
- Client Type badge displayed under company name (MSP/INT/INF from DB)
- Logged Time entries now show "Time Entry" activity badge instead of raw date string
- Time entry author names include both firstName and lastName
- Created/Updated dates moved to bottom of combined card with separator

## 2026.8.7.001 — Notes & Activity Unified Feed
- Combined comments and time entries into single sorted activity feed
- Activity type badges: Note (blue), Internal Note (amber), Email Note (purple), Time Entry (green)
- Author names now show firstName + lastName (was previously only firstName)
- Email-sourced notes show fromEmail as author fallback
- API ticket detail now includes contact relation (was missing)

## 2026.8.6.004 — Sidebar Reorganization & Drag-and-Drop
- FEATURE_LIST.md created with full versioning scheme
- Administration moved below Integrations in sidebar nav
- Sidebar navigation sections reorderable via drag-and-drop (GripVertical handle)
- Nav order persisted to localStorage across sessions

## 2026.8.6.003 — Rebrand to C7NTAX
- All source code, configs, package names rebranded
- Logo updated
- Sidebar branding: NT/NTAX
- Folder renamed from c7-overwatch to C7NTAX
- GitHub repo published at github.com/C7-IMI/c7-overwatch
- Windows desktop app compiled (portable .exe + zip)
- Electron 33.2.1 binary download issue resolved

## 2026.8.6.002 — Dashboard & Navigation
- Dashboard stat cards made clickable with pre-applied filters
- 9 quick-link modules on dashboard
- Cards made clickable on Projects, KB, Clients pages
- Unused imports removed from Billing, Users, Projects, Assets, KB

## 2026.8.6.001 — Bug Fixes
- Fixed prisma.ticketNote → prisma.ticketComment (model name mismatch)
- Fixed prisma.integrationConfig → prisma.integration
- Fixed comment content → body field name
- Fixed worker.ts enabled → isActive
- Fixed ticket comments → notes field name in frontend
- Fixed boardId not recognized by stale Prisma client (regenerated)

## 2026.8.5.005 — Administration Section
- Administration nav item with Shield icon
- Logs sub-section: cumulative change log grouped by day
- Client IDs (4-digit) and Client Types (MSP, INT, INF) in database

## 2026.8.5.004 — Billing Overhaul
- Billing/invoice API fixes: billingAmount, minutes field names
- Invoice view modal with line items
- Record payment modal with method selector
- Send invoice functionality
- Company dropdown in generate invoice form

## 2026.8.5.003 — Ticket Detail Overhaul
- Fully editable ticket detail screen with Audit Trail
- Inline toggle between view/edit modes
- Start time and end time fields
- ClientType selector (MSP, INT, INF)
- Service agreement auto-display when company selected
- Contact dropdown filtered by company
- Cumulative time spent display
- Log Time modal with start/end time auto-calculation
- Inline note posting (Enter to submit)
- Ticket numbering scheme: ClientType-ClientID-Sequential

## 2026.8.5.002 — Database & Infrastructure
- PostgreSQL 18 installed via Scoop
- Database c7_overwatch created and schema pushed
- Sample data populated: 6 users, 5 companies, 5 contacts, 3 boards, 8 tickets, 3 agreements, 4 invoices, 3 projects, 5 assets, 4 KB articles, 3 opportunities
- Dev error logger with timestamps, rotation, git commit tracking
- Configurable default landing page (/settings)

## 2026.8.5.001 — Auth Fixes
- Fixed login: user.active → user.isActive (field name mismatch)
- Fixed login: added include: { role: true } for proper relation loading
- Fixed login: user.role.systemRole instead of user.role as cast
- Added email + username dual login support
- Bypass login link on login page

## 2026.8.4.004 — Bug Fixes: Blank Page, Build Errors
- Fixed @c7-overwatch/shared workspace resolution in Vite
- Added ErrorBoundary to main.tsx
- Fixed 401 interceptor redirect loop on login page
- Fixed useAuth User type import (inlined locally)
- Added noscript fallback and critical CSS to index.html
- Fixed missing TestTube import in InferenceSettings
- Created pnpm-workspace.yaml for proper monorepo resolution
- Fixed Prisma schema validation errors (ambiguous relations, SQLite incompatibilities)
- Port changed from 5173 → 3001 → 3003
- Environment config (.env) created

## 2026.8.4.003 — AI Inference Engine
- Pluggable AI provider system (OpenAI, Anthropic, Azure, local keyword search)
- Ticket solution suggestions from resolved ticket history
- Pattern detection: recurring issues, SLA risks, knowledge gaps
- InferencePanel component embedded in ticket detail screen
- Admin UI for AI provider configuration (/settings/ai)

## 2026.8.4.002 — CRM, Projects, Inventory, Procurement, PTO, Surveys, KB, Chat, Workflows, Reports, SSO, I18N, Currency, Retention, Calendar, Bulk Ops
- 40+ new Prisma models covering all PSA feature areas
- Full API routes for all new modules
- Frontend pages: Opportunities (CRM pipeline), Projects, Asset Inventory, Knowledge Base
- PWA manifest and service worker for mobile/offline support

## 2026.8.4.001 — Core Platform Scaffold
- Monorepo with Turborepo (apps/api, apps/web, apps/desktop, packages/shared, packages/email, packages/billing, packages/integrations)
- Express + TypeScript REST API with PostgreSQL via Prisma ORM
- React + Vite + Tailwind CSS frontend with dark theme (navy/cyber palette)
- Shared Zod schemas and TypeScript types across frontend/backend
- JWT authentication with MFA (TOTP authenticator + email codes)
- RBAC with 8 roles and 25 granular permissions
- Client-scoped data access (company-based isolation)
- Ticket management: CRUD, status workflow, auto-follow-up, auto-close
- Service boards with email connectors (IMAP ticket ingestion)
- Billing engine: service agreements, invoicing, payments, PDF generation
- 10 third-party integration adapters (Flexpoint, QuickBooks, Pax8, Avanan, Proofpoint, SentinelOne, ITGlue, Microsoft 365, Azure, AWS)
- Electron desktop wrapper for Windows
- OpenAPI 3.1 specification
