@echo off
cd /d "%~dp0"
echo.
echo Echo Archive phone preview
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo   http://%%b:5173/
)
echo.
npm run dev
pause
