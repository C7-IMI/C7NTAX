# C7NTAX — Feature List Summary
## Version: 2026.8.10.003 | Last Updated: 2026-08-10

---

### Versioning Scheme
- Date-based: `Year.Month.Day.Build` (e.g., `2026.8.10.001`)
- First three octets set to the release date
- Build number starts at `001` each day, increments sequentially for same-day entries
- This file is the authoritative source for the What's New changelog
- Each entry uses type indicators: `[New]`, `[Update]`, `[Fix]`

---

## 2026.8.10.003 — Header Descriptions & Section Landing Pages
- **[New]** Dynamic section header — every page displays its section name with a brief contextual description on a single line
- **[New]** 36 section descriptions mapped across all routes with parent-path fallback for nested routes
- **[New]** Collapsible resizable sidebar — icon-only mode (64px) with persistent width stored in localStorage
- **[New]** Section landing pages — clicking a parent section in collapsed sidebar opens a card grid of all subsections with descriptions
- **[New]** Breadcrumb navigation bar — hierarchical path shown on every page with clickable parent segments and Home icon
- **[New]** Auto-snapshot capture — database state automatically dumped to 38 snapshot fixture files after any successful POST/PUT/PATCH/DELETE
- **[New]** Snapshot capture-to-reseed pipeline — `db:capture` + `db:reseed` scripts with dependency-order cleanup and seeding
- **[New]** Recently Viewed tracking — browsing Kumo assets, passwords, configs, and documents records views automatically via POST /api/kumo/recently-viewed
- **[New]** Header toolbar — Search, Recent, AI, Help, Settings, and My Account placeholder buttons in the top bar
- **[Update]** CloudConnect rebrand — Integrations renamed to CloudConnect with updated routes, files, navigation, and API mount paths
- **[Update]** Extended contacts seed — 13 contacts with full PSA fields (phone, mobile, title, department, isActive) across 5 companies
- **[Update]** Resequenced version numbering to date-based Year.Month.Day.Build format across all changelogs
- **[Update]** "Roles & Permissions" renamed to "Manage Roles" — UI labels, nav links, page titles, and docs updated
- **[Update]** "Dashboard" top-level breadcrumb label renamed to "Home" with new Home landing page

## 2026.8.10.002 — Recently Viewed on Kumo Dashboard
- **[New]** Recently Viewed card replaces Implementation Status on the Kumo Dashboard
- **[New]** Tracks user access across all Kumo item types: Passwords, Configurations, Flexible Assets, Documents, Domains, Certificates, and Universal Links
- **[New]** New `RecentlyViewedItem` Prisma model with per-user deduplication via `@@unique([userId, entityType, entityId])`
- **[New]** API endpoint `POST /api/kumo/recently-viewed` upserts view records when users access items
- **[New]** API endpoint `GET /api/kumo/recently-viewed` returns last 20 items for the current user, ordered by most recent
- **[New]** Real-time 10-second polling keeps the Recently Viewed list current without manual refresh
- **[New]** Items display with color-coded type indicators (amber=passwords, green=configs, cyber=assets, purple=docs, blue=domains, yellow=certs)
- **[New]** Each entry shows the item name, type label, and relative timestamp ("just now", "5m ago", "2h ago", "3d ago")
- **[New]** Clicking an item navigates to its detail page (assets link to specific asset, others link to their list pages)
- **[Update]** Preserved C7NTAX dark navy/cyber theme across all new components
- **[Update]** Renamed Integrations navigation → CloudConnect; moved What's New below CloudConnect in Administration menu
- **[Update]** Route /integrations → /cloudconnect; API /api/integrations → /api/cloudconnect; frontend page Integrations.tsx → CloudConnect.tsx

## 2026.8.9.003 — Comprehensive Reporting Suite
- **[New]** Reporting section added to navigation tree with Dashboards, Standard Reports, Analytics sub-items
- **[New]** Dashboard tab: KPI cards (total tickets, SLA response%, revenue, outstanding), ticket status/pie chart, priority distribution, SLA compliance gauges, technician utilization table, monthly revenue bars
- **[New]** Standard Reports tab: 6 pre-built report cards (Ticket Volume, SLA Performance, Revenue Summary, Technician Utilization, Aging Report, Board Summary) with live preview and run capability
- **[New]** Analytics tab: ticket volume by status/priority/board visual bars, SLA met/breached gauges, technician billable hours ranking, monthly revenue history chart
- **[New]** 4 new API endpoints: GET /reports/data/ticket-volume, /sla-compliance, /technician-utilization, /revenue-summary
- **[New]** Visual bar charts implemented with pure CSS + JS (no chart library dependency)
- **[Update]** Report data refreshes on tab switch
- **[Update]** Consistent card-based layout matching all other application pages

## 2026.8.9.002 — Comprehensive Billing Suite
- **[New]** Tabbed billing interface: Invoices, Agreements, Payments, Time & Expenses, Reports
- **[New]** Invoices tab: list with status + date filtering, generate from unbilled time, send, PDF, record payment
- **[New]** Agreements tab: service agreement management with billing period, amount, auto-invoice toggles
- **[New]** Payments tab: full payment history with method, reference, linked invoice, client
- **[New]** Time & Expenses tab: billable/non-billable time entries with invoice status, total tracked
- **[New]** Reports tab: revenue summary (total invoiced, collected, overdue), aging summary, quick actions
- **[New]** New API endpoints: GET /billing/payments, GET /billing/reports/revenue
- **[New]** Invoice status badges: Draft, Sent, Partial, Paid, Overdue, Void
- **[New]** Payment method tracking: credit_card, ach, check, wire, flexpoint, other
- **[Update]** All pages maintain consistent dark theme design patterns

## 2026.8.9.001 — Past Due Tasks Auto-Update
- **[New]** Added `isOverdue` boolean field to Ticket model in Prisma schema
- **[New]** Worker job `processPastDueTickets` runs every 15 minutes:
  - Finds tickets where `dueDate < NOW()` and status is not resolved/closed/cancelled
  - Sets `isOverdue = true` and notifies assigned technician
- **[New]** "OVERDUE" badge displayed on ticket list rows (red background, next to status)
- **[New]** "OVERDUE" badge displayed on ticket detail view near the due date
- **[Update]** Updated shared Ticket TypeScript interface with `isOverdue: boolean`
- **[Update]** Prisma db push syncs the new column to PostgreSQL

## 2026.8.8.002 — Bug Fixes & Audit
- **[Fix]** Fixed user creation: API now looks up Role by systemRole name, uses roleId FK
- **[Fix]** Fixed user list display: role field now returned as flat string from API
- **[Fix]** Fixed auth route: user.active → user.isActive (2 instances causing login failures)
- **[Fix]** Fixed users GET endpoint: properly maps role systemRole + company name
- **[Fix]** Fixed dashboard resolvedToday: now fetches resolved tickets count directly
- **[Update]** Full frontend audit: Dashboard, Settings, Opportunities, Projects, Clients, Integrations, Knowledge Base, Inference — all verified no additional bugs

## 2026.8.8.001 — Collapsible Tree Navigation & Section Expansion
- **[New]** Sidebar restructured as collapsible tree with parent sections
- **[New]** Sections: Administration, Clients, Assets, Users & Roles, Projects
- **[New]** Expand/collapse state persisted to localStorage
- **[New]** Administration expanded with: General Settings, Service Boards, Audit Logs, Integrations
- **[New]** New AdminServiceBoardsPage: board list with inline SLA/auto-close/follow-up settings
- **[Update]** "New Board" button moved to Administration → Service Boards page
- **[Update]** Board settings: SLA response/resolution times, auto-close toggle/days, follow-up toggle/intervals
- **[Update]** Clients section with Client List sub-item
- **[Update]** Assets section with Asset Inventory and Procurement sub-items
- **[Update]** Users & Roles section with Manage Users and Manage Roles sub-items
- **[Update]** Projects section with Project List sub-item
- **[New]** New Procurement placeholder page created
- **[New]** Administration landing page shows card grid linking to all admin sub-sections
- **[Update]** Ticket list header button renamed from "New Ticket" to "Create"

## 2026.8.7.004 — Service Boards Dashboard & Ticket Board Filtering
- **[New]** Boards page redesigned: each board is a metric card with 10+ live KPIs
- **[New]** Metric cards show: open, workable, new, on hold, waiting, escalated, avg age
- **[New]** Stale ticket tracking: >3d, >7d, >30d with color-coded severity
- **[New]** Most active client per board (last 30 days)
- **[New]** Real-time polling: metrics refresh every 10 seconds while page is open
- **[New]** Cards are clickable — navigates to tickets filtered by that board
- **[New]** `GET /boards/metrics` API endpoint with all computed stats
- **[New]** Ticket list: added Service Board column
- **[New]** Ticket list: board filter dropdown to switch between boards
- **[New]** Breadcrumb navigation when viewing board-filtered tickets
- **[Update]** Sidebar C7 branding updated to red #C42D4B

## 2026.8.7.003 — Invoice PDF & Auth Token in Query
- **[New]** Double-click any invoice row to open styled PDF invoice in new tab
- **[New]** PDF button in invoice table actions and detail modal
- **[New]** `GET /billing/invoices/:id/pdf` returns dark-themed styled HTML invoice
- **[New]** Invoice PDF shows: C7NTAX branding, bill-to/from, line items, totals, payments, balance
- **[New]** Authenticate middleware now accepts `?token=` query param (for new-tab PDF links)
- **[Fix]** seed-full.ts restored (was corrupted by cache hygiene)
- **[Update]** Full database reseeded with 6 users, 5 companies, 8 tickets, etc.

## 2026.8.7.002 — Layout Restructure & Client Type
- **[Update]** Merged Classification and Details cards into single right-column card
- **[Update]** Left column now: General, Dates & Times only (cleaner layout)
- **[New]** Client Type badge displayed under company name (MSP/INT/INF from DB)
- **[Update]** Logged Time entries now show "Time Entry" activity badge instead of raw date string
- **[Update]** Time entry author names include both firstName and lastName
- **[Update]** Created/Updated dates moved to bottom of combined card with separator

## 2026.8.7.001 — Notes & Activity Unified Feed
- **[New]** Combined comments and time entries into single sorted activity feed
- **[New]** Activity type badges: Note (blue), Internal Note (amber), Email Note (purple), Time Entry (green)
- **[Update]** Author names now show firstName + lastName (was previously only firstName)
- **[Update]** Email-sourced notes show fromEmail as author fallback
- **[Fix]** API ticket detail now includes contact relation (was missing)

## 2026.8.6.004 — Sidebar Reorganization & Drag-and-Drop
- **[New]** FEATURE_LIST.md created with full versioning scheme
- **[Update]** Administration moved below Integrations in sidebar nav
- **[New]** Sidebar navigation sections reorderable via drag-and-drop (GripVertical handle)
- **[New]** Nav order persisted to localStorage across sessions

## 2026.8.6.003 — Rebrand to C7NTAX
- **[Update]** All source code, configs, package names rebranded
- **[Update]** Logo updated
- **[Update]** Sidebar branding: NT/NTAX
- **[Update]** Folder renamed from c7-overwatch to C7NTAX
- **[Update]** GitHub repo published at github.com/C7-IMI/c7-overwatch
- **[New]** Windows desktop app compiled (portable .exe + zip)
- **[Fix]** Electron 33.2.1 binary download issue resolved

## 2026.8.6.002 — Dashboard & Navigation
- **[Update]** Dashboard stat cards made clickable with pre-applied filters
- **[New]** 9 quick-link modules on dashboard
- **[Update]** Cards made clickable on Projects, KB, Clients pages
- **[Fix]** Unused imports removed from Billing, Users, Projects, Assets, KB

## 2026.8.6.001 — Bug Fixes
- **[Fix]** Fixed prisma.ticketNote → prisma.ticketComment (model name mismatch)
- **[Fix]** Fixed prisma.integrationConfig → prisma.integration
- **[Fix]** Fixed comment content → body field name
- **[Fix]** Fixed worker.ts enabled → isActive
- **[Fix]** Fixed ticket comments → notes field name in frontend
- **[Fix]** Fixed boardId not recognized by stale Prisma client (regenerated)

## 2026.8.5.005 — Administration Section
- **[New]** Administration nav item with Shield icon
- **[New]** Logs sub-section: cumulative change log grouped by day
- **[New]** Client IDs (4-digit) and Client Types (MSP, INT, INF) in database

## 2026.8.5.004 — Billing Overhaul
- **[Fix]** Billing/invoice API fixes: billingAmount, minutes field names
- **[New]** Invoice view modal with line items
- **[New]** Record payment modal with method selector
- **[New]** Send invoice functionality
- **[New]** Company dropdown in generate invoice form

## 2026.8.5.003 — Ticket Detail Overhaul
- **[New]** Fully editable ticket detail screen with Audit Trail
- **[New]** Inline toggle between view/edit modes
- **[New]** Start time and end time fields
- **[New]** ClientType selector (MSP, INT, INF)
- **[New]** Service agreement auto-display when company selected
- **[New]** Contact dropdown filtered by company
- **[New]** Cumulative time spent display
- **[New]** Log Time modal with start/end time auto-calculation
- **[New]** Inline note posting (Enter to submit)
- **[New]** Ticket numbering scheme: ClientType-ClientID-Sequential

## 2026.8.5.002 — Database & Infrastructure
- **[New]** PostgreSQL 18 installed via Scoop
- **[New]** Database c7_overwatch created and schema pushed
- **[New]** Sample data populated: 6 users, 5 companies, 5 contacts, 3 boards, 8 tickets, 3 agreements, 4 invoices, 3 projects, 5 assets, 4 KB articles, 3 opportunities
- **[New]** Dev error logger with timestamps, rotation, git commit tracking
- **[Update]** Configurable default landing page (/settings)

## 2026.8.5.001 — Auth Fixes
- **[Fix]** Fixed login: user.active → user.isActive (field name mismatch)
- **[Fix]** Fixed login: added include: { role: true } for proper relation loading
- **[Fix]** Fixed login: user.role.systemRole instead of user.role as cast
- **[New]** Added email + username dual login support
- **[New]** Bypass login link on login page

## 2026.8.4.004 — Bug Fixes: Blank Page, Build Errors
- **[Fix]** Fixed @c7-overwatch/shared workspace resolution in Vite
- **[New]** Added ErrorBoundary to main.tsx
- **[Fix]** Fixed 401 interceptor redirect loop on login page
- **[Fix]** Fixed useAuth User type import (inlined locally)
- **[New]** Added noscript fallback and critical CSS to index.html
- **[Fix]** Fixed missing TestTube import in InferenceSettings
- **[New]** Created pnpm-workspace.yaml for proper monorepo resolution
- **[Fix]** Fixed Prisma schema validation errors (ambiguous relations, SQLite incompatibilities)
- **[Update]** Port changed from 5173 → 3001 → 3003
- **[New]** Environment config (.env) created

## 2026.8.4.003 — AI Inference Engine
- **[New]** Pluggable AI provider system (OpenAI, Anthropic, Azure, local keyword search)
- **[New]** Ticket solution suggestions from resolved ticket history
- **[New]** Pattern detection: recurring issues, SLA risks, knowledge gaps
- **[New]** InferencePanel component embedded in ticket detail screen
- **[New]** Admin UI for AI provider configuration (/settings/ai)

## 2026.8.4.002 — CRM, Projects, Inventory, Procurement, PTO, Surveys, KB, Chat, Workflows, Reports, SSO, I18N, Currency, Retention, Calendar, Bulk Ops
- **[New]** 40+ new Prisma models covering all PSA feature areas
- **[New]** Full API routes for all new modules
- **[New]** Frontend pages: Opportunities (CRM pipeline), Projects, Asset Inventory, Knowledge Base
- **[New]** PWA manifest and service worker for mobile/offline support

## 2026.8.4.001 — Core Platform Scaffold
- **[New]** Monorepo with Turborepo (apps/api, apps/web, apps/desktop, packages/shared, packages/email, packages/billing, packages/integrations)
- **[New]** Express + TypeScript REST API with PostgreSQL via Prisma ORM
- **[New]** React + Vite + Tailwind CSS frontend with dark theme (navy/cyber palette)
- **[New]** Shared Zod schemas and TypeScript types across frontend/backend
- **[New]** JWT authentication with MFA (TOTP authenticator + email codes)
- **[New]** RBAC with 8 roles and 25 granular permissions
- **[New]** Client-scoped data access (company-based isolation)
- **[New]** Ticket management: CRUD, status workflow, auto-follow-up, auto-close
- **[New]** Service boards with email connectors (IMAP ticket ingestion)
- **[New]** Billing engine: service agreements, invoicing, payments, PDF generation
- **[New]** 10 third-party integration adapters (Flexpoint, QuickBooks, Pax8, Avanan, Proofpoint, SentinelOne, ITGlue, Microsoft 365, Azure, AWS)
- **[New]** Electron desktop wrapper for Windows
- **[New]** OpenAPI 3.1 specification
