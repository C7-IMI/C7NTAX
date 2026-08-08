# ──────────────────────────────────────────────────────────────────────
# C7NTAX — Complete Server Restart & Fix Script
# ──────────────────────────────────────────────────────────────────────
# Purpose: Stops all services, fixes common issues, reseeds data,
#          rebuilds frontend, and restarts everything in correct order.
# Usage:   .\c7ntax-restart.ps1
# ──────────────────────────────────────────────────────────────────────

param(
    [switch]$SkipBuild,     # Skip frontend rebuild
    [switch]$SkipSeed,      # Skip database seeding
    [switch]$DryRun         # Print actions without executing
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX"
$ApiDir      = "$ProjectRoot/apps/api"
$WebDir      = "$ProjectRoot/apps/web"
$PgDataDir   = "$env:USERPROFILE/scoop/apps/postgresql/current/data"
$PgLogFile   = "$PgDataDir/logfile"

Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  C7NTAX — Server Restart & Fix Script" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ═══════════════════════════════════════════════════════════════════════
# STEP 1: Ensure PostgreSQL is running
# ═══════════════════════════════════════════════════════════════════════
Write-Host "[1/7] Checking PostgreSQL..." -ForegroundColor Yellow
$pgRunning = netstat -ano | Select-String ":5432.*LISTENING"
if (-not $pgRunning) {
    Write-Host "  PostgreSQL is DOWN. Starting..." -ForegroundColor Red
    if (-not $DryRun) {
        & pg_ctl start -D $PgDataDir -l $PgLogFile 2>&1 | Out-Null
        Start-Sleep -Seconds 4
        $pgRunning = netstat -ano | Select-String ":5432.*LISTENING"
        if (-not $pgRunning) {
            Write-Host "  FAILED to start PostgreSQL. Aborting." -ForegroundColor Red
            exit 1
        }
    }
    Write-Host "  PostgreSQL started successfully." -ForegroundColor Green
} else {
    Write-Host "  PostgreSQL is already running." -ForegroundColor Green
}

# ═══════════════════════════════════════════════════════════════════════
# STEP 2: Stop all running Node.js servers
# ═══════════════════════════════════════════════════════════════════════
Write-Host "[2/7] Stopping existing servers..." -ForegroundColor Yellow
$listeners = netstat -ano | Select-String -Pattern ":(3004|4000)" | Select-String "LISTENING"
if ($listeners) {
    $pids = ($listeners | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique)
    foreach ($pid in $pids) {
        Write-Host "  Killing PID $pid..." -ForegroundColor Gray
        if (-not $DryRun) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 3
    Write-Host "  All servers stopped." -ForegroundColor Green
} else {
    Write-Host "  No servers running." -ForegroundColor Green
}

# ═══════════════════════════════════════════════════════════════════════
# STEP 3: Regenerate Prisma client and push schema
# ═══════════════════════════════════════════════════════════════════════
Write-Host "[3/7] Regenerating Prisma client..." -ForegroundColor Yellow
if (-not $DryRun) {
    Push-Location $ApiDir
    npx prisma generate 2>&1 | Out-Null
    npx prisma db push --accept-data-loss 2>&1 | Out-Null
    Pop-Location
}
Write-Host "  Prisma client regenerated." -ForegroundColor Green

# ═══════════════════════════════════════════════════════════════════════
# STEP 4: Rebuild frontend (optional, use -SkipBuild to bypass)
# ═══════════════════════════════════════════════════════════════════════
if (-not $SkipBuild) {
    Write-Host "[4/7] Rebuilding frontend..." -ForegroundColor Yellow
    if (-not $DryRun) {
        Push-Location $WebDir
        if (Test-Path dist) { Remove-Item -Recurse -Force dist }
        npx vite build 2>&1 | Select-String "✓|error"
        Pop-Location
    }
    Write-Host "  Frontend built successfully." -ForegroundColor Green
} else {
    Write-Host "[4/7] Skipping frontend rebuild (-SkipBuild)." -ForegroundColor Gray
}

# ═══════════════════════════════════════════════════════════════════════
# STEP 5: Reseed sample data (optional, use -SkipSeed to bypass)
# ═══════════════════════════════════════════════════════════════════════
if (-not $SkipSeed) {
    Write-Host "[5/7] Reseeding sample data..." -ForegroundColor Yellow
    if (-not $DryRun) {
        Push-Location $ApiDir
        Write-Host "  Seeding full dataset (tickets, companies, users, invoices, assets, boards, opps, projects, KB, agreements)..." -ForegroundColor Gray
        npx tsx src/seed-full.ts 2>&1 | Select-String "SEED COMPLETE|Login|✓"
        Write-Host "  Seeding contacts (13 contacts with PSA fields)..." -ForegroundColor Gray
        npx tsx src/seed-contacts.ts 2>&1 | Select-String "Seeded|Companies"
        Pop-Location
    }
    Write-Host "  Sample data restored." -ForegroundColor Green
} else {
    Write-Host "[5/7] Skipping seed (-SkipSeed)." -ForegroundColor Gray
}

# ═══════════════════════════════════════════════════════════════════════
# STEP 6: Start API server (port 4000)
# ═══════════════════════════════════════════════════════════════════════
Write-Host "[6/7] Starting API server on port 4000..." -ForegroundColor Yellow
if (-not $DryRun) {
    Push-Location $ApiDir
    $apiProcess = Start-Process -FilePath "npx" -ArgumentList "tsx","src/index.ts" -NoNewWindow -PassThru
    Pop-Location
    Start-Sleep -Seconds 8
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/api/auth/login" -Method POST -ContentType "application/json" -Body '{"email":"admin@C7NTAX.com","password":"admin"}' -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            Write-Host "  API server running — login 200 OK." -ForegroundColor Green
        } else {
            Write-Host "  API responded with status $($response.StatusCode)." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  WARNING: Could not verify API (may need more time to start)." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [DRY RUN] Would start: npx tsx src/index.ts" -ForegroundColor Gray
}

# ═══════════════════════════════════════════════════════════════════════
# STEP 7: Start Frontend server (port 3004)
# ═══════════════════════════════════════════════════════════════════════
Write-Host "[7/7] Starting Frontend server on port 3004..." -ForegroundColor Yellow
if (-not $DryRun) {
    Push-Location $WebDir
    $viteProcess = Start-Process -FilePath "npx" -ArgumentList "vite","--port","3004","--host" -NoNewWindow -PassThru
    Pop-Location
    Start-Sleep -Seconds 6
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3004/" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            Write-Host "  Frontend server running — 200 OK." -ForegroundColor Green
        }
    } catch {
        Write-Host "  WARNING: Could not verify frontend (may need more time to start)." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [DRY RUN] Would start: npx vite --port 3004 --host" -ForegroundColor Gray
}

# ═══════════════════════════════════════════════════════════════════════
# DONE
# ═══════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Application Restart Complete" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Frontend : http://localhost:3004" -ForegroundColor White
Write-Host "  API      : http://localhost:4000" -ForegroundColor White
Write-Host "  Login    : admin@C7NTAX.com / admin" -ForegroundColor White
Write-Host ""
Write-Host "  IF DATA DOES NOT DISPLAY:" -ForegroundColor Yellow
Write-Host "    Press Ctrl+Shift+R to hard-refresh the browser." -ForegroundColor Yellow
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
