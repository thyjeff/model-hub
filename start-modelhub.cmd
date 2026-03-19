@echo off
setlocal

cd /d D:\Pro\model-hub-proxy

if not exist logs mkdir logs
set PORT=8080

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set TS=%%i

echo [%date% %time%] Starting Model Hub >> logs\modelhub-startup.log

node src\index.js >> logs\modelhub.log 2>&1

echo [%date% %time%] Model Hub process exited >> logs\modelhub-startup.log

endlocal

