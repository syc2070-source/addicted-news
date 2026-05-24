@echo off
REM AddictedNews Crawler Scheduler Removal

echo ========================================
echo   AddictedNews Crawler Scheduler Removal
echo ========================================
echo.

REM Delete tasks (try multiple task names for compatibility)
set DELETED_COUNT=0

echo Deleting tasks...
echo.

REM Delete new task name
schtasks /delete /tn "AddictedNews Crawler Laptop" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [DELETED] AddictedNews Crawler Laptop
    set /a DELETED_COUNT+=1
)

REM Delete old task names (for compatibility)
schtasks /delete /tn "AddictedNews Crawler" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [DELETED] AddictedNews Crawler
    set /a DELETED_COUNT+=1
)

schtasks /delete /tn "AddictedNews Crawler Daily" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [DELETED] AddictedNews Crawler Daily
    set /a DELETED_COUNT+=1
)

echo.
if %DELETED_COUNT% gtr 0 (
    echo [SUCCESS] %DELETED_COUNT% scheduler(s) removed.
) else (
    echo [NOTICE] No scheduler found or already removed.
)

echo.
pause
