@echo off
setlocal

cd /d "%~dp0"

echo [1/3] Dependencies installeren...
call npm install
if errorlevel 1 exit /b 1

echo [2/3] Windows installer bouwen...
call npm run desktop:dist
if errorlevel 1 exit /b 1

echo [3/3] Klaar. Kijk in de map dist voor de installer.
pause
