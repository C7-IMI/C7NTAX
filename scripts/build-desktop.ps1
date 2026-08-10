# C7NTAX Desktop Build Script (Local)
# Usage from project root: powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
#
# Prerequisites: pnpm installed, Node.js >= 20
# The project uses pnpm with hoisted node_modules (.npmrc) to avoid
# long-path issues with electron-builder on Windows.

$ErrorActionPreference = "Stop"
$rootDir = $PSScriptRoot | Split-Path -Parent

Write-Host "=== C7NTAX Desktop Builder ===" -ForegroundColor Cyan

Push-Location $rootDir

try {
    # Build shared
    Write-Host "[1/3] Building shared package..." -ForegroundColor Yellow
    Push-Location packages/shared
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "Shared build failed" }
    Pop-Location

    # Build web
    Write-Host "[2/3] Building web app..." -ForegroundColor Yellow
    Push-Location apps/web
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "Web build failed" }
    Pop-Location

    # Build desktop
    Write-Host "[3/3] Building desktop app..." -ForegroundColor Yellow
    Push-Location apps/desktop
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "Desktop build failed" }
    Pop-Location

    Write-Host ""
    Write-Host "=== BUILD SUCCESSFUL ===" -ForegroundColor Green
    $output = Get-ChildItem -Path "$rootDir\apps\desktop\dist-electron" -Filter "*.exe" -Recurse
    foreach ($f in $output) {
        Write-Host "  Output: $($f.FullName) ($([math]::Round($f.Length / 1MB, 1)) MB)" -ForegroundColor Green
    }
} catch {
    Write-Host "BUILD FAILED: $_" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
