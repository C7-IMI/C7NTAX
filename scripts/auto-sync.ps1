# =========================================================================
# C7NTAX Auto-Sync
# Commits working-tree changes and pushes them to origin (main).
# Registered as the scheduled task "C7NTAX Auto-Sync", which invokes it through
# scripts/run-hidden.vbs so no console window is ever shown (a direct
# powershell.exe task action always flashes a console host).
#
# Safe / idempotent:
#   - no-ops when there is nothing to commit
#   - skips when a merge/rebase is in progress or the git index is locked
#   - respects .gitignore, so local secrets (e.g. .login-body.json, *.env)
#     are never staged or committed
# The repo's pre-commit hook regenerates the What's New fallbacks and its
# post-commit hook also pushes; this script only adds the missing auto-commit.
#
# -- It waits for a quiet tree before it commits (2026-10-09) -------------
#
# It used to fire on a timer and `git add -A` whatever it found, which meant it
# could - and did - commit a change that was halfway written, splitting one
# change across two commits with an "auto-sync: <timestamp>" message between
# them. A timer cannot know whether anybody is still typing, so this one asks the
# filesystem instead: if a file that is not the snapshot poller's output has been
# written within the last $QuietMinutes, it comes back next time.
#
# The snapshot poller is why that exclusion exists. It rewrites
# apps/api/src/snapshots/* every few minutes by design, so counting that as
# "somebody is working" would block the sync forever while counting it as "the
# tree has settled" would commit a half-finished file. It is ignored for the
# quiet test and still committed when the tree really does settle.
#
# -- Holding it off deliberately -----------------------------------------
#
# A marker file stops the sync entirely, for a sequence of changes that must land
# as one commit and cannot be interrupted:
#
#   New-Item -ItemType File .git/AUTO_SYNC_HOLD    # hold
#   Remove-Item .git/AUTO_SYNC_HOLD                # release
#
# It lives in .git/, so it can never be committed and never shows in a status.
# A stale hold is not dangerous - nothing is lost, the changes simply stay
# uncommitted until it is removed - so the marker deliberately does not expire:
# a guard that silently gives up is worse than one that waits.
# =========================================================================
param(
    # How long the tree must have been still before this commits. Longer than the
    # gap between two edits of the same file, shorter than anybody's patience for
    # a push.
    [int]$QuietMinutes = 4
)
$ErrorActionPreference = "Continue"

$Repo   = "C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX"
$LogDir = "$Repo/startup"
$Log    = "$LogDir/auto-sync.log"
$Branch = "main"
$HoldMarker = "$Repo/.git/AUTO_SYNC_HOLD"

# Paths whose churn means "a poller is running", not "a person is editing".
$NoisyPathPatterns = @(
    'apps/api/src/snapshots/'
)

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Repo

function Write-SyncLog([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $Log -Value $line
    Write-Host $line
}

if (Test-Path $HoldMarker) {
    Write-SyncLog "skip: held off by .git/AUTO_SYNC_HOLD (remove it to resume)"
    exit 0
}

# Don't touch the tree while another git process or a merge/rebase is active.
if (Test-Path "$Repo/.git/index.lock") { Write-SyncLog "skip: .git/index.lock present"; exit 0 }
if ((Test-Path "$Repo/.git/MERGE_HEAD") -or (Test-Path "$Repo/.git/rebase-merge") -or (Test-Path "$Repo/.git/rebase-apply")) {
    Write-SyncLog "skip: merge/rebase in progress"; exit 0
}

# -- Is anybody still working? -------------------------------------------
# `git status --porcelain` is asked first because it is cheap and answers the more
# common question ("is there anything at all?"); the clock is only consulted when
# there is. Ignored files (logs, .env) never appear here, so a log being written
# every second cannot hold the sync off.
$statusLines = @(git status --porcelain 2>$null)
if ($statusLines.Count -eq 0) { Write-SyncLog "no changes to sync"; exit 0 }

$cutoff = (Get-Date).AddMinutes(-$QuietMinutes)
$busy = @()
foreach ($line in $statusLines) {
    $path = $line.Substring(3).Trim().Trim('"')
    # Renames read "old -> new"; the new path is the one that exists.
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
    $normalised = $path -replace '\\', '/'
    if ($NoisyPathPatterns | Where-Object { $normalised.StartsWith($_) }) { continue }
    $full = Join-Path $Repo $path
    if (-not (Test-Path $full)) { continue }   # a deletion carries no timestamp of its own
    $item = Get-Item -LiteralPath $full -ErrorAction SilentlyContinue
    if ($item -and $item.LastWriteTime -gt $cutoff) { $busy += "$path ($($item.LastWriteTime.ToString('HH:mm:ss')))" }
}
if ($busy.Count -gt 0) {
    Write-SyncLog ("skip: {0} file(s) written within {1}m, still working - {2}" -f $busy.Count, $QuietMinutes, (($busy | Select-Object -First 5) -join "; "))
    exit 0
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
