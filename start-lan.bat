@echo off
rem スマホなど同じネットワークの端末からアクセスできる状態で起動します。
rem ReForge・Ollamaへの接続はこのPC内(127.0.0.1)のままで、端末へは公開しません。
rem ログイン機能はないため、信頼できるLAN・Tailscale内でだけ使用してください。
cd /d "%~dp0"
set LOCAL_IMAGE_CHAT_HOST=0.0.0.0
if not exist node_modules (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Starting Local Image Chat (LAN mode)...
call npm.cmd start
pause
