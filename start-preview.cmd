@echo off
cd /d "%~dp0"
echo.
echo Echo Archive development preview
echo.
echo On this computer:
echo   http://localhost:5173/
echo.
echo On your phone:
echo   Make sure your phone and this computer are on the same Wi-Fi.
echo   Open one of the IPv4 addresses below with port 5173:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo   http://%%b:5173/
)
echo.
npm run dev
pause
