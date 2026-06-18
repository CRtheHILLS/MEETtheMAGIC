' MEET the MAGIC - silent launcher (no console window)
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir
' Run the batch launcher hidden (it clears ELECTRON_RUN_AS_NODE and starts Electron).
shell.Run """" & appDir & "\run.bat""", 0, False
