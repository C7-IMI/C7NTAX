# =============================================================================
# Roll back the P1/P2 UI modernization (see UI-P1-ROLLBACK.md).
#
#   -Part     P1 (default), P2, or All
#   -Restart  also restart the web server so the change applies immediately
#   -Enable   re-enable the tier (sets the flag to true) instead of disabling
# =============================================================================
param(
    [ValidateSet("P1", "P2", "All")]
    [string]$Part = "P1",
    [switch]$Restart,
    [switch]$Enable
)

$ErrorActionPreference = "Continue"
$Repo = "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX"
$EnvFile = "$Repo/apps/web/.env.local"
$Value = if ($Enable) { "true" } else { "false" }

$Vars = switch ($Part) {
    "P2" { @("VITE_UI_P2") }
    "All" { @("VITE_UI_P1", "VITE_UI_P2") }
    default { @("VITE_UI_P1") }
}

New-Item -ItemType Directory -Force -Path (Split-Path $EnvFile) | Out-Null

foreach ($name in $Vars) {
    if ((Test-Path $EnvFile) -and (Select-String -Path $EnvFile -Pattern "^$name=" -Quiet)) {
        (Get-Content $EnvFile) -replace "^$name=.*$", "$name=$Value" | Set-Content -Path $EnvFile
    } else {
        Add-Content -Path $EnvFile -Value "$name=$Value"
    }
}

$state = if ($Enable) { "ENABLED" } else { "DISABLED" }
Write-Host "$Part UI modernization $state via apps/web/.env.local ($($Vars -join ', ')=$Value)."

if ($Restart) {
    $listener = Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        Write-Host "Stopping web server (PID $($listener.OwningProcess))..."
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    Write-Host "Restarting the stack (startup/c7ntax-boot.ps1 -SkipSeed)..."
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$Repo/startup/c7ntax-boot.ps1", "-SkipSeed" `
        -WindowStyle Hidden
    Write-Host "Boot task launched — the web app will return on :3010."
} else {
    Write-Host "Restart the web server to apply (or re-run with -Restart)."
}
