# =========================================================================
# C7NTAX - Automatic Boot Startup Script
# =========================================================================
# Registered as the scheduled task "C7NTAX Boot Startup" (AtStartup).
# Idempotent: safe to run manually at any time.
#   1. Start PostgreSQL (scoop install) if down
#   2. Stop any stale API/frontend processes
#   3. Regenerate Prisma client + push schema
#   4. Reseed sample data (seed-full + contacts + service-alerts)
#   5. Start API on :4000 and verify
#   6. Start frontend (vite) on :3010 and verify
#   7. Log everything to startup/boot.log
# =========================================================================

param([switch]$SkipSeed)

$ErrorActionPreference = "Continue"

$ProjectRoot = "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX"
$ApiDir      = "$ProjectRoot/apps/api"
$WebDir      = "$ProjectRoot/apps/web"
$LogDir      = "$ProjectRoot/startup"
$BootLog     = "$LogDir/boot.log"
$PgBin       = "$env:USERPROFILE/scoop/apps/postgresql/current/bin"
$PgDataDir   = "$env:USERPROFILE/scoop/apps/postgresql/current/data"
$Node        = "C:/Program Files/nodejs/node.exe"
$NpxCli      = "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js"

# Task Scheduler starts with a minimal PATH - enrich it
$env:PATH = "$PgBin;C:/Program Files/nodejs;$env:USERPROFILE/scoop/shims;$env:PATH"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Step([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $BootLog -Value $line
}

function Test-Port([int]$port) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($null -ne $c) { return $true } else { return $false }
}

# Duplicate-run guard (AtStartup + manual runs can overlap)
if (Test-Path $BootLog) {
    $age = ((Get-Date) - (Get-Item $BootLog).LastWriteTime).TotalMinutes
    if ($age -lt 4) {
        Write-Host "Boot script ran less than 4 minutes ago - skipping duplicate run."
        exit 0
    }
}

Write-Step "=== C7NTAX boot sequence started ==="

# 1. PostgreSQL
if (Test-Port 5432) {
    Write-Step "PostgreSQL already running"
} else {
    Write-Step "PostgreSQL down - starting"
    & "$PgBin/pg_ctl.exe" start -D $PgDataDir -l "$PgDataDir/logfile" -w -t 30 2>&1 | Out-Null
}
$pgUp = $false
for ($i = 0; $i -lt 12; $i++) {
    if (Test-Port 5432) { $pgUp = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $pgUp) { Write-Step "FATAL: PostgreSQL did not come up on 5432"; exit 1 }
Write-Step "PostgreSQL OK (port 5432)"

# 2. Stop stale servers
foreach ($port in 4000, 3010) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($p in $pids) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            Write-Step "Stopped stale server on port $port (PID $p)"
        }
        Start-Sleep -Seconds 2
    }
}

# 3. Prisma client + schema
Push-Location $ApiDir
& $Node $NpxCli prisma generate 2>&1 | Out-Null
& $Node $NpxCli prisma db push --accept-data-loss 2>&1 | Out-Null
Pop-Location
Write-Step "Prisma client + schema synced"

# 4. Reseed sample data
if (-not $SkipSeed) {
    Push-Location $ApiDir
    & $Node $NpxCli tsx src/seed-full.ts 2>&1 | Out-Null
    Write-Step "seed-full.ts finished"
    & $Node $NpxCli tsx src/seed-contacts.ts 2>&1 | Out-Null
    Write-Step "seed-contacts.ts finished"
    & $Node $NpxCli tsx src/seed-service-alerts.ts 2>&1 | Out-Null
    Write-Step "seed-service-alerts.ts finished"
    Pop-Location
    Write-Step "Sample data reseeded"
} else {
    Write-Step "Reseed skipped (-SkipSeed)"
}

# 5. Start API (:4000)
if (Test-Port 4000) {
    Write-Step "API already running"
} else {
    $api = Start-Process -FilePath $Node -ArgumentList "`"$NpxCli`"", "tsx", "src/index.ts" -WorkingDirectory $ApiDir -WindowStyle Hidden -RedirectStandardOutput "$LogDir/api.out.log" -RedirectStandardError "$LogDir/api.err.log" -PassThru
    Write-Step "API starting (PID $($api.Id))"
}
$apiUp = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Test-Port 4000) { $apiUp = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $apiUp) { Write-Step "FATAL: API did not come up on 4000 - see startup/api.err.log"; exit 1 }
Write-Step "API OK (port 4000)"

# 6. Start frontend (:3010)
if (Test-Port 3010) {
    Write-Step "Frontend already running"
} else {
    $web = Start-Process -FilePath $Node -ArgumentList "`"$NpxCli`"", "vite", "--port", "3010", "--host" -WorkingDirectory $WebDir -WindowStyle Hidden -RedirectStandardOutput "$LogDir/web.out.log" -RedirectStandardError "$LogDir/web.err.log" -PassThru
    Write-Step "Frontend starting (PID $($web.Id))"
}
$webUp = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Test-Port 3010) { $webUp = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $webUp) { Write-Step "FATAL: Frontend did not come up on 3010 - see startup/web.err.log"; exit 1 }
Write-Step "Frontend OK (port 3010)"

# 7. End-to-end login verification
try {
    $r = Invoke-WebRequest -Uri "http://localhost:4000/api/auth/login" -Method POST -ContentType "application/json" -Body '{"email":"admin@C7NTAX.com","password":"admin"}' -UseBasicParsing -TimeoutSec 10
    Write-Step "Login check: HTTP $($r.StatusCode)"
} catch {
    Write-Step "WARNING: login check failed - $($_.Exception.Message)"
}

Write-Step "=== Boot sequence complete - app ready at http://localhost:3010 ==="
Write-Step ""
exit 0
