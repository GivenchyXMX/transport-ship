@echo off
rem ================================================================
rem  Transport Ship - Multiplayer launcher (Windows)
rem  Keep this window OPEN while playing. Closing it stops the server.
rem ================================================================
title Transport Ship MP Server (port 8787)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Please install it from https://nodejs.org  ^(LTS version^), then run this again.
  pause
  exit /b 1
)

cd /d "%~dp0server"

if not exist "node_modules\nodemailer" (
  echo Installing dependencies, one moment...
  call npm ci --no-audit --no-fund
)

echo.
echo   Server starting. Keep this window OPEN while playing.
echo   --------------------------------------------------------
echo   Local    : http://localhost:8787/
echo   Health   : http://localhost:8787/health
echo   --------------------------------------------------------
echo.

rem Open the browser a moment after the server starts listening
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8787/"

node server.js
pause
