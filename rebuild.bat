@echo off
cd /d "%~dp0"
set LOG=%~dp0rebuild-log.txt
echo ===== %date% %time% ===== > "%LOG%"
echo --- backend install + typecheck --- >> "%LOG%"
pushd backend
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
call npx tsc --noEmit >> "%LOG%" 2>&1
echo BACKEND_TSC=%errorlevel% >> "%LOG%"
popd
echo --- frontend install + typecheck --- >> "%LOG%"
pushd frontend
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
call npx tsc --noEmit >> "%LOG%" 2>&1
echo FRONTEND_TSC=%errorlevel% >> "%LOG%"
popd
echo --- docker build --- >> "%LOG%"
docker compose up -d --build >> "%LOG%" 2>&1
echo DOCKER_EXIT=%errorlevel% >> "%LOG%"
timeout /t 15 /nobreak > nul
echo --- checks --- >> "%LOG%"
curl -s http://localhost:4000/api/health >> "%LOG%" 2>&1
echo. >> "%LOG%"
curl -s http://localhost:4000/api/platforms >> "%LOG%" 2>&1
echo. >> "%LOG%"
curl -s -o nul -w "INDEX HTTP %%{http_code}" http://localhost:4000/ >> "%LOG%" 2>&1
echo. >> "%LOG%"
docker compose logs --tail 25 app >> "%LOG%" 2>&1
echo DONE >> "%LOG%"
