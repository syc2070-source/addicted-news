@echo off
REM ========================================
REM   AddictedNews Crawler Script
REM ========================================
REM Usage: run-crawler.bat [silent]
REM   - silent: Exit without pause (for scheduler)
REM   - no param: Pause after completion (for manual run)
REM Logs are written to crawl-last-run.log only,
REM to avoid file lock issues when crawl.log is open in editor.
REM ========================================

set SILENT_MODE=0
if "%1"=="silent" set SILENT_MODE=1

if %SILENT_MODE%==0 (
    echo ========================================
    echo   AddictedNews Crawler
    echo ========================================
    echo.
)

cd /d C:\addicted-news\backend

if not exist logs mkdir logs

set "RUNLOG=%cd%\logs\crawl-last-run.log"

echo [%date% %time%] Crawler started> "%RUNLOG%"
if %SILENT_MODE%==0 (
    echo [%date% %time%] Crawler started
    echo Crawling in progress... ^(takes about 10-15 minutes^)
    echo Log: logs\crawl-last-run.log
    echo.
)

call npm run crawl:once >> "%RUNLOG%" 2>&1

echo [%date% %time%] Crawler finished>> "%RUNLOG%"
echo.>> "%RUNLOG%"

REM Append a one-line summary to crawl.log (ignored if file is locked)
echo [%date% %time%] crawl:once done, see logs\crawl-last-run.log >> logs\crawl.log 2>nul

if %SILENT_MODE%==0 (
    echo [%date% %time%] Crawler finished
    echo.
    echo ========================================
    echo   Crawling completed!
    echo ========================================
    echo Full log: logs\crawl-last-run.log
    echo.
    pause
)
