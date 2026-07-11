@echo off
echo ============================================
echo   The Lab Operation System — School Operations, Live
echo ============================================
echo.
echo Starting CORS proxy server + Vite dev server...
echo.
cd /d "%~dp0"
npx concurrently "node server.cjs" "npx vite --open"
pause
