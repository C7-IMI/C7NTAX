# =========================================================================
# C7NTAX - Automatic Boot Startup Script (self-healing)
# =========================================================================
# Registered as the scheduled task "C7NTAX Boot Startup" (AtStartup).
# Idempotent: safe to run manually at any time.
#   1. Ensure PostgreSQL is up AND able to serve backends (real query check;
#      restarts PG up to 4 times - Windows shared-memory/AV failures make a
#      listening postmaster unable to spawn backends)
#   2. Best-effort Windows Defender exclusions for the PG data/bin dirs
#      (0xC0000142 / error-487 family is documented AV interference)
#   3. Stop stale API/frontend processes
#   4. Prisma generate + db push
#   5. Reseed sample data (seed-full + contacts + service-alerts) with
#      exit-code checks and one PG-restart retry
#   6. Start API on :4000, start frontend (vite) on :3010
#   7. Verify login + frontend; log everything to startup/boot.log
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

# Real database check: spawns a backend, not just a TCP port probe
function Test-Db {
    Push-Location $ApiDir
    $out = & $Node $NpxCli tsx -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().user.count().then(()=>{console.log('DBOK');process.exit(0)}).catch(()=>process.exit(1))" 2>&1
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -eq 0 -and ("$out" -match "DBOK")) { return $true } else { return $false }
}

function Restart-Pg {
    Write-Step "Restarting PostgreSQL (fast stop + start)..."
    & "$PgBin/pg_ctl.exe" stop -D $PgDataDir -m fast -t 20 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    & "$PgBin/pg_ctl.exe" start -D $PgDataDir -l "$PgDataDir/logfile" -w -t 40 2>&1 | Out-Null
    for ($i = 0; $i -lt 15; $i++) {
        if (Test-Port 5432) { break }
        Start-Sleep -Seconds 2
    }
}

function Run-Seed([string]$scriptName, [string]$outLog) {
    Push-Location $ApiDir
    & $Node $NpxCli tsx "src/$scriptName" *> "$LogDir/$outLog"
    $code = $LASTEXITCODE
    Pop-Location
    return $code
}

# Duplicate-run guard (AtStartup + manual runs can overlap)
if (Test-Path $BootLog) {
    $age = ((Get-Date) - (Get-Item $BootLog).LastWriteTime).TotalMinutes
    if ($age -lt 4) {
        Write-Host "Boot script ran less than 4 minutes ago - skipping duplicate run."
        exit 0
    }
}

Write-Step "=== C7NTAX boot sequence started (self-healing) ==="

# 1. PostgreSQL - up AND serving backends
if (-not (Test-Port 5432)) {
    Write-Step "PostgreSQL down - starting"
    Restart-Pg
}
$dbOk = $false
for ($attempt = 1; $attempt -le 4; $attempt++) {
    if (Test-Db) { $dbOk = $true; break }
    Write-Step "PostgreSQL not serving backends (attempt $attempt) - restarting"
    Restart-Pg
    Start-Sleep -Seconds 3
}
if (-not $dbOk) {
    Write-Step "FATAL: PostgreSQL could not serve backends after 4 attempts"
    exit 1
}
Write-Step "PostgreSQL OK (port 5432 + backend query)"

# 2. Best-effort Defender exclusions (documented fix for 0xC0000142/487)
try {
    $prefs = Get-MpPreference -ErrorAction Stop
    $excl = @($prefs.ExclusionPath)
    if ($excl -notcontains $PgDataDir) {
        Add-MpPreference -ExclusionPath $PgDataDir -ErrorAction Stop
        Write-Step "Defender exclusion added: $PgDataDir"
    }
    if ($excl -notcontains $PgBin) {
        Add-MpPreference -ExclusionPath $PgBin -ErrorAction Stop
        Write-Step "Defender exclusion added: $PgBin"
    }
} catch {
    Write-Step "NOTE: Defender exclusions not changed (no admin rights or Defender unavailable)"
}

# 3. Stop stale servers
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

# 4. Prisma client + schema
Push-Location $ApiDir
& $Node $NpxCli prisma generate 2>&1 | Out-Null
& $Node $NpxCli prisma db push --accept-data-loss 2>&1 | Out-Null
Pop-Location
Write-Step "Prisma client + schema synced"

# 5. Reseed sample data (with exit-code checks + one PG-restart retry)
if (-not $SkipSeed) {
    $seedSteps = @(
        @{ Name = "seed-full";          Out = "seed-full.out.log" },
        @{ Name = "seed-contacts";      Out = "seed-contacts.out.log" },
        @{ Name = "seed-service-alerts"; Out = "seed-service-alerts.out.log" }
    )
    foreach ($step in $seedSteps) {
        $code = Run-Seed $step.Name $step.Out
        if ($code -ne 0) {
            Write-Step "WARNING: $($step.Name).ts exited $code - restarting PG and retrying once"
            Restart-Pg
            Start-Sleep -Seconds 3
            $code = Run-Seed $step.Name $step.Out
            if ($code -ne 0) {
                Write-Step "FATAL: $($step.Name).ts failed twice - see startup/$($step.Out)"
                exit 1
            }
        }
        Write-Step "$($step.Name).ts OK"
    }
    Write-Step "Sample data reseeded"
} else {
    Write-Step "Reseed skipped (-SkipSeed)"
}

# 6. Start API (:4000)
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

# 7. Start frontend (:3010)
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

# 8. End-to-end verification
$allGood = $true
try {
    $r = Invoke-WebRequest -Uri "http://localhost:4000/api/auth/login" -Method POST -ContentType "application/json" -Body '{"email":"admin@C7NTAX.com","password":"admin"}' -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200) { Write-Step "Login check: HTTP 200" } else { Write-Step "CRITICAL: login returned HTTP $($r.StatusCode)"; $allGood = $false }
} catch {
    Write-Step "CRITICAL: login check failed - $($_.Exception.Message)"
    $allGood = $false
}
try {
    $w = Invoke-WebRequest -Uri "http://localhost:3010/" -UseBasicParsing -TimeoutSec 10
    if ($w.StatusCode -eq 200) { Write-Step "Frontend check: HTTP 200" } else { Write-Step "CRITICAL: frontend returned HTTP $($w.StatusCode)"; $allGood = $false }
} catch {
    Write-Step "CRITICAL: frontend check failed - $($_.Exception.Message)"
    $allGood = $false
}

if ($allGood) {
    Write-Step "=== Boot sequence complete - app ready at http://localhost:3010 ==="
} else {
    Write-Step "=== Boot sequence finished WITH ERRORS - review startup/boot.log ==="
}
Write-Step ""
if ($allGood) { exit 0 } else { exit 1 }
