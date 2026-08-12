# C7NTAX — Feature List Summary
## Version: 2026.8.12.008 | Last Updated: 2026-08-12

---

### Versioning Scheme
- Date-based: `Year.Month.Day.Build` (e.g., `2026.8.10.001`)
- First three octets set to the release date
- Build number starts at `001` each day, increments sequentially for same-day entries
- This file is the authoritative source for the What's New changelog
- Each entry uses type indicators: `[New]`, `[Update]`, `[Fix]`

---

## 2026.8.12.008 — ConnectWise-Style Ticket Detail Toolbar & Tabs
- **[New]** Full-width toolbar card on ticket detail — tabbed interface with 12 tabs (Ticket, Configurations, Products, Activities, Time, Links, Expenses, Schedule, Attachments, History, Finance, Audit Trail); Tasks, Open Tickets, Conversions, Surveys, and RMA excluded per spec.
- **[New]** Icon toolbar below the tabs — Refresh, Add Note, Log Time, and Attach are functional; Email, Print, Follow Up, and More Actions are placeholders with "coming soon" toasts.
- **[Update]** Ticket detail layout — General and Classification & Details cards now each sit on their own full-width row under the toolbar (single-column stack).
- **[New]** Configuration dialogs for every tab — Link Configuration (searches assets + Kumo configurations), Add Product (qty/cost with totals), Link Ticket (search + relation type), Add Expense (backed by /billing/expenses), Schedule Entry (backed by /schedule with ticketId), Attach File (metadata placeholder), and Add Time Entry.
- **[Update]** Lightweight tab data (linked configurations, products, links, attachments) persisted in the ticket's `customFields` JSON — tickets PATCH now accepts `customFields` and excludes it from change-comment logging.
- **[Fix]** Time entry logging now posts to the correct `/tickets/:id/time` endpoint (was `/time-entries`, which does not exist).
- **[New]** Activities tab merges notes and time entries into one chronological feed; History tab shows friendly field-change log; Finance tab shows billable/non-billable totals, expenses, and agreement summary; Audit Trail tab lists ticket-scoped system audit records.

## 2026.8.12.007 — Clear Selected-State Highlight in Navigation
- **[Update]** Sidebar selected/active items now use the same light `bg-surface-lighter` background with white text as the hover state — replacing the previous faint cyber tint that was hard to distinguish.
- **[Update]** Applied consistently across all four nav rendering paths: collapsed-mode icon buttons, collapsed-mode links, expandable parent sections, and leaf/section links; the existing accent indicators (active chevron and collapsed-mode edge bar) remain as secondary cues.

## 2026.8.12.006 — Time Off Monthly Calendar
- **[New]** Monthly calendar added to the Time Off page above the PTO Requests card — same Outlook-style mini-card design used on the Calendar page (subtle cell borders, top-left date numbers, month navigation, today highlight).
- **[New]** PTO requests appear as status-colored chips across their full date span in the calendar (green = approved, red = denied, amber = pending), up to 2 chips per day with "+N more" overflow.
- **[New]** Click-a-date filtering — selecting a calendar date filters the PTO Requests table to requests covering that date, with a clear-filter row.
- **[Update]** PTO Requests card now has a header showing total count or filtered count; request form resets after submission.

## 2026.8.12.005 — Outlook-Style Mini-Card Month Calendar
- **[Update]** Monthly calendar redesigned — smaller, visually cleaner day cells in mini-card style with subtle borders (`border-surface-border`), rounded corners, and consistent `gap-1` spacing.
- **[Update]** Date number moved from center to top-left corner of each day cell; day-of-week headers compacted to uppercase micro-labels.
- **[Update]** Event dots replaced by Outlook-style event chips — up to 2 chips per cell showing time and title in the event's color, with "+N more" overflow text.
- **[Update]** Today highlight (cyber border + tint) and selected-date highlight (stronger cyber border + background) preserved; all existing behavior intact: month navigation, click month/year to jump to today, click-a-date filtering, clear-filter row.

## 2026.8.12.004 — Friendly Notes & Activity Card in Ticket Details
- **[Fix]** Ticket change comments no longer contain raw UUIDs or ISO timestamps — the API now resolves board, assignee, contact, company, and service agreement IDs to friendly names, and formats dates as readable strings when generating change-log comments.
- **[Fix]** Legacy change-log comments with raw values (e.g., "Board: 81f12ded-… → 9e4422d8-…") are now rendered friendly in the Notes & Activity card — UUIDs are resolved to names from loaded lookups and ticket relations, ISO timestamps become readable dates, and snake_case enums become title case.
- **[Update]** Comment badges now distinguish Email (purple), Internal (amber), and Note (blue); email-sourced comments show the sender email as author fallback.
- **[Update]** Author/user fallbacks — comments and time entries without an author display "System" instead of "undefined undefined"; time entries show their entry date.

## 2026.8.12.003 — Audit Log Username + UserID & Default Expanded Entries
- **[Update]** Audit log entries now display both the friendly username and the UserID (8-character prefix) — e.g., "Fiona Ray (a1b2c3d4)"; system entries show only "System".
- **[Update]** Audit Logs page defaults — the top three most recent day groups are expanded on open; all older groups default to collapsed; each group toggles independently.

## 2026.8.12.002 — feature_list.json Renamed to BuildNotes.json
- **[Update]** Data source rename — `apps/api/src/feature_list.json` renamed to `apps/api/src/BuildNotes.json` to match the BuildNotes.md naming convention.
- **[Update]** API resolver renamed — `parseFeatureList()` renamed to `parseBuildNotes()` in `apps/api/src/routes/system.ts`; the `/api/system/changelog` fallback now loads `../BuildNotes.json`.
- **[Update]** Frontend parser renamed — `parseFeatureList()` renamed to `parseBuildNotes()` in `apps/web/src/pages/Changelog.tsx`.
- **[Update]** Historical changelog references — BuildNotes.md (root and public copies) entries that named `feature_list.json` as the What's New data source now reference `BuildNotes.json`.
- **[Fix]** What's New continuity — all three changelog sources (public BuildNotes.md, root BuildNotes.md, BuildNotes.json) remain in sync and are updated after every change.

## 2026.8.12.001 — Calendar, Permissions UX & Human-Readable Audit Logs
- **[New]** Monthly calendar card — Outlook-style month grid above Scheduled Events on the Calendar page with prev/next month navigation, colored event indicators on each date, today highlighting, and click-a-date filtering of the event list below.
- **[New]** Batch action confirmation — the "Modify Selected" ticket menu now shows checkboxes next to each action with an OK button that applies only the checked actions and a Cancel button that dismisses without changes; multiple checked actions run sequentially with per-action success/failure reporting.
- **[New]** Audit log user name resolution — `GET /system/audit-logs` now resolves user IDs to full names ("Stephen Simmons") instead of truncated UUID prefixes.
- **[Update]** Human-readable audit log display — raw JSON and code blocks eliminated from the Audit Logs page; every event renders as a narrative sentence (e.g., "updated ticket #a1b2c3d4 — status to in progress") with friendly entity/field labels, "enabled/disabled" for booleans, "(redacted)" for masked values, and flattened nested objects.
- **[Update]** Modify Selected menu labels — batch action items now display human-readable names ("Set Status → In Progress") instead of raw machine values like `status_in_progress`.
- **[Update]** Schedule events keep their color — the schedule POST endpoint now accepts and stores the `color` field so newly created calendar events render with the chosen color in both the event list and monthly calendar indicators.
- **[Fix]** Permissions tab false yellow highlight — the amber deviation indicator on Manage Users permissions no longer appears when loaded permissions exactly match the user's assigned role; comparison is always against the role's actual permissions and updates live while toggling.
- **[Fix]** Permissions role-template mismatch — the "Apply role defaults" dropdown no longer drives deviation highlighting; it applies presets only, while the highlight always compares against the assigned role.
- **[Fix]** Project Calendar loading — the Calendar page now handles both array and wrapped API response shapes reliably and resets the create form after adding an event so new events display immediately.

## 2026.8.11.001 — CloudConnect, Batch Tickets, Audit Logging & Kumo Fixes
- **[New]** CloudConnect action screen — clicking a connected integration tile opens a modal with user preview, field mapping, company assignment, and sync controls.
- **[New]** DummyConnect simulator — a persistent, always-active integration for exploring any connector's interface without live credentials. Includes a type selector dropdown with all 16 integration types.
- **[New]** Batch ticket operations — checkbox column on every ticket row with Select All; "Modify Selected" dropdown appears when tickets are checked, supporting bulk status and priority changes.
- **[New]** Individual ticket Modify menu — ChevronDown button per row opens a dropdown with Acknowledge, Close, Set Status, and Set Priority actions; excludes predecessor options.
- **[New]** Ticket filter dialog — Filter button opens a modal with Status, Priority, Assigned Technician, and Date Range fields; structured for easy addition of future filter fields.
- **[New]** Comprehensive audit logging — every create, update, and delete operation across the entire application is logged to the AuditLog model with user identity, entity type, change summary, and IP address.
- **[New]** Audit Logs page — now fetches from `GET /system/audit-logs` instead of ad-hoc ticket/invoice queries; displays all operations grouped by date with action type, detail, and user identity.
- **[New]** Auto-incremented IDs in What's New — each BuildNotes entry displays a `#ID` badge for user reference when submitting prompts.
- **[New]** Password generator — "Generate" button with eye toggle added to Kumo Passwords create/edit dialogs and Manage Users create/change-password sections.
- **[New]** Super Admin role — `super_admin` system role with all permissions; sessions never expire due to inactivity.
- **[New]** Editable session timeout — Settings page card with configurable inactivity timeout (5–480 minutes, default 30); stored in SystemConfig; sessionAuth middleware reads dynamically.
- **[New]** Snapshot polling system — background service polls at varying intervals with jitter and adaptive backoff; detects new records from any source and triggers snapshot captures.
- **[Update]** Admin role permissions expanded from 24 to 79 — now includes Kumo, Assets, Projects, KB, Opportunities, Procurement, Schedule, PTO, Inference, and Security permissions.
- **[Update]** Kumo seed data cleanup fix — Kumo tables now properly deleted in reverse FK order before re-seeding, preventing data accumulation.
- **[Update]** FEATURE_LIST.md renamed to BuildNotes.md — all 16 references updated across the codebase including Vite plugin, fetch paths, API resolver, README, and self-references.
- **[Update]** CloudConnect error fix dialog — clickable error banners open a modal with per-field editable inputs, Test buttons, pass/fail results, and "OK — Save All Fixes" when all resolved.
- **[Update]** Credential helpers — `getRequiredCredentials()`, `formatCredLabel()`, `getCredFix()`, `getCredExample()`, `checkCredFormat()` added for all 16 integration kinds.
- **[Update]** Test endpoint enhanced — returns structured `fieldErrors[]` with fix instructions and example values on failure.
- **[Update]** Snapshot capture now includes `auditLog`, `kumoTemplateField`, `kumoAssetFieldValue` tables; 41 tables total.
- **[Update]** Permissions refresh logic — now refreshes on any permission difference (`hasNew || hasLess`), not just count increase.
- **[Fix]** Kumo password reveal "access denied" — decrypt failures now handled gracefully with placeholder fallback text.
- **[Fix]** Kumo password TOTP setup — IV and authTag now stored delimited in `totpSecret` field; decrypt uses correct per-record encryption params.
- **[Fix]** Kumo password edit flow — save now sends only editable fields in payload; password field clears after save; reveal card refreshes with updated "last changed by" after password change.
- **[Fix]** Kumo reveal card stuck on entry switch — `selectPassword()` now clears `revealData` and `showEditPwd` when switching entries.
- **[Fix]** Kumo seed passwords — placeholder `ENC:` values replaced with properly AES-256-GCM-encrypted sample passwords.
- **[Fix]** Kumo PATCH endpoint — `updatedById` now set on every password edit; password change encrypts new value with correct IV/authTag.
- **[Fix]** Manage Roles "Changed" indicator — amber badge now only appears when `editPerms` differs from `originalPerms`; no false positives on initial edit open.
- **[Fix]** Manage Roles user count banner — now always visible; "0 users assigned to this role" is clickable and opens the member management modal.
- **[Fix]** "New Board" button removed from main Service Boards page; board creation now only possible under Administration → Service Boards.
- **[Fix]** Service Boards snapshot — manual data changes now captured; snapshot updated from 3 to 4 boards with correct SLA settings.
- **[Fix]** AutoSnapShot path — `CAPTURE_SCRIPT` corrected from `snapshot-capture.ts` to `../snapshot-capture.ts`, fixing MODULE_NOT_FOUND crash on server start.
- **[Fix]** `Eye`/`EyeOff` imports added to Users.tsx — fixing `ReferenceError: Eye is not defined`.
- **[Fix]** Ticket batch endpoint — `POST /tickets/batch` added to tickets router supporting `updateMany` for status and priority.
- **[Fix]** Retrace.md — expanded from 18 to 37 entries; all prompts standardized with BuildNotes IDs, verbatim text, and detailed change lists.

## 2026.8.10.003 — Header Descriptions & Section Landing Pages
- **[New]** Dynamic section header — every page now displays its section name alongside a brief contextual description rendered on a single line in the top navigation bar, replacing the previous title-only header with a formatted `{Section Name} — {description}` layout that stays on one line and leaves generous spacing before the Search button.
- **[New]** 36 section descriptions — mapped across all application routes (e.g., `/`, `/tickets`, `/kumo`, `/billing`) with intelligent parent-path fallback so nested pages (e.g., `/kumo/assets/abc123`) inherit their parent section's description rather than showing nothing.
- **[New]** Collapsible resizable sidebar — icon-only mode (64 px) with persistent width stored in localStorage; drag-to-resize handle on the right edge of the sidebar; clicking a parent section in collapsed mode navigates to a landing page instead of expanding the sidebar.
- **[New]** Section landing pages — clicking any parent section (Administration, Clients, Assets, Users & Roles, Projects, Kumo, Billing, Reports) while the sidebar is collapsed opens a card-grid landing page listing every subsection with its icon, label, and a brief description of its functionality.
- **[New]** Breadcrumb navigation bar — hierarchical path shown on every page with clickable parent segments; the first segment is always "Home" with a house icon linking to `/home`; all segments including the current page are clickable.
- **[New]** Auto-snapshot capture — the database state is automatically dumped to 38 snapshot fixture files (`src/snapshots/*.json`) after any successful POST, PUT, PATCH, or DELETE operation, with 5-second debouncing to coalesce rapid consecutive writes into a single capture.
- **[New]** Snapshot capture-to-reseed pipeline — the `pnpm db:capture` and `pnpm db:reseed` scripts provide a full round-trip: wipe the database in dependency order (children before parents), re-seed every table from captured JSON fixtures, and output record counts for verification.
- **[New]** Recently Viewed tracking — browsing Kumo assets (`/kumo/assets/:id`), passwords (`selectPassword()`), configurations (`setSelected()`), and documents (`openDoc()`) now automatically records views via `POST /api/kumo/recently-viewed`; the Kumo Dashboard polls `GET /api/kumo/recently-viewed` every 10 seconds for live updates without full page reload.
- **[New]** Header toolbar — Search, Recent (Clock icon), AI (Sparkles icon), Help (HelpCircle icon), Settings (Settings icon), and My Account (UserCircle icon, cyber-accented) placeholder buttons rendered in the top-right of the application header bar, hidden on mobile screens below the `sm` breakpoint.
- **[Update]** CloudConnect rebrand — the "Integrations" navigation item (formerly `admin-integrations`, route `/integrations`, API mount `/api/integrations`, component `IntegrationsPage`, file `Integrations.tsx`) has been renamed to "CloudConnect" (`admin-cloudconnect`, `/cloudconnect`, `/api/cloudconnect`, `CloudConnectPage`, `CloudConnect.tsx`); all 12 cross-reference files updated including Dashboard quick-links, Settings landing page, and the Administration card grid.
- **[Update]** Extended contacts seed — the database seed script (`seed-full.ts`) now creates 13 contacts across 5 companies (up from 5 contacts) with full PSA-standard fields: phone (`+1-555-XXXX`), mobile, title (IT Director, VP Operations, CEO), department, and `isActive` boolean.
- **[Update]** Resequenced version numbering — all 25 entries in BuildNotes.md and 7 entries in BuildNotes.json (the What's New data source) converted from semantic-like versions (`v1.11.001`) to date-based `Year.Month.Day.Build` format (e.g., `2026.8.10.003`); build number starts at `001` each day and increments sequentially for same-day releases.
- **[Update]** Manage Roles rename — "Roles & Permissions" (navigation label, page title `<h2>`, SectionLanding description, BuildNotes.json changelog entries x2, BuildNotes.md sub-item reference) has been renamed to "Manage Roles" across the entire codebase; the parent "Users & Roles" section and `/roles` route path remain unchanged.
- **[Update]** Home breadcrumb — the top-level breadcrumb label changed from "Dashboard" to "Home" with a house icon; a new `/home` route renders a `HomePage` with a welcome message and 12-card Getting Started grid linking to Tickets, Boards, Pipeline, Clients, Billing, Projects, Assets, KB, Kumo, Users, Roles, and Administration; the "Home" nav section sits fixed at the top of the sidebar and is non-draggable.

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
- **[New]** BuildNotes.md created with full versioning scheme
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
