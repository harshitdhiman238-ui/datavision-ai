@echo off
title DataVision AI Server
cd /d "%~dp0"

echo ==========================================
echo   DataVision AI - Smart Analytics Platform
echo ==========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js nahi mila!
  echo.
  echo Pehle Node.js install karo (sirf ek baar):
  echo   1. https://nodejs.org kholo
  echo   2. "LTS" wala version download karke install karo
  echo   3. Phir is file ko dobara double-click karo
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/2] Dependencies install ho rahi hain - pehli baar 1-2 minute lagenge...
  echo.
  call npm install
  if %errorlevel% neq 0 (
    echo [ERROR] npm install fail ho gaya. Internet connection check karke dobara try karo.
    pause
    exit /b 1
  )
)

echo.
echo [2/2] Server start ho raha hai...
echo.
echo   App yahan khulegi:  http://localhost:3000
echo   Admin login:        admin@datavision.local / Admin@1234
echo.
echo   Band karne ke liye ye window close karo ya Ctrl+C dabao.
echo ==========================================
echo.

start "" "http://localhost:3000"
node server\index.js
pause
