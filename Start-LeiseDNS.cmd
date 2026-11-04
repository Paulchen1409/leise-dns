@echo off
setlocal
cd /d "%~dp0"
if exist "dist\win-unpacked\Leise DNS.exe" (
  start "" "dist\win-unpacked\Leise DNS.exe"
  exit /b
)
where node >nul 2>nul
if errorlevel 1 (
  echo Bitte die Windows-Version in dist installieren oder Node.js ab Version 22.16 installieren.
  pause
  exit /b 1
)
if not exist "node_modules\electron\cli.js" (
  echo Bitte zuerst npm install im Projektordner ausfuehren.
  pause
  exit /b 1
)
node node_modules\electron\cli.js .
