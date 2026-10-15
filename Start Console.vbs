Option Explicit
Dim consoleShell, consoleFiles, consoleRoot, consoleCommand, consoleCmd, consoleExit
Set consoleShell = CreateObject("WScript.Shell")
Set consoleFiles = CreateObject("Scripting.FileSystemObject")
consoleRoot = consoleFiles.GetParentFolderName(WScript.ScriptFullName)
consoleShell.CurrentDirectory = consoleRoot
consoleCmd = consoleShell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\cmd.exe"
If Not consoleFiles.FileExists(consoleCmd) Then WScript.Quit 2
If WScript.Arguments.Count <> 0 Then
    WScript.Echo "Use Start Console.cmd for --preflight or --blank."
    WScript.Quit 1
End If
consoleCommand = Chr(34) & consoleCmd & Chr(34) & " /d /s /c " & Chr(34) & Chr(34) & consoleRoot & "\Start Console.cmd" & Chr(34) & Chr(34)
' Compatibility alias: show the same console diagnostics as the main launcher.
consoleExit = consoleShell.Run(consoleCommand, 1, True)
WScript.Quit consoleExit
