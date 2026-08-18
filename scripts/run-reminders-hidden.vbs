Option Explicit

If WScript.Arguments.Count <> 4 Then WScript.Quit 2

Function Quote(Value)
    Quote = Chr(34) & Replace(Value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

Dim Shell, NodePath, EntryPath, SyncScriptPath, ProjectRoot, RunCode, SyncCode
Set Shell = CreateObject("WScript.Shell")
NodePath = WScript.Arguments(0)
EntryPath = WScript.Arguments(1)
SyncScriptPath = WScript.Arguments(2)
ProjectRoot = WScript.Arguments(3)
Shell.CurrentDirectory = ProjectRoot

RunCode = Shell.Run(Quote(NodePath) & " " & Quote(EntryPath) & " --run-due", 0, True)
SyncCode = Shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(SyncScriptPath) & " -ProjectRoot " & Quote(ProjectRoot), 0, True)

If RunCode <> 0 Then WScript.Quit RunCode
WScript.Quit SyncCode
