@echo off
cd /d "%~dp0"
set LOG=%~dp0diag-log.txt
echo ===== %date% %time% ===== > "%LOG%"
echo --- host to telegram --- >> "%LOG%"
curl -s -o nul -w "HTTP %%{http_code}" --max-time 15 https://api.telegram.org >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo --- host proxy settings --- >> "%LOG%"
netsh winhttp show proxy >> "%LOG%" 2>&1
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer >> "%LOG%" 2>&1
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable >> "%LOG%" 2>&1
echo --- container to telegram --- >> "%LOG%"
docker compose exec -T app node -e "fetch(\"https://api.telegram.org\").then(r=>console.log(\"HTTP\",r.status)).catch(e=>console.log(\"ERR\",e.message,e.cause&&e.cause.code,e.cause&&e.cause.message))" >> "%LOG%" 2>&1
docker compose exec -T app node -e "require(\"dns\").lookup(\"api.telegram.org\",(e,a)=>console.log(\"DNS\",e?e.code:a))" >> "%LOG%" 2>&1
echo --- app logs --- >> "%LOG%"
docker compose logs --tail 30 app >> "%LOG%" 2>&1
echo DONE >> "%LOG%"
