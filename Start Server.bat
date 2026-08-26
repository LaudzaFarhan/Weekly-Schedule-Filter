@echo off
echo ============================================
echo   The Lab Operation System - Live Dev Server
echo ============================================
echo.

cd /d "%~dp0"

set "NODE_EXE=node"
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  if exist "%LOCALAPPDATA%\Programs\node\node.exe" (
    set "NODE_EXE=%LOCALAPPDATA%\Programs\node\node.exe"
    set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
  ) else if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
  ) else (
    echo [ERROR] Node.js not found!
    echo Please install Node.js LTS from: https://nodejs.org
    echo.
    pause
    exit /b 1
  )
)

echo Starting Next.js development server...
echo.
echo - Local URL:    http://localhost:3000
echo - Network URL:  http://192.168.1.104:3000
echo.

"%NODE_EXE%" "node_modules\next\dist\bin\next" dev -H 0.0.0.0 -p 3000
pause
