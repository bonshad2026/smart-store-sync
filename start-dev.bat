@echo off
REM اجرای سریع حالت توسعه در ویندوز (نیازمند Node.js 20+ و PostgreSQL)
if not exist .env copy .env.example .env
start "SSS Backend" cmd /k "cd backend && npm install && npm run migrate && npm run dev"
start "SSS Dashboard" cmd /k "cd frontend && npm install && npm run dev"
echo Dashboard: http://localhost:5173   API: http://localhost:4000/api
