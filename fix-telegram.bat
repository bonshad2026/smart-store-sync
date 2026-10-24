@echo off
cd /d "%~dp0"
set LOG=%~dp0fix-log.txt
echo ===== %date% %time% ===== > "%LOG%"
start "Telegram Relay - Smart Store Sync" cmd /k node tools\telegram-relay.js
echo --- rebuild --- >> "%LOG%"
docker compose up -d --build >> "%LOG%" 2>&1
echo EXIT=%errorlevel% >> "%LOG%"
timeout /t 15 /nobreak > nul
echo --- host relay check --- >> "%LOG%"
curl -s http://127.0.0.1:8081/x >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo --- container to relay getMe --- >> "%LOG%"
docker compose exec -T app node -e "fetch(process.env.TELEGRAM_API_BASE+\"/bot\"+process.env.TELEGRAM_BOT_TOKEN+\"/getMe\").then(r=>r.json()).then(d=>console.log(\"getMe ok=\"+d.ok, d.result?d.result.username:d.description)).catch(e=>console.log(\"ERR\",e.message,e.cause&&e.cause.code))" >> "%LOG%" 2>&1
echo --- health --- >> "%LOG%"
curl -s http://localhost:4000/api/health >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo DONE >> "%LOG%"
