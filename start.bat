@echo off
REM ========================================
REM   AddictedNews - Dev Server Start
REM ========================================
REM Backend (NestJS, port 4000) + Frontend (http-server, port 8080)
REM   - Auto crawl: register via setup-schedule.bat
REM   - Manual crawl: use run-crawler.bat
REM ========================================

echo.
echo ========================================
echo   AddictedNews Dev Server
echo ========================================
echo   Backend:  http://localhost:4000
echo   Frontend: http://localhost:8080
echo ========================================
echo.

REM Start backend
cd /d C:\addicted-news\backend
echo [1/2] Starting backend (NestJS)...
start "AddictedNews Backend" cmd /k "npm run start:dev"

REM Wait for backend boot (DB connect, TypeORM init)
echo       Waiting 12s for backend boot...
timeout /t 12 /nobreak >nul

REM Start frontend
cd /d C:\addicted-news\frontend
echo [2/2] Starting frontend (http-server)...
start "AddictedNews Frontend" cmd /k "npx http-server -p 8080"

REM Open browser
timeout /t 3 /nobreak >nul
start http://localhost:8080

echo.
echo Done. Two cmd windows opened.
echo Close them manually to stop the servers.
echo.
