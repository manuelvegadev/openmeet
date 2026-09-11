@echo off
rem The Go client on the Windows rig: the Roland as devices, the server on the Mac.
rem   openmeet-go.cmd <room> [ws://mac-ip:3001/ws]
rem Copy this next to openmeet-windows-amd64.exe (C:\Users\mvega\openmeet-go\).
set ROOM=%1
if "%ROOM%"=="" set ROOM=standup
set SERVER=%2
if "%SERVER%"=="" set SERVER=ws://192.168.68.61:3001/ws
"%~dp0openmeet-windows-amd64.exe" --server %SERVER% --room %ROOM% --input-device "MIC (BRIDGE CAST" --output-device "Speakers (BRIDGE CAST" %3 %4 %5
