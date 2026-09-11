@echo off
rem The Go client on the Windows rig, in a Windows Terminal window: the Roland as devices,
rem the server on the Mac. Asks for the room when the shortcut gave none.
rem   openmeet-go.cmd [room] [ws://mac-ip:3001/ws]
rem Lives next to openmeet.exe (C:\Users\mvega\openmeet-go\).
title OpenMeet (go)
set ROOM=%1
if "%ROOM%"=="" set /p ROOM=Room [standup]: 
if "%ROOM%"=="" set ROOM=standup
set SERVER=%2
if "%SERVER%"=="" set SERVER=%OPENMEET_SERVER%
if "%SERVER%"=="" set SERVER=ws://192.168.68.61:3001/ws
"%~dp0openmeet.exe" --server %SERVER% --room %ROOM% --input-device "MIC (BRIDGE CAST" --output-device "Speakers (BRIDGE CAST" %3 %4 %5
if errorlevel 1 pause
