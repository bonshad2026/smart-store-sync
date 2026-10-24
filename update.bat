@echo off
cd /d "%~dp0"
set LOG=%~dp0update-log.txt
echo ===== %date% %time% ===== > "%LOG%"
netstat -ano | find "127.0.0.1:8081" | find "LISTENING" > nul
if errorlevel 1 (start "Telegram Relay - Smart Store Sync" /min cmd /k node tools\telegram-relay.js & echo relay started >> "%LOG%") else (echo relay already running >> "%LOG%")
docker compose up -d --build app >> "%LOG%" 2>&1
echo DOCKER_EXIT=%errorlevel% >> "%LOG%"
timeout /t 12 /nobreak > nul
curl -s http://localhost:4000/api/health >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo DONE >> "%LOG%"
