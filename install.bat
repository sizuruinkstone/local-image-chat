@echo off
cd /d "%~dp0"
call npm.cmd install
if errorlevel 1 (
  echo Installation failed.
) else (
  echo Installation completed. Double-click start.bat next.
)
pause
