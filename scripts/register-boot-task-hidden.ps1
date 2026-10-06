# =============================================================================
# Re-register "C7NTAX Boot Startup" so it launches through scripts\run-hidden.vbs
# instead of powershell.exe, which flashes a console window at every boot.
#
# MUST run from an ELEVATED PowerShell: the task runs at RunLevel Highest, so
# modifying it is denied to a standard token (Register-ScheduledTask,
# Set-ScheduledTask and schtasks /Change all fail with "Access is denied").
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-boot-task-hidden.ps1
# =============================================================================
param(
    [string]$Repo = "C:\OneDrive\OneDrive - Cyber 7 Group\GHRepo\Kun\C7NTAX"
)

$ErrorActionPreference = "Stop"
$TaskName = "C7NTAX Boot Startup"
$LogFile = "$Repo\startup\boot-task-update.log"

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Log "FAILED: not elevated - run this from an elevated PowerShell"
    exit 1
}

$runner = "$Repo\scripts\run-hidden.vbs"
$bootScript = "$Repo\startup\c7ntax-boot.ps1"

if (-not (Test-Path $runner)) { Write-Log "FAILED: missing $runner"; exit 1 }
if (-not (Test-Path $bootScript)) { Write-Log "FAILED: missing $bootScript"; exit 1 }

$task = Get-ScheduledTask -TaskName $TaskName
$action = New-ScheduledTaskAction -Execute "wscript.exe" `
    -Argument "//B //Nologo `"$runner`" `"$bootScript`"" `
    -WorkingDirectory $Repo

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $task.Triggers `
    -Settings $task.Settings -Principal $task.Principal -Force | Out-Null

$now = Get-ScheduledTask -TaskName $TaskName
Write-Log "registered: $($now.Actions.Execute) $($now.Actions.Arguments)"
Write-Log "run level $($now.Principal.RunLevel), trigger $($now.Triggers[0].CimClass.CimClassName), limit $($now.Settings.ExecutionTimeLimit)"
