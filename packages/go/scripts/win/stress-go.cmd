@echo off
cd /d C:\Users\mvega\openmeet-go
openmeet.exe --headless --debug --room stress --server ws://192.168.68.61:3001/ws --input-device "MIC (BRIDGE CAST" --output-device "CHAT (BRIDGE CAST" %*
