# =============================================================================
# Roll back the P1 UI modernization (see UI-P1-ROLLBACK.md).
#
#   -Restart  also restart the web server so the change applies immediately
#   -Enable   re-enable P1 (removes the flag) instead of disabling it
# =============================================================================
param(
    [switch]$Restart,
    [switch]$Enable
)

$ErrorActionPreference = "Continue"
$Repo = "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX"
$EnvFile = "$Repo/apps/web/.env.local"
$Value = if ($Enable) { "true" } else { "false" }

New-Item -ItemType Directory -Force -Path (Split-Path $EnvFile) | Out-Null

if ((Test-Path $EnvFile) -and (Select-String -Path $EnvFile -Pattern '^VITE_UI_P1=' -Quiet)) {
    (Get-Content $EnvFile) -replace '^VITE_UI_P1=.*$', "VITE_UI_P1=$Value" | Set-Content -Path $EnvFile
} else {
    Add-Content -Path $EnvFile -Value "VITE_UI_P1=$Value"
}

$state = if ($Enable) { "ENABLED" } else { "DISABLED" }
Write-Host "P1 UI modernization $state via apps/web/.env.local (VITE_UI_P1=$Value)."

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
