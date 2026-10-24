@echo off
cd /d "%~dp0"
set LOG=%~dp0push-log.txt
echo ===== %date% %time% ===== > "%LOG%"
where git >> "%LOG%" 2>&1
if errorlevel 1 (
  echo GIT_NOT_FOUND >> "%LOG%"
  echo Git is not installed. Install it from https://git-scm.com and run this file again.
  pause
  exit /b 1
)
if not exist .git (
  git init >> "%LOG%" 2>&1
)
git config user.name >nul 2>&1 || git config user.name "mhamze1994"
git config user.email >nul 2>&1 || git config user.email "mhamze1994@users.noreply.github.com"
git rm -r --cached --quiet --ignore-unmatch .env >> "%LOG%" 2>&1
git add -A >> "%LOG%" 2>&1
git commit -q -m "Smart Store Sync: multi-channel publishing, interactions, n8n" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01SZNEEhX5c7ZTEdw7VP8L5Q" >> "%LOG%" 2>&1
git branch -M main >> "%LOG%" 2>&1
git remote get-url origin >nul 2>&1 || git remote add origin https://github.com/mhamze1994/shop-sync.git
git remote set-url origin https://github.com/mhamze1994/shop-sync.git
echo --- files in commit: >> "%LOG%"
git ls-files >> "%LOG%" 2>&1
echo --- push: >> "%LOG%"
git push -u origin main >> "%LOG%" 2>&1
echo PUSH_EXIT=%errorlevel% >> "%LOG%"
echo.
echo Done. See push-log.txt
timeout /t 8 > nul
