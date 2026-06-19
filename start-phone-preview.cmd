@echo off
cd /d "%~dp0"
echo.
echo Echo Archive phone preview
echo.
echo Open this on your phone:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo   http://%%b:5173/
)
echo.
echo Keep this window open while using the app.
echo If it does not open, allow Node.js through Windows Firewall for Private networks.
echo.
npm run dev
pause
