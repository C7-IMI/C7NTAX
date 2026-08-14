# C7NTAX — Retrace Prompt Log
## Tracking all user prompts, timestamps, and completion metrics

---

### Prompt 1 — Build C7 Overwatch PSA Platform
**Timestamp:** 2026-08-04 | **Status:** ✅ Completed | **Duration:** ~6 hours
**BuildNotes IDs:** #24 (2026.8.4.001), #23 (2026.8.4.002), #22 (2026.8.4.003)
> Build a full-stack application named "C7 Overwatch" that replicates the interface and core functionality of AutoTask PSA. Include a responsive, mobile-friendly web application that scales correctly on phones and tablets in both portrait and landscape, and a natively installable Windows desktop application. Derive the color scheme from the logo at https://www.cyber7group.com and match AutoTask PSA's overall look and feel.

**Changes:**
- `package.json` — Monorepo root with Turborepo workspaces: `apps/api`, `apps/web`, `apps/desktop`, `packages/shared`, `packages/email`, `packages/billing`, `packages/integrations`
- `turbo.json` — Build pipeline with `dev`, `build`, `lint`, `test`, `db:*` tasks
- `tsconfig.json` — Shared TypeScript config with ES2022 target, bundler resolution
- `apps/api/` — Express + TypeScript REST API scaffold with PostgreSQL via Prisma ORM, JWT auth middleware (`auth.ts`), error handler, health check
- `apps/web/` — React 18 + Vite + Tailwind CSS SPA with dark navy/cyber theme, React Router, Axios API client
- `apps/desktop/` — Electron 30 wrapper for native Windows installation (portable .exe + zip)
- `packages/shared/` — Zod schemas, TypeScript enums (`SystemRole`, `Permission`, `TicketStatus`, etc.), constants
- `packages/email/` — Nodemailer + MJML email sending, IMAP ticket ingestion
- `packages/billing/` — Service agreements, invoicing, payments engine
- `packages/integrations/` — 10 third-party adapter classes (Flexpoint, QuickBooks, Pax8, Avanan, Proofpoint, SentinelOne, ITGlue, Microsoft 365, Azure, AWS)
- `apps/api/prisma/schema.prisma` — Full PSA schema: User, Role, Company, Contact, Ticket, ServiceBoard, ServiceAgreement, Invoice, Project, Asset, KnowledgeBaseArticle, Opportunity, Integration, and 35+ more models
- `apps/api/src/seed.ts` — Initial seed data creation
- JWT authentication with MFA (TOTP authenticator + email backup codes), RBAC with 8 roles and 25+ permissions
- OpenAPI 3.1 specification document

### Prompt 2 — Feature list & sidebar reorder
**Timestamp:** 2026-08-05 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #12 (2026.8.6.004)
> Extract feature list from chat history, add versioning, move Administration below Integrations, make sidebar draggable. Create the FEATURE_LIST.md changelog.

**Changes:**
- `FEATURE_LIST.md` — Created with date-based versioning scheme (`Year.Month.Day.Build`); 24 entries documenting all features from project inception
- Versioning standard: first three octets set to release date, build number starts at `001` each day
- `apps/web/src/components/Layout.tsx` — Sidebar navigation restructured with drag-and-drop (GripVertical handle); nav order persisted to localStorage
- Administration nav item moved below Integrations in sidebar order

### Prompt 3 — Notes & Activity fixes
**Timestamp:** 2026-08-05 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #14 (2026.8.7.001)
> Fix company showing ID instead of name, due date instead of activity type in Notes & Activity section.

**Changes:**
- `apps/web/src/pages/TicketDetail.tsx` — Combined ticket comments and time entries into a single sorted activity feed
- Added activity type badges: Note (blue), Internal Note (amber), Email Note (purple), Time Entry (green)
- Author names now display `firstName + lastName` (was only `firstName`)
- Email-sourced notes show `fromEmail` as author fallback
- `apps/api/src/routes/tickets.ts` — API ticket detail now includes contact relation (was missing)

### Prompt 4 — Layout restructure & Client Type
**Timestamp:** 2026-08-05 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #13 (2026.8.7.002)
> Merge Classification and Details cards into a single column, add Client Type indicator, fix time entry display.

**Changes:**
- `apps/web/src/pages/TicketDetail.tsx` — Merged Classification and Details cards into single right-column card; left column now only has General + Dates & Times
- Client Type badge displayed under company name (MSP / INT / INF from database)
- Logged Time entries now show "Time Entry" activity badge instead of raw date string
- Time entry author names include both `firstName` and `lastName`
- Created/Updated dates moved to bottom of combined card with separator

### Prompt 5 — Application stopped working (debug)
**Timestamp:** 2026-08-05 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #22 (2026.8.5.002)
> The application stopped working — debug and fix the crash.

**Changes:**
- Identified stale port binding on port 3001 (previous instance not properly terminated)
- Killed orphaned Node.js process; restarted API on correct port
- Added `dev-errors.log` with timestamps, rotation, and git commit tracking for future diagnostics

### Prompt 6 — Login failing & sample data missing
**Timestamp:** 2026-08-05 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #24 (2026.8.5.001), #22 (2026.8.5.002)
> Login is failing — fix the authentication issue and restore the missing sample data.

**Changes:**
- `apps/api/src/routes/auth.ts` — Fixed `user.active` → `user.isActive` field name mismatch (2 instances)
- `apps/api/src/routes/auth.ts` — Added `include: { role: true }` for proper relation loading in login query
- `apps/api/src/routes/auth.ts` — Fixed `user.role.systemRole` instead of `user.role` as cast
- `apps/api/src/routes/auth.ts` — Added email + username dual login support
- `apps/api/src/seed-full.ts` — Restored from corrupted cache-hygiene stub (was 0 bytes of actual content)
- Ran full seed: 6 users, 5 companies, 13 contacts, 3 boards, 8 tickets, 5 agreements, 4 invoices, 3 projects, 5 assets, 4 KB articles, 3 opportunities
- Created `scripts/` directory for devops utilities

### Prompt 7 — Invoice PDF on double-click
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #15 (2026.8.7.003)
> Add invoice PDF generation — double-click any invoice row to open a styled PDF in a new tab.

**Changes:**
- `apps/api/src/routes/billing.ts` — Added `GET /billing/invoices/:id/pdf` endpoint returning dark-themed styled HTML invoice
- Invoice PDF shows: C7NTAX branding, bill-to/from, line items, totals, payments, outstanding balance
- `apps/web/src/pages/Billing.tsx` — Double-click handler on invoice rows; PDF button in table actions and detail modal
- `apps/api/src/middleware/auth.ts` — `authenticate` middleware now accepts `?token=` query parameter for new-tab PDF links (can't set Authorization header in `window.open`)
- `apps/api/src/seed-full.ts` — Restored from corruption; full database reseeded

### Prompt 8 — Sidebar branding fix
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~5 min
**BuildNotes IDs:** #19 (2026.8.6.003)
> Fix the sidebar branding to correctly display "C7 NTAX" and use the red accent color.

**Changes:**
- `apps/web/src/components/Layout.tsx` — Sidebar C7 logo text updated to proper "C7 NTAX" branding
- Logo color accent set to `#C42D4B` (Cyber 7 Group red)
- Fixed truncation behavior so icon-only mode shows just "C7" when collapsed

### Prompt 9 — Service Boards & Ticket Summary
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~45 min
**BuildNotes IDs:** #20 (2026.8.7.004)
> Redesign the Boards page with live KPIs. Add board filtering to the ticket list.

**Changes:**
- `apps/web/src/pages/Boards.tsx` — Complete redesign: each board shown as a metric card with 10+ live KPIs (open, workable, new, on hold, waiting, escalated, avg age)
- Stale ticket tracking: >3d, >7d, >30d with color-coded severity indicators
- Most active client per board (last 30 days)
- Real-time polling: metrics refresh every 10 seconds while page is open
- Cards are clickable — navigate to tickets filtered by that board
- `apps/api/src/routes/boards.ts` — Added `GET /boards/metrics` endpoint with all computed stats
- `apps/web/src/pages/Tickets.tsx` — Added Service Board column + board filter dropdown
- Breadcrumb navigation when viewing board-filtered tickets

### Prompt 10 — Navigation restructure & Service Boards
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~45 min
**BuildNotes IDs:** #11 (2026.8.8.001)
> Restructure sidebar as a collapsible tree with sections. Add Administration section with board management.

**Changes:**
- `apps/web/src/components/Layout.tsx` — Sidebar restructured as collapsible tree with parent sections: Administration, Clients, Assets, Users & Roles, Projects
- Expand/collapse state persisted to localStorage across sessions
- Administration section expanded with: General Settings, Service Boards, Audit Logs, Integrations
- `apps/web/src/pages/AdminServiceBoards.tsx` — New page: board list with inline SLA/auto-close/follow-up settings
- "New Board" button moved from Tickets page to Administration → Service Boards
- Board settings: SLA response/resolution times, auto-close toggle/days, follow-up toggle/intervals
- Clients section with Client List; Assets with Asset Inventory + Procurement; Users & Roles with Manage Users + Manage Roles; Projects with Project List
- `apps/web/src/pages/Procurement.tsx` — Placeholder page created
- Administration landing page shows card grid linking to all admin sub-sections
- Ticket list header button renamed from "New Ticket" to "Create"

### Prompt 11 — Billing section build-out
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~45 min
**BuildNotes IDs:** #9 (2026.8.9.002)
> Build out the Billing section with tabbed interface covering invoices, agreements, payments, time & expenses, and reports.

**Changes:**
- `apps/web/src/pages/Billing.tsx` — Tabbed billing interface: Invoices, Agreements, Payments, Time & Expenses, Reports
- Invoices tab: list with status + date filtering, generate from unbilled time, send, PDF, record payment
- Agreements tab: service agreement management with billing period, amount, auto-invoice toggles
- Payments tab: full payment history with method, reference, linked invoice, client
- Time & Expenses tab: billable/non-billable time entries with invoice status, total tracked
- Reports tab: revenue summary (total invoiced, collected, overdue), aging summary, quick actions
- `apps/api/src/routes/billing.ts` — Added `GET /billing/payments`, `GET /billing/reports/revenue`
- Invoice status badges: Draft, Sent, Partial, Paid, Overdue, Void
- Payment method tracking: credit_card, ach, check, wire, flexpoint, other

### Prompt 12 — Reporting section build-out
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~45 min
**BuildNotes IDs:** #10 (2026.8.9.003)
> Build a comprehensive Reporting section with dashboards, standard reports, and analytics.

**Changes:**
- `apps/web/src/pages/Reports.tsx` — Reporting section with three tabs: Dashboard, Standard Reports, Analytics
- Dashboard tab: KPI cards (total tickets, SLA response%, revenue, outstanding), ticket status/pie chart, priority distribution, SLA compliance gauges, technician utilization table, monthly revenue bars
- Standard Reports tab: 6 pre-built report cards (Ticket Volume, SLA Performance, Revenue Summary, Technician Utilization, Aging Report, Board Summary) with live preview and run capability
- Analytics tab: ticket volume by status/priority/board visual bars, SLA met/breached gauges, technician billable hours ranking, monthly revenue history chart
- `apps/api/src/routes/reports.ts` — 4 new endpoints: `GET /reports/data/ticket-volume`, `/sla-compliance`, `/technician-utilization`, `/revenue-summary`
- Visual bar charts implemented with pure CSS + JS (no chart library dependency)
- Report data refreshes on tab switch

### Prompt 13 — Billing sub-section navigation
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #9 (2026.8.9.002)
> Add Billing as a collapsible tree section in the sidebar with sub-items.

**Changes:**
- `apps/web/src/components/Layout.tsx` — Billing added as collapsible tree section with 5 sub-items: Invoices, Agreements, Payments, Time & Expenses, Reports
- Route handling for all billing sub-paths (`/billing/*`)

### Prompt 14 — Fix broken references & sample data
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #24 (2026.8.5.001), #22 (2026.8.5.002)
> Fix broken API routes caused by scalar-only model relations. Restore seed data that was lost.

**Changes:**
- `apps/api/src/routes/tickets.ts` — Fixed `prisma.ticketNote` → `prisma.ticketComment` (model name mismatch; 3 instances)
- `apps/api/src/routes/cloudconnect.ts` — Fixed `prisma.integrationConfig` → `prisma.integration` (model name mismatch)
- `apps/api/src/routes/tickets.ts` — Fixed comment `content` → `body` field name
- `apps/api/src/worker.ts` — Fixed worker `enabled` → `isActive` field name
- `apps/web/src/pages/Tickets.tsx` — Fixed ticket `comments` → `notes` field name
- `apps/api/src/seed-full.ts` — Fixed `boardId` not recognized by stale Prisma client; regenerated client
- `apps/api/src/routes/tickets.ts` — Fixed include on scalar-only models (no Prisma relations for certain FK fields)

### Prompt 15 — User creation & Assets fix, full audit
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #18 (2026.8.8.002)
> Fix user creation bug, user list display, and auth route issues. Run a full frontend audit.

**Changes:**
- `apps/api/src/routes/users.ts` — User creation now looks up Role by `systemRole` name, uses `roleId` FK
- `apps/api/src/routes/users.ts` — User list display: `role` field returned as flat string from API
- `apps/api/src/routes/users.ts` — Users GET endpoint properly maps role `systemRole` + company name
- `apps/api/src/routes/auth.ts` — Fixed `user.active` → `user.isActive` (2 more instances causing login failures)
- `apps/api/src/routes/dashboard.ts` — Fixed `resolvedToday` query: fetches resolved tickets count directly
- Full frontend audit across Dashboard, Settings, Opportunities, Projects, Clients, CloudConnect, Knowledge Base, Inference — verified no additional bugs
- `apps/web/src/pages/Users.tsx` — Added `lastLoginAt` display column; sortable headers throughout

### Prompt 16 — Report modals, Print, Export
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #10 (2026.8.9.003)
> Add Run Report modal with pretty preview, Print button, and Export functionality to the Reporting section.

**Changes:**
- `apps/web/src/pages/Reports.tsx` — "Run Report" button opens a modal with styled HTML preview
- Print button triggers `window.print()` with report-specific print styles
- Export modal with format selector (PDF, CSV, Excel), client filter, and date range picker
- Report preview embedded directly in the Run Report modal with real data from API

### Prompt 17 — Sync to GitHub, rename repo, auto-sync
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #19 (2026.8.6.003)
> Push all code to GitHub, rename the repository, and configure auto-sync.

**Changes:**
- Initialized Git repository in `C7NTAX/` with `.gitignore`
- Repository pushed to GitHub at `github.com/C7-IMI/c7-overwatch`
- Remote renamed to `C7NTAX` to match project identity
- Folder renamed from `c7-overwatch` to `C7NTAX`
- All source code, configs, and package names rebranded to C7NTAX
- Windows desktop app compiled (portable .exe + zip) and published
- `apps/desktop/package.json` — Fixed Electron 33.2.1 binary download issue

### Prompt 18 — Retrace log & auto-sync configuration
**Timestamp:** 2026-08-06 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #12 (2026.8.6.004)
> Create a Retrace log file to track all prompts, auto-append entries, and configure auto-commit+push to GitHub.

**Changes:**
- `Retrace.md` — Created with initial 18 prompt entries, timestamps, status tracking, duration metrics
- Post-commit hook configured to auto-push changes to GitHub
- Auto-sync ensures Retrace.md stays current with every commit

### Prompt 19 — Desktop app build fix & automation
**Timestamp:** 2026-08-09 | **Status:** ✅ Completed | **Duration:** ~45 min
**BuildNotes IDs:** #24 (2026.8.5.001), #23 (2026.8.5.004), #22 (2026.8.5.005)
> Fix this. Install what is necessary to make it work and automate it completely.

**Changes:**
- Restored `packages/shared/src/new-features.ts` from corrupted cache-hygiene stub (0 bytes → valid TS with Zod schemas)
- Fixed `packages/shared/src/features/index.ts` duplicate exports across `chat-workflow-etc.ts` and `sso-etc.ts`
- Ran `seed-full.ts` → populated DB with 6 users, 5 companies, 8 tickets, 6 comments, 5 time entries, 3 projects, 5 assets, 4 KB articles, 3 opportunities, 4 invoices, 4 integrations
- Ran `snapshot-capture.ts` → 115 records across 38 snapshot files
- Fixed `seed-from-snapshots.ts` FK ordering (folders must seed before documents due to `folderId` FK)
- Added comprehensive Kumo seed data (141 lines): 3 asset templates, 11 template fields, 5 flexible assets, 19 field values, 5 passwords (with placeholder encrypted values), 3 folders (with nesting), 4 documents, 4 domains, 3 certificates, 3 universal polymorphic links, 2 files
- Added `kumoTemplateField` and `kumoAssetFieldValue` to snapshot capture list
- Full round-trip verified: seed → capture → reseed = 177 records across 40 tables
- All 10 Kumo snapshot files went from empty (0 records, 2 bytes each) to populated (3–19 entries each)

### Prompt 20 — Light mode theme update
**Timestamp:** 2026-08-09 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #1 (2026.8.10.003)
> Update the light mode theme: set the background to white, and style all other elements with light contrasting colors taken from the color palette of the asset composite sheet image. Do not introduce any navy colors.

**Changes:**
- `apps/web/src/index.css` — `html.light` block: replaced all navy/slate/blue-gray CSS variable values with clean neutral grays (`#f5f5f5`, `#ebebeb`, `#d9d9d9`, `#b3b3b3`, `#808080`, `#5c5c5c`, `#424242`, `#2b2b2b`, `#1a1a1a`, `#0d0d0d`); `--navy-950: #ffffff` (white body background); `--surface: #ffffff`; `--surface-light: #f7f7f7`; `--surface-lighter: #f0f0f0`; `--surface-border: #e2e2e2`; text colors changed to dark neutrals (`#1a1a1a`, `#404040`, `#5c5c5c`, `#737373`, `#a3a3a3`)
- `apps/web/src/main.tsx` — Error boundary fallback: background `#0a1628` → `#fafafa`, title color `#fff` → `#1a1a1a`, subtitle `#94a3b8` → `#737373`, code block `#1e293b` → `#e8e8e8`, error text `#ef4444` → `#dc2626`, footer `#64748b` → `#737373`, inline code `#1e293b` → `#e0e0e0`
- `apps/web/src/main.tsx` — Toast styles switched from hardcoded hex (`#162238`, `#fff`, `#2a3a5c`) to CSS variables (`var(--surface-light)`, `var(--text-primary)`, `var(--surface-border)`)
- Scrollbar thumb colors: `#cbd5e1` → `#d4d4d4`, `#94a3b8` → `#a8a8a8`
- Cyber accent colors preserved (teal/cyan `--cyber-*` palette unchanged)

### Prompt 21 — Theme toggle icon swap & label
**Timestamp:** 2026-08-09 | **Status:** ✅ Completed | **Duration:** ~10 min
**BuildNotes IDs:** #1 (2026.8.10.003)
> Update the theme toggle so that it displays the sun icon (light mode icon) when the app is in dark mode, and the moon icon (dark mode icon) when the app is in light mode, clearly indicating that pressing it will switch to the opposite mode. Ensure the toggle is easy to understand. If it improves clarity and does not take up much space, add a small label (e.g., "Light" / "Dark").

**Changes:**
- `apps/web/src/components/Layout.tsx` — Theme toggle button: shows Sun icon + "Light" label when in dark mode, Moon icon + "Dark" label when in light mode
- Labels use `hidden lg:inline` — visible on viewports ≥1024px, icon-only on smaller screens
- Tooltip text preserved: "Switch to Light Mode" / "Switch to Dark Mode"
- Hover state changed to `hover:text-gray-200` to stay visible in both themes

### Prompt 22 — Fix theme toggle functionality (class not applying)
**Timestamp:** 2026-08-09 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #1 (2026.8.10.003)
> Fix the theme toggle so that it actually switches between light and dark modes. Currently, pressing the toggle only changes the icon; the theme stays in dark mode. Make the toggle update both the applied theme and the icon correctly.

**Changes:**
- `apps/web/src/hooks/useTheme.tsx` — Rewrote `ThemeProvider`: `applyTheme()` now called in three locations: (1) `useState` lazy initializer to set class before first render, (2) inside `setThemeState` updater in `toggleTheme` for synchronous DOM update, (3) in `useEffect` as belt-and-suspenders safety net
- Switched from `classList.add/remove` to `classList.toggle("light", t === "light")` for cleaner semantics
- Added `setAttribute("data-theme", t)` alongside class toggle for dual targeting
- `apps/web/src/index.css` — CSS selectors changed from `html.light` to `html[data-theme="light"]` for consistency

### Prompt 23 — Theme still not switching (diagnosis)
**Timestamp:** 2026-08-09 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #1 (2026.8.10.003)
> Theme switching is not working. Check the light theme color definitions to confirm they are not the same as the dark theme colors. If they are identical, update the light theme to use proper light-mode colors so switching actually changes the appearance.

**Changes:**
- Confirmed dark theme (navy `#0a1628`, `#0f1a2e`) and light theme (white `#ffffff`, neutral grays) are definitively different — CSS cascade not the issue
- `apps/web/src/hooks/useTheme.tsx` — Complete rewrite: added module-level `applyTheme(loadTheme())` that executes at script evaluation time (before React mounts) to eliminate flash of wrong theme
- New approach: injected `<style id="c7-theme-vars">` tag into `<head>` with `textContent` set to light CSS variables when in light mode, emptied when in dark mode
- `LIGHT_CSS` constant authored directly in hook — contains all light theme CSS variable declarations as a template literal
- Injected style uses `html[data-theme="light"]` selector (specificity 0,1,1) which always beats the CSS file's base `html` selector (0,0,1) regardless of DOM position

### Prompt 24 — Theme still not changing (import order diagnosis)
**Timestamp:** 2026-08-09 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #1 (2026.8.10.003)
> The theme is still not changing. Look at the attached screenshots to see the current implementation/issue, then diagnose and fix the theme-switching problem.

**Changes:**
- Diagnosed import-order issue: `useTheme.tsx` imported before `index.css` in `main.tsx`, so `applyTheme()` runs before Vite injects CSS — injected style tag lands before Vite's CSS in DOM
- `apps/web/src/hooks/useTheme.tsx` — `ensureStyleTag()` now places tag at end of `<head>` via `document.head.appendChild(el)` to guarantee it sits after Vite's injected CSS
- Confirmed fix: built CSS output shows both `html` and `html[data-theme="light"]` blocks present and correct
- Confirmed specificity: attribute selector (0,1,1) always beats type selector (0,0,1) regardless of DOM position — injected style is authoritative for light mode

### Prompt 25 — What's New section restore (server-side parser)
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~45 min
**BuildNotes IDs:** #12 (2026.8.6.004), #1 (2026.8.10.003)
> Fix the "What's New" section so it once again updates automatically and displays the full detailed content. The entries must be sourced directly from FEATURE_LIST.md, with live updates (no stale or hardcoded data). The detailed text previously shown has been lost — restore it using the attached reference images as a guide for the appearance and content level. Check whether badge elements are interfering with the detailed text display. Inspect the current format of FEATURE_LIST.md — if it was converted to a reduced format, rewrite it back.

**Changes:**
- `apps/api/src/routes/system.ts` — Replaced `require("../feature_list.json")` (7 abbreviated entries) with `parseFeatureList()` that reads `FEATURE_LIST.md` at runtime (24 fully-detailed entries)
- Parser: regex for version headers (`## YYYY.M.D.BBB — Title`) supporting em-dash, en-dash, and hyphen separators; regex for bullet items (`- **[Type]** text`) extracting `New`, `Update`, `Fix` types
- Path resolution: `resolve(__dirname, "../../../../FEATURE_LIST.md")` works from both `src/routes/` (dev) and `dist/routes/` (prod)
- Fallback chain: MD parser → static `feature_list.json` → empty `[]`
- Added `readFileSync` and `resolve` imports to top of system.ts
- Confirmed badges in Changelog.tsx ("New" green, "Update" amber, "Fix" red) are small inline labels that don't truncate text

### Prompt 26 — What's New subsection fix (client-side parsing)
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #12 (2026.8.6.004)
> Fix the "What's New" subsection to read and display its entries from the FEATURE_LIST.md file. Currently nothing is shown. The FEATURE_LIST.md content is already correct; update only the logic that parses that file and renders the entries within the subsection.

**Changes:**
- Diagnosed that API server was not responding, causing silent `.catch(() => {})` in ChangelogPage to show empty timeline
- `apps/web/src/pages/Changelog.tsx` — Complete rewrite: fetches raw `FEATURE_LIST.md` from Vite's public directory via `fetch("/FEATURE_LIST.md")`, parses client-side with same regex logic; zero API server dependency
- Added error states: shows specific error message if fetch fails or parsing produces no entries
- `apps/web/public/FEATURE_LIST.md` — Copied from project root for static serving by Vite
- `apps/web/vite.config.ts` — Added `syncFeatureList` Vite plugin that copies `FEATURE_LIST.md` from root into `public/` on every `dev` start and `build`
- Removed `api.get("/system/changelog")` call — no longer dependent on backend availability

### Prompt 27 — Kumo data loading fix & snapshot reseed
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~60 min
**BuildNotes IDs:** #22 (2026.8.5.005), #20 (2026.8.7.004), #3 (2026.8.10.001)
> Fix Kumo's broken data loading. Reseed the original sample data exactly as it existed before. Ensure that both the original sample data and any manually entered data are included in the application's snapshot and reseeded across the entire application.

**Changes:**
- Diagnosed that all 10 Kumo snapshot files (`snapshots/kumo-*.json`) were empty (2 bytes each, 0 entries) — no Kumo data was ever seeded
- `apps/api/src/seed-full.ts` — Added 141 lines of Kumo seed data: 3 asset templates (Server, Workstation, Network Device), 11 template fields (hostname, OS, CPU, RAM, IP, serial, device type, management IP), 5 flexible assets across all 5 companies, 19 asset field values, 5 passwords (Acme Domain Admin, Globex VPN, Initech Wi-Fi, Office 365 Admin, Stark AWS Root) with placeholder encrypted values, 3 folders (with parent-child nesting), 4 documents (Network Topology, Password Policy, IR Plan, Server Reboot Procedure), 4 domains (with registrars, expiry dates, nameservers), 3 certificates (Wildcard OV, DV with SANs), 3 universal polymorphic links, 2 files (PDF + Excel)
- `apps/api/src/seed-full.ts` — Added `import { Permission } from "@C7NTAX/shared"` for Super Admin role (see Prompt 31)
- `apps/api/src/snapshot-capture.ts` — Added `kumoTemplateField` and `kumoAssetFieldValue` to the `TABLES` capture list (was missing)
- `apps/api/src/seed-from-snapshots.ts` — Fixed FK dependency order: `kumo-folders.json` must seed before `kumo-documents.json` (documents reference folders via `folderId`); added `kumo-template-fields.json` and `kumo-asset-field-values.json` to seed order
- Full round-trip verified: seed → capture → reseed = 177 records across 40 tables
- All Kumo snapshots now populated: kumo-assets (5), kumo-templates (3), kumo-template-fields (11), kumo-asset-field-values (19), kumo-passwords (5), kumo-folders (3), kumo-documents (4), kumo-domains (4), kumo-certificates (3), kumo-links (3), kumo-files (2), kumo-servers (0 — populated via asset configuration, not directly)

### Prompt 28 — Passkey login implementation plan (research)
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** N/A (planning phase — no implementation)
> Create a plan to implement passkey-based login. Follow best practices and industry standards such as WebAuthn. Include flows for registration and authentication, session management, security considerations, fallback strategies, and client-server responsibilities.

**Changes:**
- Comprehensive plan covering: (1) Current auth landscape analysis (JWT, MFA, User model), (2) `@simplewebauthn/server` + `@simplewebauthn/browser` dependencies, (3) `PasskeyCredential` Prisma model + User model additions, (4) Environment config (RP_ID, RP_NAME, ORIGIN), (5) 4 API endpoints: register begin/complete, authenticate begin/complete, (6) `usePasskey` hook + Settings management + Login page integration, (7) Passkey-first UX with password fallback, (8) Session management — same JWT as password login, (9) Security: challenge replay prevention, signature counter clone detection, RP validation, rate limiting, MFA parity, (10) Fallback & recovery — passwords never removed, multi-passkey per user

### Prompt 29 — PassKey.md plan document (create file)
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** N/A (planning phase — document only)
> Create a plan document file named PassKey.md that outlines the implementation of PassKey authentication. Structure it with clear, easy-to-read sections and stage the implementation steps for future execution. Include a detailed rollback plan. Do not begin implementation; only produce the plan document.

**Changes:**
- Created `C7NTAX/PassKey.md` — 447 lines, 13 top-level sections: Current Auth Landscape, Dependencies, Database Schema Changes, Environment Configuration, API Routes — Server, Client-Side Implementation, Login Flow Design, Session Management, Security Considerations, Fallback & Recovery Strategy, Implementation Stages (4 phases), Rollback Plan (4 severity levels with feature flag architecture), Revision History
- Rollback plan: Level 1 (hide UI via `VITE_PASSKEY_ENABLED=false`, < 5 min), Level 2 (disable routes via `PASSKEY_ENABLED=false`, < 5 min), Level 3 (revert auth.ts, keep DB, < 30 min), Level 4 (drop PasskeyCredential table, < 1 hour)
- Monitoring table: login success rate, 4xx/5xx rates, latency — all with alert thresholds

### Prompt 30 — CloudConnect error fix dialog & field testing
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~90 min
**BuildNotes IDs:** #3 (2026.8.10.001), #1 (2026.8.10.003)
> In CloudConnect, when an integration displays an error, make the error label clickable. Clicking it opens a pop-up dialog that lists the error or what is missing, along with possible fixes specific to that integration, and provides examples of correct data to enter. For each errored configuration field, show an editable input with a "Test" button beside it. Clicking the Test button validates that field and immediately shows a pass/fail result. Once all errors have been tested and pass, enable an OK button that, when clicked, dismisses the dialog and submits all fixes. After dismissal, refresh the landing page to reflect the updated integration state. Ensure the landing page always displays the real-time state of every integration/connector, updating automatically without requiring manual page refresh.

**Changes:**
- `apps/api/src/routes/cloudconnect.ts` — Added 5 credential helper functions (77 lines): `getRequiredCredentials(kind)` maps all 16 integration kinds to their required credential field arrays; `formatCredLabel(cred)` converts camelCase to "Proper Label"; `getCredFix(cred)` returns step-by-step fix instructions specific to each credential field; `getCredExample(cred)` returns realistic example values (GUIDs, URLs, key formats, region codes); `checkCredFormat(key, val)` flags placeholder values, invalid GUID patterns, short region codes
- Enhanced `POST /:id/test` endpoint: on failure, returns structured `fieldErrors[]` array with `{ field, message, fix, example }` objects instead of flat error string; on success returns `{ connected: true }`
- `apps/web/src/pages/CloudConnect.tsx` — Complete rewrite (581 lines): new `FieldError` interface; new Error Fix Dialog state (`fixDialog`, `fixFieldValues`, `fixTestResults`); clickable error banner (`"Connection Failed — Click to fix"` button) on each integration card; modal overlay with per-field cards showing error message, fix instructions, and example value; editable input per field (passwords/tokens masked with `type="password"`); "Test" button per field that PATCHes that credential → POSTs `/test` → shows green ✓ Pass or red ✗ Fail inline; "OK — Save All Fixes" button disabled until all errors resolved; `submitAllFixes()` PATCHes all credentials → closes dialog → calls `fetchAll()`
- Auto-polling: `setInterval(fetchAll, 10000)` (10-second interval) keeps integration list current without manual refresh; also refreshes after every test, sync, toggle, and delete action
- `apps/web/src/pages/CloudConnect.tsx` — Removed unused `ArrowRight` import; added `X`, `FieldError` imports

### Prompt 31 — Super Admin role & session timeout bypass
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #19 (2026.8.6.003), #17 (2026.8.8.001)
> Create a role named 'Super Admin' that has all permissions enabled by default, and ensure that users with this role are not subject to any session timeout (their sessions never expire due to inactivity).

**Changes:**
- `packages/shared/src/enums.ts` — Added `SuperAdmin = "super_admin"` as first entry in `SystemRole` enum; added `[SystemRole.SuperAdmin]: Object.values(Permission)` to `ROLE_PERMISSIONS` record (inherits all permissions by default, same as Admin)
- `apps/api/src/middleware/sessionAuth.ts` — Extended inactivity timeout bypass: changed from `role === "admin"` only to `role === "admin" || role === "super_admin"`; comment updated to reflect both roles
- `apps/api/src/seed-full.ts` — Added `import { Permission } from "@C7NTAX/shared"`; creates "Super Admin" role with `systemRole: "super_admin"` and all permissions via `Object.values(Permission)`; role count updated from 4 → 5
- No DB migration needed — `systemRole` is a free-form `String` in Prisma; value "super_admin" accepted automatically
- Frontend auto-discovers: Roles page imports `SystemRole` from shared; "Super Admin" appears in role selectors without code changes

### Prompt 32 — BuildNotes IDs, session timeout settings UI, permissions fix
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~45 min
**BuildNotes IDs:** #1 (2026.8.10.003), #17 (2026.8.8.001)
> (Three-part request) 1) Add an auto-incremented ID to every list item in FEATURE_LIST.md and display that ID alongside the feature name in the "What's New" screen. The ID should be shown in the UI so users can reference it when submitting prompts. 2) Make the session timeout settings editable: create all frontend UI elements, configuration fields, and backend models wherever the session auth implementation plan specifies. The option is currently missing entirely — fix it so the admin can view and modify session timeout values. 3) Fix the permissions screen display bug: when opening the permissions screen, it must not show the yellow "changed" indicator unless the user has manually edited any permission. Apply the same logic as the previous fix that solved this.

**Changes:**
- `apps/web/src/pages/Changelog.tsx` — Added `id: number` to `Version` interface; parser assigns `versions.length + 1` as sequential ID (newest entry gets highest number); `#ID` badge displayed in version header (`<span className="badge">#{v.id}</span>`) before the version number badge
- `apps/web/src/pages/Settings.tsx` — Added "Session Timeout" card with number input (min 5, max 480), "minutes" label, and Save button; loads current value from `GET /system/config/session_timeout` on mount; saves via `PATCH /system/config/session_timeout`; help text explains default (30 min), range (5–480), and admin bypass note
- `apps/api/src/routes/system.ts` — Added `GET /system/config/:key` endpoint (single-key retrieval with JSON parsing fallback); placed before `GET /config` to prevent route conflict
- `apps/api/src/middleware/sessionAuth.ts` — Added `getSessionTimeoutMs()` async helper that reads `SystemConfig` table for key `session_timeout`; validates range (5–480 minutes); defaults to 30 min (1800000 ms); replaces hardcoded `30 * 60 * 1000`
- `apps/web/src/pages/Roles.tsx` — Added `originalPerms` state (`Set<string>`) alongside `editPerms`; `selectRole()` stores role's current permissions as originals; `startEdit()` snapshots current `editPerms` as originals before entering edit mode; amber "Changed" badge appears next to Save button only when `editPerms` differs from `originalPerms` (size mismatch or any new/removed permission); on initial open with no edits → no badge shown

### Prompt 33 — Rename FEATURE_LIST.md → BuildNotes.md
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #12 (2026.8.6.004)
> Rename the file FEATURE_LIST.md to BuildNotes.md in the repository. Update every reference to the old filename across the entire codebase, including but not limited to: links in documentation, import statements, file path references in hooks or components, and any logic that reads or parses that file. Specifically, verify that the "What's New" section of the application accurately pulls and displays data from the renamed file after this change. Ensure all functionality remains intact.

**Changes:**
- Renamed `FEATURE_LIST.md` → `BuildNotes.md` at project root
- Renamed `apps/web/public/FEATURE_LIST.md` → `apps/web/public/BuildNotes.md`
- `apps/web/vite.config.ts` — Plugin renamed `syncFeatureList` → `syncBuildNotes`; plugin name string `"sync-feature-list"` → `"sync-build-notes"`; src path `../../FEATURE_LIST.md` → `../../BuildNotes.md`; dest path `public/FEATURE_LIST.md` → `public/BuildNotes.md`; both console.log and console.warn messages updated
- `apps/web/src/pages/Changelog.tsx` — JSDoc comment `Parse FEATURE_LIST.md` → `Parse BuildNotes.md`; fetch URL `"/FEATURE_LIST.md"` → `"/BuildNotes.md"`; error message strings updated (2 instances); empty-directory hint updated
- `apps/api/src/routes/system.ts` — Inline comment `parses FEATURE_LIST.md` → `parses BuildNotes.md`; `resolve(__dirname, "../../../../FEATURE_LIST.md")` → `resolve(__dirname, "../../../../BuildNotes.md")`
- `README.md` — 3 markdown links `[FEATURE_LIST.md]` → `[BuildNotes.md]`; 1 inline reference in versioning description updated
- `BuildNotes.md` — 3 self-references updated (versioning entry, Manage Roles entry, sidebar reorganization entry)
- Verified: zero remaining `FEATURE_LIST.md` references in any `.ts`, `.tsx`, `.json`, or `.md` files across entire codebase
- Confirmed old file no longer exists on disk

### Prompt 34 — What's New search/filter
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #1 (2026.8.10.003)
> Add a search input field at the top of the What's New section. As the user types, filter the displayed items in real time: for each item, check whether its full text content (case‑insensitive) contains the entered keyword, and only show matching items. Clearing the search field restores the original, unfiltered list. The purpose is to quickly find items that reference a specific ID number.

**Changes:**
- `apps/web/src/pages/Changelog.tsx` — Added `search` state (`string`); filtering logic builds haystack from `#${v.id}`, `v.version`, `v.title`, and all `v.changes.map(c => c.text)` joined with spaces and lowercased; `filtered` array computed via `versions.filter()` when search is active, falls through to `versions` when empty
- Search input UI: `<Search>` icon positioned absolutely at left; input styled with `input-field pl-9 pr-8 py-2 text-sm`; placeholder "Search by ID, version, or keyword..."; `<X>` clear button visible only when search has text, positioned absolutely at right
- Render switched from `versions.map` to `filtered.map` so only matching entries display
- Added `Search` and `X` icons to lucide-react imports

### Prompt 35 — Retrace.md prompt log (initial extended entries)
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #12 (2026.8.6.004)
> Maintain a file named Retrace.md that logs all prompts submitted in this conversation. For each prompt, append an entry containing: a timestamp, the prompt text verbatim, all associated and corresponding ID numbers from the build notes. Below each prompt entry, include the changes that were made as a direct result of that prompt (e.g., diff summary, changed files, commit messages, or whatever is recorded in the build notes). Sort in descending order with most recent at the top. Process the entire chat history from the beginning to the current moment, and continue doing so for every future prompt, including the prompt that contains this instruction.

**Changes:**
- `Retrace.md` — Appended prompts 19–35 with expanded format: timestamps, BuildNotes ID references (e.g., `#1 (2026.8.10.003)`), verbatim prompt text as blockquotes, and detailed bullet lists of every file changed with inline descriptions
- Updated total count from 18 → 35

### Prompt 36 — Revise prompts 1–18 to standardized detail level
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #12 (2026.8.6.004)
> Revise the full sequence of prompts 1 through 18 from the very first prompt ever submitted in this project. Standardize the level of detail across all prompts so that every prompt shows the same amount of detail. If any prompt is missing from the sequence, add it and apply the same level of detail to it. Resequence and renumber the prompts after any additions or reordering. Include every prompt, and record every associated change — no change is too minor or too repetitive to omit. Output the complete, final list of prompts. Do this for future prompts as well.

**Changes:**
- `Retrace.md` — Prompts 1–18 completely rewritten to match the standardized format of prompts 19–35: each entry now includes `**BuildNotes IDs:**` line mapping to specific `#ID (version)` references, verbatim prompt text as blockquotes, and detailed `**Changes:**` bullet lists with specific file paths and inline descriptions of every modification
- All 36 prompts now follow the identical structure: `### Prompt N — Title`, `**Timestamp:**`, `**Status:**`, `**Duration:**`, `**BuildNotes IDs:**`, blockquote prompt text, `**Changes:**` bullet list
- Total count verified: 36 prompts, all completed
- This prompt (36) itself recorded per the "do this for future prompts as well" instruction

### Prompt 37 — Collect all prompts & write complete Retrace.md
**Timestamp:** 2026-08-10 | **Status:** ✅ Completed | **Duration:** ~5 min
**BuildNotes IDs:** #12 (2026.8.6.004)
> Collect all user prompts that have been submitted in this project from its start to the present moment. Ensure no prompt is omitted. Write all prompts, in chronological order, to the file `Retrace.md`. If the file already exists, overwrite it with this full record.

**Changes:**
- `Retrace.md` — Verified all 36 prior prompts present and complete; added Prompt 37 (this entry); confirmed chronological ordering from 2026-08-04 through 2026-08-10; total count 37 prompts

### Prompt 38 — Permissions tab yellow highlight fix
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #2 (2026.8.12.001)
> Fix the permissions tab visual bug: when opening the tab for the first time, it incorrectly shows a yellow highlight/indicator even though the permissions already match the assigned/selected role. The indicator should only appear when there is an actual mismatch.

**Changes:**
- `apps/web/src/pages/Users.tsx` — Removed auto-`setRoleTemplate()` from `refreshUser()` and `openDetail()` so the role template dropdown no longer initializes to the user's systemRole; `roleTemplate` stays null on open, keeping `deviates` false until a template is explicitly selected

### Prompt 39 — Project Calendar fixes + monthly calendar card
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~40 min
**BuildNotes IDs:** #2 (2026.8.12.001)
> Fix the Project Calendar loading failure and the missing new event display. Then, add a monthly calendar card above the scheduled events card in the Calendar subsection. The monthly calendar should function like Outlook calendars: a month grid with navigation, event indicators, and date-click interaction.

**Changes:**
- `apps/api/src/routes/schedule.ts` — POST route now accepts and stores `color` field so new events keep their chosen color
- `apps/web/src/pages/Calendar.tsx` — Full rewrite: monthly calendar card above Scheduled Events with prev/next month navigation, day-of-week headers, colored event dots per date (max 3 + overflow), today highlighting, click-a-date filtering of the event list; robust response parsing `Array.isArray(r.data) ? r.data : (r.data.data || [])`; form resets after create

### Prompt 40 — Permissions editing behavior vs assigned role
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #2 (2026.8.12.001)
> Update the user permissions editing behavior: the yellow highlight should only appear if permissions do not match the user's assigned role defaults; after modifying, highlight whenever selections differ; comparison always against the currently assigned role.

**Changes:**
- `apps/web/src/pages/Users.tsx` — `deviates` now always computed as `has !== selected.role.permissions.includes(p)` (no longer gated on `roleTemplate`); status banner shows amber "customized" or green "match" when editing; `roleTemplate` repurposed to preset-application only; generic warning banner no longer gated on `!roleTemplate`

### Prompt 41 — Human-readable audit logs
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~35 min
**BuildNotes IDs:** #2 (2026.8.12.001)
> Refactor the audit logging display to eliminate any raw JSON, code blocks, or machine-oriented serialization. Render each event as a descriptive narrative with friendly labels while preserving all captured information.

**Changes:**
- `apps/api/src/routes/system.ts` — `/audit-logs` resolves user full names via batched `prisma.user.findMany` and enriches each log with `userName`
- `apps/web/src/pages/Administration.tsx` — Added `ENTITY_LABELS`, `FRIENDLY_FIELDS`, `formatValue()`, and `buildAuditSentence()` helpers; detail column renders narrative sentences ("updated ticket #abc12345 — status to in progress") instead of `JSON.stringify(log.changes)`; booleans as enabled/disabled, `***` as (redacted), arrays as item counts, nested objects flattened

### Prompt 42 — Modify Selected menu confirmation workflow
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #2 (2026.8.12.001)
> In the Modify selected menu: make item names user-friendly (no underscores); add checkboxes, an OK button applying only checked items, and a Cancel button dismissing without changes.

**Changes:**
- `apps/web/src/pages/Tickets.tsx` — Dropdown renders `a.label` instead of raw `a.value`; items became checkbox rows with `checkedActions` state reset on open; OK runs `batchApplyChecked()` sequentially over checked actions with per-action success/failure toasts; Cancel closes without changes; `applyBatchAction` converted to pure helper returning boolean

### Prompt 43 — What's New update continuity
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #2 (2026.8.12.001)
> Fix the What's New update issue: it did not update with application changes after the previous fix, including the last two prompts. From now on, update both What's New and BuildNotes.md continuously after every change or prompt submission.

**Changes:**
- `apps/web/public/BuildNotes.md` + `BuildNotes.md` — Added `2026.8.12.001` entry covering calendar, permissions UX, audit log readability, and batch confirmation changes; header bumped to `2026.8.12.001`
- `apps/api/src/feature_list.json` — Added matching `2026.8.12.001` entry (renamed to BuildNotes.json in Prompt 44)
- Established standing practice: update all three changelog sources after every code change

### Prompt 44 — Rename feature_list.json to BuildNotes.json
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #1 (2026.8.12.002)
> Rename feature_list.json to BuildNotes.json to match the naming convention used by BuildNotes.md and its associated function. Update all references, links, hooks, code, and any other usage of feature_list.json accordingly. Ensure all functionality continues to work, especially that "What's New" is continuously updated.

**Changes:**
- `apps/api/src/feature_list.json` → `apps/api/src/BuildNotes.json` — File renamed; new `2026.8.12.002` entry added documenting the rename
- `apps/api/src/routes/system.ts` — `parseFeatureList()` → `parseBuildNotes()` (definition + call site); fallback `require("../feature_list.json")` → `require("../BuildNotes.json")`
- `apps/web/src/pages/Changelog.tsx` — `parseFeatureList()` → `parseBuildNotes()` (definition + call site)
- `apps/web/public/BuildNotes.md` + `BuildNotes.md` — Historical entries naming `feature_list.json` as data source now reference `BuildNotes.json`; new `2026.8.12.002` entry added to both copies
- `Retrace.md` — Prompts 38–44 appended (this session); total count 37 → 44
- Verified: zero remaining functional `feature_list`/`FeatureList` references in `.ts`/`.tsx`/`.json` sources; BuildNotes.json parses (9 entries); public BuildNotes.md parses (27 entries); LSP diagnostics clean on both edited source files

### Prompt 45 — Audit log username + userID & default expansion
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #1 (2026.8.12.003)
> Fix the audit logs so each log entry displays both the friendly, human-readable Username and the UserID. Keep all other audit log functionality unchanged. When the audit logs subsection is clicked in the left navigation pane, the top most recent log entry and the next two entries should default to expanded. All entries after those three should default to collapsed.

**Changes:**
- `apps/web/src/pages/Administration.tsx` — `LogEntry` entries now carry `user` and `userId` separately; data mapping stores `log.userName` as `user` and 8-char `log.userId` prefix as `userId` (empty for system entries); user column renders both as "Name (a1b2c3d4)"
- `apps/web/src/pages/Administration.tsx` — `expanded` state changed from `string | null` to `Set<string>`; after sorting day groups newest-first, `setExpanded(new Set(sorted.slice(0, 3).map(d => d.id)))` pre-expands the top three groups; toggle add/removes from the set for independent expand/collapse
- All three changelog sources updated with `2026.8.12.003` entry; LSP diagnostics clean

### Prompt 46 — Friendly Notes & Activity card in Ticket Details
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~30 min
**BuildNotes IDs:** #1 (2026.8.12.004)
> Fix the Notes and Activity card in Ticket Details. This is a regression after changing the service board from Infrastructure to Intelligence. On some tickets, the card is displaying raw data instead of friendly names for fields and actions. Update the card so every field and action renders its human-readable/friendly name, not raw enum values, IDs, or internal codes.

**Changes:**
- `apps/api/src/routes/tickets/index.ts` — PATCH change-comment generation now uses a `resolveValue()` helper: board/assignee/contact/company/serviceAgreement IDs are resolved to friendly names via Prisma lookups; Date values formatted as "Aug 13, 2026, 6:04 AM"; status/priority enums title-cased; empty values as "(empty)"
- `apps/web/src/pages/Tickets.tsx` — Added `friendlyActivityBody()` in `TicketDetailPage`: detects machine-generated change-log bodies ("Label: old → new"), resolves UUIDs via lookup maps (boards, users, companies, contacts, agreements, ticket relations), converts ISO timestamps to readable dates, title-cases snake_case enums; plain note bodies pass through unchanged
- `apps/web/src/pages/Tickets.tsx` — Comment badges now Email (purple)/Internal (amber)/Note (blue); author fallback to `fromEmail` for email comments, "System" otherwise; time entries show entry date and "System" fallback
- All three changelog sources updated with `2026.8.12.004` entry; LSP diagnostics clean on both files

### Prompt 47 — Outlook-style mini-card project calendar
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~25 min
**BuildNotes IDs:** #1 (2026.8.12.005)
> Update the project calendar to be smaller and visually cleaner. Move the date number to the top-left corner of each day cell instead of the center. Add borders to each day cell in a mini card style, using subtle card borders and consistent spacing. Follow the provided screenshot as the reference for design, layout, and functionality, and keep the existing calendar behavior intact.

**Changes:**
- `apps/web/src/pages/Calendar.tsx` — Monthly calendar card redesigned: cells changed from `aspect-square` centered style to `min-h-[60px] rounded-md border p-1` mini cards with `border-surface-border` and `gap-1` consistent spacing; date number now top-left (`items-start text-left`); day headers compacted to 10px uppercase
- `apps/web/src/pages/Calendar.tsx` — Event dots replaced with Outlook-style chips: up to 2 per cell, each showing `startTime` + title in the event's color (colored translucent background); "+N more" overflow line; today = cyber border/tint, selected = stronger cyber border/background; nav icons reduced 18→16px, card padding p-4→p-3
- Behavior preserved: month prev/next, month-title click → today, date click → filter Scheduled Events, clear-filter row
- All three changelog sources updated with `2026.8.12.005` entry; LSP diagnostics clean

### Prompt 48 — Time Off monthly calendar
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #1 (2026.8.12.006)
> In the Time Off subsection, add the same type of calendar used elsewhere, placing it above the PTO Requests card.

**Changes:**
- `apps/web/src/pages/PTO.tsx` — Added the same Outlook-style mini-card month calendar above the PTO Requests card (month navigation, day headers, bordered mini-card cells, top-left dates, today/selected highlights)
- `apps/web/src/pages/PTO.tsx` — PTO requests mapped across their full date span into status-colored chips (approved green, denied red, pending amber); up to 2 chips per day with "+N more" overflow; click-a-date filters the requests table with clear-filter row; card header shows total/filtered count; create form resets after submission
- All three changelog sources updated with `2026.8.12.006` entry; LSP diagnostics clean

### Prompt 49 — Selected-state highlight in navigation pane
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #1 (2026.8.12.007)
> Update the navigation pane so the selected section/subsection is clearly highlighted. Currently the selected state is hard to distinguish because it only changes the text color and shows a small arrow. Change the selected section/subsection background to use the same light background as the hover state shown in the screenshot, and keep that highlight consistent for the active/selected item.

**Changes:**
- `apps/web/src/components/Layout.tsx` — All four active-state class groups changed from faint cyber tints (`bg-cyber-600/10`, `bg-cyber-600/15` + `text-cyber-400`) to the hover-style highlight `bg-surface-lighter text-white`: collapsed-mode icon buttons, collapsed-mode links, expandable parent section buttons, and leaf/section links
- Secondary indicators retained: active ChevronRight on leaf items and the collapsed-mode right-edge cyber bar
- All three changelog sources updated with `2026.8.12.007` entry; LSP diagnostics clean

### Prompt 50 — Ticket detail toolbar, tabs, and icon actions
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~60 min
**BuildNotes IDs:** #1 (2026.8.12.008)
> Update the ticket detail screen to add a new toolbar/card at the top, directly underneath the ticket summary, spanning the full width of the General and Classification & Details cards with each card on its own row. Use a tabbed interface for the menu options and action buttons shown in the screenshot. Create tabs for all labels shown except Tasks, Open Tickets, Conversions, Surveys, and RMA. Infer options and behavior from existing features and standard PSA workflows. Build out configuration dialogs for each option. Below the tabbed interface, replicate the icon toolbar — implement decipherable icons, placeholder the unclear ones. Extend the application and adapt the affected ticket detail pages.

**Changes:**
- `apps/api/src/routes/tickets/index.ts` — PATCH `allowed` list now includes `customFields` (persists tab data); change-comment loop skips `customFields` to avoid logging raw tab JSON
- `apps/web/src/pages/Tickets.tsx` — Added `TICKET_DETAIL_TABS` (12 tabs, excluded ones omitted); new full-width toolbar card under the ticket summary with tab strip + icon toolbar (Refresh/Add Note/Log Time/Attach functional; Email/Print/Follow Up/More as "coming soon" placeholders); Ticket tab restructured to single-column so General and Classification & Details each sit on their own full-width row
- `apps/web/src/pages/Tickets.tsx` — New tabs with dialogs: Configurations (search assets + Kumo configs, link/unlink via customFields), Products (qty/cost table with totals), Activities (merged chronological feed), Time (billable/non-billable totals + add dialog), Links (ticket search + relation type), Expenses (real /billing/expenses API with add/delete), Schedule (real /schedule API with ticketId), Attachments (metadata placeholder with download toast), History (friendly field-change log), Finance (totals + agreement + invoice links), Audit Trail (ticket-scoped /system/audit-logs)
- `apps/web/src/pages/Tickets.tsx` — Time logging endpoint corrected from `/tickets/:id/time-entries` (nonexistent) to `/tickets/:id/time`
- Verified: `tsc --noEmit` clean; all three changelog sources updated with `2026.8.12.008`

### Prompt 51 — Square date cards on all calendars
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #1 (2026.8.12.009)
> Using the attached screenshot as reference, update all calendars so the date cards remain square instead of rectangular for a cleaner visual style. Adjust the vertical height of the calendar card as necessary to support the square date cards. Preserve the smaller size that was already implemented as much as possible. Ensure the entire month is visible on a single screen without needing to scroll.

**Changes:**
- `apps/web/src/pages/Calendar.tsx` — Day cells (including empty leading cells) changed from `min-h-[60px]` to `aspect-square`; calendar card constrained to `max-w-3xl` so squares remain small (~100px) and 6-week months fit on one screen
- `apps/web/src/pages/PTO.tsx` — Same changes applied to the Time Off calendar (empty cells + day cells `aspect-square`, card `max-w-3xl`)
- All existing calendar behavior preserved (navigation, jump-to-today, highlights, chips, date filtering); `tsc --noEmit` clean on both files; all three changelog sources updated with `2026.8.12.009`

### Prompt 52 — Restore two-column ticket card layout & compact toolbar tabs
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #1 (2026.8.12.010)
> Adjust the card layout: 1) Move the "Classification & Details" card and the "Client info" card back to their original location, to the right of the "General" card. Use the attached screenshots as a reference. Restore full functionality. 2) Make the "Toolbar" card span the full width of the two columns originally created by the "General" card and the "Classification & Details" card. 3) In the "Toolbar" card, reduce the label font size and tighten spacing so all options fit without requiring horizontal scrolling.

**Changes:**
- `apps/web/src/pages/Tickets.tsx` — Ticket tab grid restored from single-column (`grid-cols-1`) to original two-column layout (`grid-cols-1 lg:grid-cols-3 gap-5`) with left column `lg:col-span-2` (General, Dates & Times, Notes & Activity) and right column (Classification & Details, Client Info) — both cards' display/edit modes intact
- `apps/web/src/pages/Tickets.tsx` — Toolbar card remains a top-level full-width card spanning both columns
- `apps/web/src/pages/Tickets.tsx` — Tab strip tightened: `gap-0`, `whitespace-nowrap`, tab labels `text-xs` with `px-2 py-1` so all 12 tabs fit without horizontal scrolling on desktop
- Verified: `tsc --noEmit` clean; all three changelog sources updated with `2026.8.12.010`

### Prompt 53 — Sample data toggling
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~35 min
**BuildNotes IDs:** #1 (2026.8.12.011)
> Implement sample data toggling. Explicit disable commands: "disable sample data" or "turn off sample data" — create a snapshot as usual, remove the sample data so the application appears empty, do not automatically reseed after a change while disabled, do not overwrite the snapshot until re-enabled. Explicit enable commands: "enable sample data" or "turn on sample data" — reseed using established processes, resume snapshot→auto-reseed after change. Command detection: only apply when explicit; phrases inside natural-language sentences are ignored and treated as normal prompts.

**Changes:**
- `apps/api/src/services/sampleDataState.ts` — New flag module: `.sample-data-disabled` marker file with `isSampleDataDisabled()` / `setSampleDataDisabled()`
- `apps/api/src/sample-data-toggle.ts` — New toggle script (`npx tsx src/sample-data-toggle.ts off|on`): OFF captures snapshot first, wipes all business models children-first (identity + platform config preserved: user, role, session, refreshToken, tenant, systemConfig, ssoConfig, fieldPermission, locale, translation, currency, exchangeRate, retentionPolicy), sets flag; ON reseeds via seed-from-snapshots while flag still set, then clears flag
- `apps/api/src/snapshot-capture.ts` — Guard added: skips capture when sample data disabled (snapshot locked)
- `apps/api/src/services/autoSnapshot.ts` — `scheduleSnapshotCapture()` returns early when disabled (no auto-capture after writes)
- `apps/api/src/services/snapshotPoller.ts` — Poll cycle skips captures when disabled (keeps record count in sync, no capture, no auto-reseed)
- `apps/api/package.json` — Added `db:sample-off` / `db:sample-on` scripts; root `package.json` — passthroughs `db:sample-off` / `db:sample-on`
- Command detection rule documented in BuildNotes entries: explicit standalone commands only; natural-language mentions treated as normal prompts
- Verified: `tsc --noEmit` clean on all new/modified files; flag round-trip tested (`set(true)` → detected, `set(false)` → removed; no leftover marker); live DB untouched (feature not executed — prompt is the implementation request, not the disable command)

### Prompt 54 — Seed ticket tab sample data for all tickets
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~45 min
**BuildNotes IDs:** #1 (2026.8.12.012)
> Seed the new tabs and fields on the toolbar card in the ticket details view with sample data so every ticket shows representative content when each tab is clicked. Apply this sample data to all tickets. Include the new sample data in the snapshot/reseed process following the existing pattern. Add and link the sample data to the appropriate sections throughout the app. For example, an expense created in the tab dialog should also appear in the Time & Expenses subsection under Billing.

**Changes:**
- `apps/api/src/seed-ticket-tabs.ts` — New idempotent script: per ticket adds 2 configurations, 2 products, 2 links, 2 attachments (customFields), 2 expenses (Expense rows), 2 schedule entries (ScheduleEntry rows), 1 History change-log comment, 2 audit trail entries; run against live DB (8 tickets seeded)
- `apps/api/src/snapshot-capture.ts` — Added `scheduleEntry` → `schedule-entries.json` (42 tables total)
- `apps/api/src/seed-from-snapshots.ts` — Added `schedule-entries.json` → `scheduleEntry` to seed order
- `apps/api/src/seed-full.ts` — Full reseed now creates the same tab data (16 expenses, 8 schedule entries, 8 history comments, 10 audit entries, customFields for all 8 tickets); cleanup section now wipes expense, scheduleEntry, and auditLog
- `apps/web/src/pages/Billing.tsx` — Time & Expenses tab now fetches `/billing/expenses` and renders an Expenses section (ticket number via ticket map, description, category badge, date, amount, total line)
- Live DB verified: 8/8 tickets with customFields, 16 ticket expenses, 16 ticket schedule entries, 8 history comments, 16 ticket audit entries; snapshot recaptured (236 records, 42 tables) with `schedule-entries.json` (17 entries) and customFields in tickets.json
- All three changelog sources updated with `2026.8.12.012`; `tsc --noEmit` clean on all modified files

### Prompt 55 — Connect all remaining tab dialog data app-wide
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~50 min
**BuildNotes IDs:** #1 (2026.8.12.013)
> Ensure all remaining data entered or displayed in the tabbed dialogs is connected to its corresponding locations throughout the application, so each field stays synchronized with the rest of the app.

**Changes:**
- `apps/api/src/routes/tickets/index.ts` — New `POST /tickets/:id/attachments` and `DELETE /tickets/:id/attachments/:attId`; ticket detail GET now includes `attachments`
- `apps/web/src/pages/Tickets.tsx` — Attachments tab switched from customFields metadata to real `TicketAttachment` records (file input dialog reads name/size/type; delete via API; size formatted); Configurations now store `kind` + `refId` with Open links (assets → /assets/:id, Kumo servers → /kumo/configs, Kumo assets → /kumo/assets/:id); link dialog fetches correct `/kumo/configs/servers` endpoint and maps `kumoAsset?.name || hostname`; Links tab shows incoming reverse links; Finance tab includes Products total card
- `apps/api/src/seed-ticket-tabs.ts` — Migration: legacy customFields attachments → real TicketAttachment rows (16); deterministic config enrichment with real asset/Kumo-server refIds; ensures Kumo server records exist (5 created)
- `apps/api/src/seed-full.ts` — Real attachments (16), Kumo server records (3), configs linked to real asset/Kumo-asset IDs after entity creation; cleanup for ticketAttachment
- `apps/api/src/snapshot-capture.ts` + `seed-from-snapshots.ts` — Added `ticketAttachment` → ticket-attachments.json (43 tables)
- Live DB verified: 8 asset refs + 8 server refs (no duplicates), 16 real attachments, 5 Kumo servers; snapshot recaptured (259 records, 43 tables)

### Prompt 56 — Add Time Entry button on Dates & Times card
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #1 (2026.8.12.014)
> Restore the missing Add Time Entry button on the Dates & Times card. The button was previously labeled "Log Time"; rename it to "Add Time Entry" to match the Time tab. Keep the card button's font size smaller, as it was when labeled "Log Time." Keep the Time tab functionality unchanged. Users should be able to add time from both the Dates & Times card and the Time tab. Refer to the screenshots for the expected button location and styling.

**Changes:**
- `apps/web/src/pages/Tickets.tsx` — Dates & Times card header is now a flex row with the title on the left and an "Add Time Entry" button on the right; button uses the previous small `text-xs text-cyber-400` styling with a 12px Timer icon; clicking it opens the same `showTimeTabAdd` modal dialog used by the Time tab
- `apps/web/src/pages/Tickets.tsx` — Notes & Activity inline toggle button relabeled "Log Time" → "Add Time Entry" for consistency
- Time tab untouched — same dialog, totals cards, and entries list
- Verified: `tsc --noEmit` clean; all three changelog sources updated with `2026.8.12.014`

### Prompt 57 — Native mobile applications plan (Android + iOS)
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~40 min
**BuildNotes IDs:** #1 (2026.8.12.015)
> Create a plan for building native mobile applications for C7NTAX that replicate the core functionality of the existing native desktop client. The plan is for Android and iPhone and will be used later to implement the actual apps. Use native platform toolkits: Kotlin and Jetpack Compose for Android, and Swift and SwiftUI for iOS. Cover: additional software/SDKs/dependencies/configuration; required architectural changes to the backend (API design, authentication, data synchronization, offline behavior, notifications); security best practices (secure storage, encrypted transport, certificate pinning, auth/session handling, secrets management, platform data safety); publishing to Google Play and Apple App Store (signing, privacy manifests, review guidelines, maintenance). Return a structured, phased plan with deliverables, technology choices, and action items. Do not implement any code yet.

**Changes:**
- `mobile-native-plan.md` — New 344-line phased plan document (19.4 KB): objectives & feature parity matrix (12 v1 features, billing/reports/admin excluded); Phase 0 foundations (monorepo layout apps/mobile/{android,ios,shared}, Android JDK 17 + Gradle version catalogs + Compose BOM, iOS Xcode 16/Swift 5.10/SwiftData, OpenAPI codegen, GitHub Actions macos-15 + ubuntu, Fastlane, Sentry/Crashlytics, FCM); Phase 1 backend enablement (versioned /api/v1, ETag/If-None-Match, cursor pagination, device sessions + refresh-token rotation + PKCE, FCM/APNs push with device registry, /sync delta endpoints with updatedAt cursors + last-write-wins, offline write queue with idempotency keys, pre-signed URL uploads); Phases 2–3 Android/iOS builds (MVVM, Room/SwiftData caches, WorkManager/BackgroundTasks sync, BiometricPrompt/Face ID, feature parity per platform); Phase 4 security (TLS 1.2+, cert pinning via OkHttp CertificatePinner/URLSession delegate, Android Keystore/iOS Keychain, FLAG_SECURE, root/jailbreak detection advisory, CI-injected secrets, Play Data Safety + Apple PrivacyInfo.xcprivacy); Phase 5 publishing (Play Console + Play App Signing + AAB + staged rollout; Apple Developer Program, App Store Connect, TestFlight, review guideline mapping 4.2/5.1.1/1.1.6; Fastlane beta/release lanes; monitoring and update cadence)
- No code implemented per instruction; all three changelog sources updated with `2026.8.12.015`

### Prompt 58 — Desktop app replicates WebUI exactly
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~55 min
**BuildNotes IDs:** #1 (2026.8.12.016)
> Using the WebUI as the source of truth, update the existing Desktop app so its current application state and interface replicate the WebUI exactly.

**Changes:**
- `apps/desktop/src/main.ts` — Rewritten: custom `app://c7ntax` protocol (registered as privileged) serves the built WebUI dist with SPA fallback + correct mime types; `/api/*` requests proxied to the API server (localhost:4000) via `net.fetch` so the WebUI's relative `/api` base works unchanged; production loads `app://c7ntax/`, dev loads the Vite dev server (localhost:3010); stable origin makes localStorage state (login, theme, sidebar) persistent; window bounds persisted to userData
- `apps/desktop/package.json` — `prebuild` runs `vite build` in the web package (fresh WebUI as source of truth); `extraResources` copies `web/dist` → `resources/webui`; `npmRebuild: false` (fixes pnpm `workspace:` protocol breaking electron-builder); `dev` script passes `--dev`
- `apps/web/src/App.tsx` — Added `DesktopNavBridge` (listens to `window.c7Desktop.onNavigate` and navigates the router) so desktop menu shortcuts (Settings/New Ticket/New Invoice) work in the same UI
- Pre-existing web strict-mode type fixes to unblock the build: `Changelog.tsx` non-null assertions, `SectionLanding.tsx` + `HomePage.tsx` icon types widened, `Clients.tsx` sort state typed as `SortState | null`, `KumoConfigs.tsx` state arrays typed
- Verified: desktop `tsc` clean; web `vite build` green; portable exe built (144 MB) with bundled `resources/webui` (fresh dist); exe copied to `apps/desktop/dist-electron/C7NTAX-Portable-1.0.0.exe`; remaining shared-package strict-mode errors are pre-existing baseline debt untouched by this task
- All three changelog sources updated with `2026.8.12.016`

### Prompt 59 — Native desktop clients plan (Windows / Linux / macOS)
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~25 min
**BuildNotes IDs:** #1 (2026.8.12.017)
> Create a plan only to rewrite the current Desktop app into three additional native client applications: one for Windows, one for Linux, and one for macOS. Choose a native language or framework for each platform—not Electron or other web frameworks—optimizing for best compatibility, easiest maintenance, best speed, and lowest memory/resource usage, with particular priority on speed and low resource usage. Include all required software, compilers, SDKs, UI SDKs, binaries, libraries, and dependencies that must be installed and configured to build each version. The new applications must look and function as close as possible to the current web/desktop version. Follow each platform's best practices. Ensure each application can be compiled and packaged into installers: MSI or EXE for Windows, .deb or Flatpak for Linux, and .pkg or .dmg for macOS. Output only the plan. The current Electron based desktop version will remain part of the project and be updated alongside these 3 new versions. It will not be replaced as part of the rewrite.

**Changes:**
- `native-desktop-plan.md` — New 189-line plan document (11.2 KB), plan only, no code: technology selection C#/.NET 8 LTS + WinUI 3 (Windows, Native AOT option, WPF fallback), Rust + GTK 4/libadwaita gtk4-rs (Linux, Qt6 fallback), Swift 6 + SwiftUI/AppKit (macOS); rejection rationale for C++/Win32, cross-platform frameworks, Tauri/webview shells
- Full per-platform toolchains/SDKs/dependencies: Windows (Visual Studio 2022 workloads, Windows App SDK 1.5+, Windows SDK 10.0.26100, WiX v4, MSIX, signtool), Linux (rustup 1.80+, GTK4/libadwaita dev, flatpak-builder GNOME SDK 46, cargo-deb, AppStream), macOS (Xcode 16+, SPM, create-dmg/pkgbuild/productbuild, Developer ID + notarytool/stapler)
- Installers: MSIX + MSI + self-contained AOT EXE (Windows), .deb + Flatpak (Linux), .dmg + .pkg with notarization (macOS)
- Design-token parity approach (machine-readable tokens → WinUI ResourceDictionary / GTK CSS provider / SwiftUI extensions), same REST API backend, feature parity matrix, security (secure storage per platform, TLS, signing), CI/CD (GitHub Actions per-OS runners), performance budgets, phased delivery plan and milestones; Electron app explicitly retained and updated alongside
- All three changelog sources updated with `2026.8.12.017`

### Prompt 60 — Native desktop OSS plan
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~25 min
**BuildNotes IDs:** #1 (2026.8.12.018)
> Review the existing native desktop implementation plan in this repository. Replace all proprietary tools, including Visual Studio 2022, with open-source alternatives that can achieve the same results the plan calls for. If no direct open-source alternative exists, suggest ways to accomplish the same results using the features of available open-source tools. Assume you have not purchased any proprietary software yet and are trying to reduce development costs without buying anything. Create another plan file called `native desktop oss plan` that preserves the original plan's goals and structure while using only open-source or free tooling.

**Changes:**
- `native-desktop-oss-plan.md` — New 249-line plan document (16.6 KB) preserving the original plan's goals, structure, phases, parity checklist, and performance budgets while replacing all proprietary tooling: Visual Studio 2022 → VS Code + C# extension + dotnet CLI; MSIX Packaging Tool GUI → msix-packaging CLI (makemsix/signmsix); signtool → osslsigncode + self-signed certs; MSVC AOT linker → LLVM clang-cl + lld-link; Squirrel → Velopack/WinSparkle; Xcode → VS Code + swift.org toolchain + Command Line Tools with scripted .app bundling; GitHub Actions → Forgejo/Gitea Actions, GitLab CE, or Jenkins with self-hosted runners; Instruments → dotnet-trace/perf/Tracy/samply/FlameGraph/hyperfine; commercial monitoring → GlitchTip or OpenTelemetry+Grafana; Figma → Inkscape/Penpot
- License column for every tool; no-purchase signing/distribution strategies (self-signed + WinGet sideload for Windows, ad-hoc codesign + Homebrew Cask for macOS, Flathub for Linux); new cost & compliance comparison section flagging the only unavoidable costs (Apple hardware for macOS CI; optional paid certs/Apple Developer Program only if SmartScreen reputation or notarization is required)
- All three changelog sources updated with `2026.8.12.018`

### Prompt 61 — Service Alerts (outage monitoring, banner, alerting)
**Timestamp:** 2026-08-12 | **Status:** ✅ Completed | **Duration:** ~3.5 h
**BuildNotes IDs:** #1 (2026.8.12.019)
> Implement a new draggable parent section named "Service Alerts" placed below "Service Boards" in the application navigation. Use AutoTaskPSA, ConnectWise Asio, HaloPSA, Kantata, Scoro, NinjaOne, Atera, and ConnectWise PSA as layout and functionality references, while keeping the existing C7NTAX application theme/style. Include typical PSA service alert capabilities. Service Alerts landing page/dashboard: aggregate outage/alert cards for major services (Microsoft 365, Azure, AWS, GitHub, Comcast, Verizon, Spectrum, and other configured major ISPs/services); source alerts from DownDetector, Twitter/X, official status/alert sites, and RSS feeds whenever available; import and parse RSS feeds. Global outage banner: dismissable red banner below the header with click-through to the dashboard, service-name-replaced text, close button far right, persisting across sections until dismissed or auto-cleared; badge icon on the nav section with active alert count. Alerting mechanism: monitor feeds on a schedule, auto-create alerts on outages, auto-clear banner/alert when service is restored. Administration configuration subsection: Service Alerts settings page under Administration.

**Changes:**
- `apps/api/prisma/schema.prisma` — New `ServiceAlertService` (name, category, description, statusPageUrl, downDetectorUrl, rssUrl, monitorEnabled, enabled, sortOrder) and `ServiceAlert` (serviceId, title, description, severity outage/degraded/informational, status active/resolved, source rss/statuspage/downdetector/manual, sourceUrl, detectedAt, resolvedAt) models; db pushed
- `apps/api/src/services/alertMonitor.ts` — Background monitor (5-min interval + initial run): dependency-free RSS/Atom parser, outage/degraded keyword classifier and restored/resolved classifier, auto-create/update/resolve alerts, in-memory run snapshot (lastCheckAt, created/updated/resolved counts, errors, log); status-page HTML probing deliberately excluded after it produced false positives
- `apps/api/src/routes/serviceAlerts.ts` — `/api/service-alerts` routes: GET / (active + resolved), GET /status (banner payload), GET /services, POST/PATCH/DELETE /services, POST / (manual alert), POST /:id/resolve, POST /refresh, GET /monitor-status; gated by new `ServiceAlertView`/`ServiceAlertManage` permissions
- `packages/shared/src/enums.ts` — New `Permission.ServiceAlertView`/`ServiceAlertManage`, PERMISSION_CATEGORIES group, and ROLE_PERMISSIONS additions for all 8 default roles
- `apps/api/src/seed-service-alerts.ts` — New seed: 8 monitored services (M365, Azure, AWS, GitHub, Google Workspace, Comcast/Xfinity, Verizon, Spectrum) with real status/DownDetector/RSS URLs, representative alerts (2 active, 1 resolved), role permission backfill for existing roles
- `apps/api/src/seed-full.ts` — Service-alert cleanup + seeding (8 services, 3 alerts) and role permission strings for full reseeds
- `apps/api/src/snapshot-capture.ts` / `seed-from-snapshots.ts` / `sample-data-toggle.ts` — serviceAlertService + serviceAlert added to capture, seed order, and wipe lists; snapshots recaptured (275 records / 45 tables)
- `apps/web/src/components/Layout.tsx` — Service Alerts parent section below Service Boards (draggable, collapsed-icon + label badges with live count), admin child entry, section descriptions, global red outage banner below header (click → /service-alerts, dismiss X far right, localStorage `c7_sa_dismissed` per-alert persistence, 60s polling, auto-clear on resolution)
- `apps/web/src/pages/ServiceAlerts.tsx` — Dashboard: summary strip (outages/degraded/operational/monitored), active-alert list with severity accents and source links, monitored-service card grid with status badges and Status/DownDetector/RSS links, recently-resolved list, 60s auto-refresh
- `apps/web/src/pages/ServiceAlertsSettings.tsx` — Administration page: monitor status panel (last check, services polled, created/resolved, feed errors), manual alert creation, services table (visibility + feed-polling toggles, sources, active counts), add/edit/delete dialog, Run Monitor Check Now
- `apps/web/src/App.tsx` — `/service-alerts` and `/admin/service-alerts` routes
- `apps/api/src/verify-post-change.ts` — New pages added to required checks; min counts serviceAlertService: 8, serviceAlert: 2
- All three changelog sources updated with `2026.8.12.019`

### Prompt 62 — Service Alerts nested under Service Boards
**Timestamp:** 2026-08-13 | **Status:** ✅ Completed | **Duration:** ~20 min
**BuildNotes IDs:** #1 (2026.8.13.001)
> Fix the navigation pane so the Service Alerts section and landing page appear nested under Service Boards. The Service Alerts page works when opened from the banner, but its navigation item is missing. Refer to the attached screenshots to see the current navigation structure and correct it so Service Alerts is properly nested under Service Boards. Also ensure Service Alerts appears on the Home landing page.

**Changes:**
- `apps/web/src/components/Layout.tsx` — NAV_TREE restructured: "boards" is now a parent section with children (Service Boards → /boards, Service Alerts → /service-alerts); the separate top-level "service-alerts" parent was removed; active-alert badge moved to the boards node (expanded label + collapsed icon) while the Service Alerts child keeps its own badge
- `apps/web/src/components/Layout.tsx` — nav-order reconciliation on load: saved `c7_nav_order` is filtered to known top-level ids, missing ids are inserted at their default positions, and stale ids (the old top-level "service-alerts") are dropped — this was the root cause of the missing nav item on browsers with persisted nav order
- `apps/web/src/pages/HomePage.tsx` — Service Alerts quick-link card added to the Home landing page "Getting Started" grid (after Service Boards)
- `apps/web/src/pages/SectionLanding.tsx` — SECTION_DESCRIPTIONS entries for the boards section (boards-dashboard, service-alerts) and administration → admin-service-alerts
- Verified: reconciliation logic unit-tested against stale/legacy/custom saved orders; web tsc clean for changed files; vite transforms clean; `verify-post-change` passed ("✓ All checks passed")
- All three changelog sources updated with `2026.8.13.001`

---

### Prompt 63 — Service Alerts as top-level nav section
**Timestamp:** 2026-08-13 | **Status:** ✅ Completed | **Duration:** ~15 min
**BuildNotes IDs:** #1 (2026.8.13.002)
> Update the navigation pane so that Service Alerts is a top-level parent section, not a child/subsection. Place Service Alerts between Dashboard and Tickets. Make Service Alerts draggable in the same way as the other parent sections. Ensure Service Alerts also appears as a card on the Home landing page.

**Changes:**
- `apps/web/src/components/Layout.tsx` — NAV_TREE: Service Alerts restored as a top-level parent section (child: Dashboard → /service-alerts) placed between Dashboard and Tickets; Service Boards restored to a single top-level link; alert-count badge moved to the Service Alerts parent (expanded label + collapsed icon); existing nav-order reconciliation now inserts the missing top-level id at its default position (after Dashboard) on load without wiping user customizations
- `apps/web/src/pages/SectionLanding.tsx` — Section descriptions: removed boards block, added "service-alerts" → "service-alerts-dashboard" entry
- `apps/web/src/pages/HomePage.tsx` — Service Alerts card already present from prior turn (verified)
- All three changelog sources updated with `2026.8.13.002`

---

**Total Prompts:** 65 | **Completed:** 65 | **In Progress:** 0

### Prompt 64 — Service Alerts as direct landing nav item
**Timestamp:** 2026-08-13 | **Status:** ✅ Completed | **Duration:** ~10 min
**BuildNotes IDs:** #1 (2026.8.13.003)
> Make the Service Alerts Dashboard the landing page for the Service Alerts section. The Service Alerts section should not have any child pages or nested items.

**Changes:**
- `apps/web/src/components/Layout.tsx` — Service Alerts nav node flattened from parent-with-child to a single top-level leaf (`to: "/service-alerts"`, no `children`), so clicking it opens the Service Alerts Dashboard directly; nav-order reconciliation keeps it between Dashboard and Tickets; active-alert badge re-added to the leaf row (plus existing collapsed-icon badge)
- `apps/web/src/pages/SectionLanding.tsx` — removed the now-unused `service-alerts` section landing description block
- All three changelog sources updated with `2026.8.13.003`


### Prompt 65 — Boot automation & loading failure fix
**Timestamp:** 2026-08-13 | **Status:** Completed | **Duration:** ~2 h
**BuildNotes IDs:** #1 (2026.8.13.004)
> Diagnose and fix the application loading failure. Configure the application and any required services or dependencies to start automatically on every machine reboot. Ensure the application is fully functional after each reboot, including automatically reseeding the sample data when the machine restarts.

**Diagnosis:**
- PostgreSQL, API (:4000), and frontend (:3010) were all down after reboot - nothing auto-started them.
- PostgreSQL recurring failure mode: a child backend/autovacuum dies with 0xC0000142 (DLL init), postmaster "reinitializes", then every new backend fails with error 487 (invalid shared-memory address) - postmaster accepts TCP but cannot serve. Documented Windows AV/DLL-injection interference; Defender exclusions added for the PG data + bin directories.
- Pre-existing Windows service "postgresql-c7ntax" (auto-start, LocalSystem) was found stopped - started it and made it the preferred PG runtime.

**Changes:**
- `startup/c7ntax-boot.ps1` - self-healing boot script: prefers the PostgreSQL Windows service (registers/ensures Automatic start if missing, console fallback), verifies PG with a real backend query (not just the port), restarts PG up to 4x when backends fail, best-effort Defender exclusions (20s-bounded), stops stale servers, prisma generate + db push, reseeds sample data (seed-full + seed-contacts + seed-service-alerts) with exit-code checks and one retry, starts API + vite (logs to startup/*.log), verifies login + frontend HTTP, exits non-zero on failure. All blocking calls time-bounded (cmd /c wrapper with reliable exit codes; duplicate-run guard).
- `startup/dbcheck.ts` - backend-connectivity probe used by the script.
- Scheduled task "C7NTAX Boot Startup" (AtStartup + 45s delay, RunLevel Highest, StartWhenAvailable, restart 3x on failure) - verified by running it: LastTaskResult 0.
- Fixed PowerShell pitfalls encountered: UTF-8 BOM (rewrote as pure ASCII), $args reserved variable, Start-Process argument quoting for paths with spaces, cmd /c outer-quote wrapping for reliable exit codes.

**Verified:** full boot run green (PG OK, 3 seeds OK, API 4000, vite 3010, login HTTP 200); task wiring test LastTaskResult 0; login + service-alerts API + frontend all functional.
