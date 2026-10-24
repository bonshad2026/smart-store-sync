@echo off
cd /d "%~dp0"
set LOG=%~dp0install-log.txt
echo ===== %date% %time% ===== > "%LOG%"
cd backend
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
echo BACKEND_EXIT=%errorlevel% >> "%LOG%"
cd ..\frontend
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
echo FRONTEND_EXIT=%errorlevel% >> "%LOG%"
echo DONE >> "%LOG%"
