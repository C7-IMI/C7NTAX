' C7NTAX Auto-Sync — silent launcher
'
' Runs scripts\auto-sync.ps1 with no console window at all. Windows PowerShell
' binaries are console applications, so launching powershell.exe directly from
' Task Scheduler (even with -WindowStyle Hidden) still flashes a console host.
' wscript.exe is a GUI host: it creates no console, and Shell.Run with a window
' style of 0 starts PowerShell with SW_HIDE, so nothing ever appears on screen.
'
' Registered as the scheduled task "C7NTAX Auto-Sync":
'   wscript.exe //B //Nologo "<repo>\scripts\auto-sync-hidden.vbs"
Option Explicit

Dim fso, shell, repo, script, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' Resolve the repo from this file's location (…\<repo>\scripts\auto-sync-hidden.vbs),
' falling back to the canonical path if the layout ever changes.
repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
script = repo & "\scripts\auto-sync.ps1"

If Not fso.FileExists(script) Then
    repo = "C:\OneDrive\OneDrive - Cyber 7 Group\GHRepo\Kun\C7NTAX"
    script = repo & "\scripts\auto-sync.ps1"
End If

cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """"

' 0 = hidden window, False = don't wait (auto-sync is idempotent and self-limiting)
shell.Run cmd, 0, False
