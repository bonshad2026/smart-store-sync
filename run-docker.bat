@echo off
cd /d "%~dp0"
set LOG=%~dp0run-log.txt
echo ===== %date% %time% ===== > "%LOG%"
echo --- tools --- >> "%LOG%"
where node >> "%LOG%" 2>&1
node -v >> "%LOG%" 2>&1
where psql >> "%LOG%" 2>&1
docker version >> "%LOG%" 2>&1
echo --- compose up --- >> "%LOG%"
docker compose up -d --build >> "%LOG%" 2>&1
echo EXIT=%errorlevel% >> "%LOG%"
echo --- ps --- >> "%LOG%"
docker compose ps >> "%LOG%" 2>&1
timeout /t 15 /nobreak > nul
echo --- health --- >> "%LOG%"
curl -s http://localhost:4000/api/health >> "%LOG%" 2>&1
echo. >> "%LOG%"
docker compose logs --tail 40 app >> "%LOG%" 2>&1
echo DONE >> "%LOG%"
