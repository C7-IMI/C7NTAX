# Backlog item 11 — optional CI security scanners (skip silently when tools are absent).
# Runs gitleaks (secret scanning) and trivy (CVE scanning) if available on PATH.
# Non-blocking: absence of tools is not an error. Gate: AUTH_HARDENING_ENABLED.
param()
if ($env:AUTH_HARDENING_ENABLED -ne "true") { exit 0 }

$ran = $false
$gitleaks = Get-Command gitleaks -ErrorAction SilentlyContinue
if ($gitleaks) {
  & gitleaks detect --no-git --source .. --report-path gitleaks-report.json *> $null
  if ($LASTEXITCODE -eq 1) { Write-Host "[scanners] gitleaks: secrets found (see gitleaks-report.json)" }
  else { Write-Host "[scanners] gitleaks: clean" }
  $ran = $true
}
$trivy = Get-Command trivy -ErrorAction SilentlyContinue
if ($trivy) {
  & trivy fs --scanners vuln,secret --severity HIGH,CRITICAL --quiet .. *> $null
  Write-Host "[scanners] trivy: completed"
  $ran = $true
}
if (-not $ran) { Write-Host "[scanners] gitleaks/trivy not installed - skipping (install to enable)" }
exit 0
