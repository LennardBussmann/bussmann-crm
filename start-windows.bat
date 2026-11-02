@echo off
cd /d %~dp0
if not exist node_modules (
  echo Installiere Abhaengigkeiten ...
  call npm install --omit=dev
)
echo Bussmann CRM startet auf http://localhost:3000
node --disable-warning=ExperimentalWarning server.js
pause
