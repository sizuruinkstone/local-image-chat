@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Starting Local Image Chat...
call npm.cmd start
pause
