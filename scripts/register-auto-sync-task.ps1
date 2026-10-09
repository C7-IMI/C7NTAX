# =============================================================================
# Register the "C7NTAX Auto-Sync" scheduled task.
#
# Idempotent: re-running it updates the existing task rather than creating a
# second one. Run it after changing auto-sync.ps1's parameters or the interval.
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-auto-sync-task.ps1
#
# Why this lives in the repository at all: the task is what makes the working
# tree reachable from anywhere else, and a task registered once by hand on one
# machine is a piece of infrastructure nobody can read. This is the readable
# version.
#
# -- The trigger: every 5 minutes, and that is not how often it commits -------
#
# The interval is the *poll*, not the commit. `auto-sync.ps1` refuses to commit
# while a non-snapshot file has been written in the last four minutes, so the
# effect is a commit roughly 4-9 minutes after work stops - never during it. The
# short interval is deliberate: it is what makes the wait after finishing short.
# Before 2026-10-09 the interval was 15 minutes with no quiet test, which meant a
# change could be committed halfway through being written.
#
# The script runs through scripts\run-hidden.vbs because a scheduled task whose
# action is powershell.exe flashes a console window at every run.
# =============================================================================
param(
    [string]$Repo = "C:\OneDrive\OneDrive - Cyber 7 Group\GHRepo\Kun\C7NTAX",
    [int]$IntervalMinutes = 5,
    [string]$TaskName = "C7NTAX Auto-Sync"
)

$ErrorActionPreference = "Stop"
$LogFile = "$Repo\startup\auto-sync-task-update.log"

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}

$runner = "$Repo\scripts\run-hidden.vbs"
$script = "$Repo\scripts\auto-sync.ps1"
foreach ($path in @($runner, $script)) {
    if (-not (Test-Path $path)) { Write-Log "FAILED: missing $path"; exit 1 }
}

$action = New-ScheduledTaskAction -Execute "wscript.exe" `
    -Argument "//B //Nologo `"$runner`" `"$script`"" `
    -WorkingDirectory $Repo

# A repetition pattern needs a start boundary that is in the past; the current
# time works and keeps the phase from drifting to an odd hour.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(-1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$principal = if ($existing) { $existing.Principal } else { New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited }
$settings = if ($existing) { $existing.Settings } else { New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) }
# Powershell 5.1 has no -ExecutionTimeLimit on New-ScheduledTaskSettingsSet in every build; set it on the object as well.
$settings.ExecutionTimeLimit = "PT10M"
$settings.MultipleInstances = "IgnoreNew"
$settings.StartWhenAvailable = $true

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

$now = Get-ScheduledTask -TaskName $TaskName
Write-Log "registered: $($now.Actions.Execute) $($now.Actions.Arguments)"
Write-Log "trigger: every $IntervalMinutes minute(s) - state $($now.State) - run level $($now.Principal.RunLevel)"
Write-Log "note: the task polls every $IntervalMinutes min; auto-sync.ps1 commits only after 4 minutes of no edits to non-snapshot files"
