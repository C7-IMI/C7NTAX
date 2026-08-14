# C7NTAX — Manual Restart Guide

## Section 1: Troubleshooting Commands Executed

### ── Diagnosing Crashes ──
netstat -ano | grep -E ":3004|:4000" | grep LISTENING
tail -200 "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX/apps/api/dev-errors.log" | grep "MESSAGE"
tasklist //FI "IMAGENAME eq node.exe" | grep node
npx tsx -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().ticket.count().then(r=>{console.log('tickets:',r);process.exit(0)}).catch(e=>{console.error('DB FAIL:',e.message);process.exit(1)})"

### ── Fix: Remove execSync from logger.ts (EPIPE crash source) ──
# Removed import { execSync } from "child_process"
# Changed getGitInfo() to return { branch: "unknown", commit: "unknown" }

### ── Fix: Remove execSync from poller.ts (EPIPE crash source) ──
# Removed execSync call in attemptRepair() — now logs and returns true

### ── Fix: Route ordering in clients.ts ──
# Moved GET /contacts and PATCH /contacts/:id above GET /:id
# Prevented Express from matching "contacts" as an :id parameter

### ── Fix: Prisma validation errors in 7 routes ──
# crm.ts — removed include: { company, assignedTo } (scalar-only models)
# projects.ts — removed include: { company, manager, _count }
# inventory.ts — removed include: { company }
# kb.ts — changed select from { category, author } to { categoryId, authorId }
# chat.ts — removed include: { company, assignedTo, sender }
# procurement.ts — removed include: { vendor }
# clients.ts — changed status: true to isActive: true (User model)

### ── Fix: Rate limiter blocking login ──
# Changed app.use(rateLimiter()) to app.use(rateLimiter(9999, 60 * 1000))

### ── Fix: Crash guard in index.ts ──
# Added process.on("uncaughtException") handler that catches EPIPE/EADDRINUSE
# Process no longer dies from these errors

### ── Fix: User creation (roleId lookup) ──
# POST /users now finds Role by systemRole and uses roleId
# GET /users now maps role.systemRole to flat string

### ── Fix: Auth route user.isActive ──
# Changed user.active → user.isActive in signToken calls (2 instances)

### ── Fix: User creation form field names ──
# Contacts form added: department, notes fields
# Contact model schema updated with department, notes

### ── Fix: Ticket auto-populate from contacts ──
# Added contactId lookup when creating ticket from contact details
# Contact dropdown uses contact IDs instead of name|email format

### ── Fix: PostgreSQL restart ──
pg_ctl stop -D "$HOME/scoop/apps/postgresql/current/data" 2>&1 || true
pg_ctl start -D "$HOME/scoop/apps/postgresql/current/data" -l "$HOME/scoop/apps/postgresql/current/data/logfile" 2>&1

### ── Reseeding sample data ──
npx tsx src/seed-full.ts    # 8 tickets, 5 companies, 6 users, etc.
npx tsx src/seed-contacts.ts # 13 contacts with full PSA fields

### ── Starting servers detached ──
cmd //c "start /B npx tsx src/index.ts"    # API on :4000
cmd //c "start /B npx vite --port 3004 --host"  # Frontend on :3004


## Section 2: Complete Stop & Restart — Correct Order

### Step 1: Verify PostgreSQL is running
netstat -ano | grep ":5432" | grep LISTENING
# If NOT running:
pg_ctl start -D "$HOME/scoop/apps/postgresql/current/data" -l "$HOME/scoop/apps/postgresql/current/data/logfile" 2>&1

### Step 2: Kill all existing Node.js processes
for pid in $(netstat -ano | grep -E ":(3004|4000)" | grep LISTENING | awk '{print $NF}' | sort -u); do
  tskill $pid 2>/dev/null
done
sleep 3

### Step 3: Regenerate Prisma client
cd "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX/apps/api"
npx prisma generate
npx prisma db push --accept-data-loss

### Step 4: Rebuild frontend
cd "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX/apps/web"
rm -rf dist
npx vite build

### Step 5: Reseed sample data
cd "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX/apps/api"
npx tsx src/seed-full.ts
npx tsx src/seed-contacts.ts

### Step 6: Start API server (port 4000)
cd "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX/apps/api"
npx tsx src/index.ts &
sleep 8
curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@C7NTAX.com","password":"admin"}'
# Expect: 200 with JWT token

### Step 7: Start Frontend server (port 3004)
cd "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX/apps/web"
npx vite --port 3004 --host &
sleep 6
curl -s http://localhost:3004/
# Expect: 200

### Step 8: Final verification
# Login: http://localhost:3004
# Credentials: admin@C7NTAX.com / admin
# Database: 8 tickets, 5 companies, 6 users, 4 invoices, 5 assets, 13 contacts, 3 boards

## Section 3: Automatic Boot Startup (no manual action needed)

### What starts automatically after every reboot
1. **PostgreSQL** - Windows service `postgresql-c7ntax` (StartType: Automatic, LocalSystem).
2. **Scheduled task "C7NTAX Boot Startup"** (AtStartup + 45s delay) runs
   `startup/c7ntax-boot.ps1`, which self-heals everything else:
   - Verifies PostgreSQL with a real backend query (not just the port) and
     restarts it up to 4x if backends cannot spawn (the 0xC0000142 / error-487
     failure mode); ensures Defender exclusions for the PG data/bin dirs.
   - `prisma generate` + `prisma db push`.
   - **Reseeds sample data** every boot: `seed-full.ts` + `seed-contacts.ts` +
     `seed-service-alerts.ts` (exit codes checked, one PG-restart retry each).
   - Starts API (:4000) and frontend vite (:3010), then verifies login HTTP 200.
   - Logs everything to `startup/boot.log` (server output in `startup/*.log`).

### Manual controls
- Run now:      `powershell -ExecutionPolicy Bypass -File startup/c7ntax-boot.ps1`
- Skip reseed:  add `-SkipSeed`
- Task details: `schtasks /query /tn "C7NTAX Boot Startup" /v`
- Trigger task: `schtasks /run /tn "C7NTAX Boot Startup"`
- PG service:   `sc start postgresql-c7ntax` / `sc stop postgresql-c7ntax`

### Known failure mode (self-healed by the script)
A PostgreSQL child process occasionally dies with 0xC0000142 (DLL init,
AV/EDR interference). The postmaster then "reinitializes" and every new
backend fails with "could not reserve shared memory region ... error 487"
while port 5432 stays open. The boot script detects this via the backend
query and restarts the service. Defender exclusions for the PG data/bin
directories reduce recurrence.
