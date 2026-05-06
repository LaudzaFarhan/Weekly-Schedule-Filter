@echo off
echo ============================================
echo   Schedule Intelligence - React Dashboard
echo ============================================
echo.
echo Starting CORS proxy server + Vite dev server...
echo.
cd /d "%~dp0"
npx concurrently "node server.cjs" "npx vite --open"
pause
