@echo off
rem The Go client on the Windows rig, in a Windows Terminal window. The devices are the
rem app's own — settings, or the picker. Forcing them here had this machine capturing the
rem interface's raw MIC bus while the Mac captured its STREAM bus: the same microphone,
rem through different processing, which is exactly what "it sounds worse here" was.
rem The server is the public one unless OPENMEET_SERVER or the 2nd argument says otherwise
rem (the Mac's own is ws://<mac-ip>:3001/ws). Asks for the room when the shortcut gave none.
rem   openmeet-go.cmd [room] [server] [extra flags, e.g. --input-device "MIC (BRIDGE CAST"]
rem Lives next to openmeet.exe (C:\Users\mvega\openmeet-go\).
title OpenMeet (go)
set ROOM=%1
if "%ROOM%"=="" set /p ROOM=Room [standup]: 
if "%ROOM%"=="" set ROOM=standup
set SERVER=%2
if "%SERVER%"=="" set SERVER=%OPENMEET_SERVER%
if "%SERVER%"=="" set SERVER=wss://openmeet.mvega.pro/ws
"%~dp0openmeet.exe" --server %SERVER% --room %ROOM% %3 %4 %5
if errorlevel 1 pause
