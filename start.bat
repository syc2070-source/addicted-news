@echo off
title 중독뉴스 자동 실행
chcp 65001 >nul

echo ========================================
echo 🚀 중독뉴스 자동 실행 시작
echo ========================================
echo.

cd /d %~dp0

REM 기존 프로세스 정리 (선택사항)
echo 기존 서버 프로세스 확인 중...
taskkill /FI "WINDOWTITLE eq 중독뉴스-백엔드*" /F 2>nul
taskkill /FI "WINDOWTITLE eq 중독뉴스-프론트*" /F 2>nul
timeout /t 2 /nobreak >nul

echo [1/3] 백엔드 서버 시작 중...
start "중독뉴스-백엔드-4000" /MIN cmd /k "cd /d %~dp0backend && npm run start:dev"

echo [2/3] 백엔드 초기화 대기 (12초)...
timeout /t 12 /nobreak >nul

echo [3/3] 프론트엔드 서버 시작 중...
start "중독뉴스-프론트-8080" /MIN cmd /k "cd /d %~dp0frontend && npx live-server --port=8080 --no-browser"

echo.
echo ========================================
echo ✅ 서버 실행 완료!
echo ========================================
echo.
echo 백엔드:     http://localhost:4000
echo 프론트엔드: http://localhost:8080
echo.
echo 3초 후 브라우저가 열립니다...
timeout /t 3 /nobreak >nul

start http://localhost:8080

echo.
echo ✅ 작업 완료!
echo 백그라운드에서 2개 서버가 실행 중입니다.
echo 종료하려면 작업 표시줄에서 CMD 창을 닫으세요.
echo.
pause
```