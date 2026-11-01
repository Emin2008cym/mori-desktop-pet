@echo off
setlocal
"%~dp0resources\binaries\node.exe" "%~dp0install-mori-dev.mjs"
if errorlevel 1 (
  echo Installation did not finish. Keep this window open and share the error text.
  pause
  exit /b 1
)
echo Mori installed. Use the Mori desktop shortcut next time.
pause
