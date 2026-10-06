' C7NTAX — run a PowerShell script with no console window
'
'   wscript.exe //B //Nologo "<repo>\scripts\run-hidden.vbs" <script.ps1> [args...]
'
' Windows PowerShell is a console application, so launching it directly from
' Task Scheduler flashes a console window: the console is created visible and
' -WindowStyle Hidden only hides it a moment later. wscript.exe is a GUI host
' that creates no console at all, and Shell.Run with a window style of 0 starts
' PowerShell with SW_HIDE, so its console is created hidden and never shown.
'
' Used by the scheduled tasks "C7NTAX Boot Startup" and "C7NTAX Auto-Sync".
Option Explicit

Const SW_HIDE = 0
Const ForAppending = 8

Dim fso, shell, repo, script, extra, i, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

If WScript.Arguments.Count = 0 Then
    LogLine "no target script supplied"
    WScript.Quit 1
End If

script = WScript.Arguments(0)
If Not fso.FileExists(script) Then
    LogLine "target script not found: " & script
    WScript.Quit 1
End If

extra = ""
For i = 1 To WScript.Arguments.Count - 1
    extra = extra & " " & Quote(WScript.Arguments(i))
Next

cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(script) & extra
shell.Run cmd, SW_HIDE, False

Function Quote(value)
    Quote = """" & value & """"
End Function

Sub LogLine(message)
    On Error Resume Next
    Dim stream
    Set stream = fso.OpenTextFile(repo & "\startup\hidden-runner.log", ForAppending, True)
    stream.WriteLine "[" & Now & "] " & message
    stream.Close
End Sub
