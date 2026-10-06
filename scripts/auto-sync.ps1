# =========================================================================
# C7NTAX Auto-Sync
# Commits working-tree changes and pushes them to origin (main).
# Registered as the scheduled task "C7NTAX Auto-Sync".
#
# Safe / idempotent:
#   - no-ops when there is nothing to commit
#   - skips when a merge/rebase is in progress or the git index is locked
#   - respects .gitignore, so local secrets (e.g. .login-body.json, *.env)
#     are never staged or committed
# The repo's pre-commit hook regenerates the What's New fallbacks and its
# post-commit hook also pushes; this script only adds the missing auto-commit.
# =========================================================================
$ErrorActionPreference = "Continue"

$Repo   = "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX"
$LogDir = "$Repo/startup"
$Log    = "$LogDir/auto-sync.log"
$Branch = "main"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Repo

function Write-SyncLog([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $Log -Value $line
    Write-Host $line
}

# Don't touch the tree while another git process or a merge/rebase is active.
if (Test-Path "$Repo/.git/index.lock") { Write-SyncLog "skip: .git/index.lock present"; exit 0 }
if ((Test-Path "$Repo/.git/MERGE_HEAD") -or (Test-Path "$Repo/.git/rebase-merge") -or (Test-Path "$Repo/.git/rebase-apply")) {
    Write-SyncLog "skip: merge/rebase in progress"; exit 0
}

git add -A *> $null
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-SyncLog "no changes to sync"; exit 0 }

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
git commit -m "auto-sync: $stamp" 2>&1 | ForEach-Object { Write-SyncLog $_ }

$branchNow = (git rev-parse --abbrev-ref HEAD 2>$null)
if ([string]::IsNullOrWhiteSpace($branchNow)) { $branchNow = $Branch }

# cmd /c avoids PowerShell surfacing git's stderr progress as NativeCommandError
$push = (& cmd /c "git push origin $branchNow 2>&1" | Out-String).Trim() -replace "\r?\n", " | "
Write-SyncLog ("push origin {0}: {1}" -f $branchNow, $push)
