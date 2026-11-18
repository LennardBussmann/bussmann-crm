@echo off
rem Daten vom bisherigen Server auf diesen PC holen (Probelauf oder endgueltiger Umzug)
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0daten-uebernehmen.ps1"
echo.
pause
