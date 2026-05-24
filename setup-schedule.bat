@echo off
REM AddictedNews Crawler Scheduler Setup (Laptop)
REM Runs daily at 12:00

echo ========================================
echo   AddictedNews Crawler Scheduler Setup
echo ========================================
echo.

REM Delete existing task if exists
schtasks /delete /tn "AddictedNews Crawler Laptop" /f 2>nul

REM Create new scheduled task
schtasks /create /tn "AddictedNews Crawler Laptop" /tr "C:\addicted-news\run-crawler.bat silent" /sc daily /st 12:00 /ru "%USERNAME%" /rl HIGHEST

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Scheduler registered!
    echo - Task Name: AddictedNews Crawler Laptop
    echo - Run Time: Daily 12:00
    echo - Script: C:\addicted-news\run-crawler.bat silent
    echo.
    echo Registered task details:
    schtasks /query /tn "AddictedNews Crawler Laptop" /fo list
) else (
    echo.
    echo [FAILED] Please run as Administrator
)

echo.
pause
