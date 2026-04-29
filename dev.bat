@echo off
setlocal

cd /d "%~dp0"

echo [1/4] Poort 3000 controleren...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($conn) { Write-Host 'Poort 3000 is al in gebruik door proces:'; foreach ($c in $conn) { Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\" | Select-Object ProcessId,Name,CommandLine | Format-List }; exit 2 }"
if errorlevel 2 (
  echo.
  echo Sluit eerst het oude terminalvenster met npm run dev/start, of stop het getoonde node-proces.
  echo Start daarna dev.bat opnieuw.
  pause
  exit /b 2
)

echo [2/4] Oude Next dev-cache opschonen...
if exist ".next" (
  rmdir /s /q ".next"
)

echo [3/4] Dependencies controleren...
call npm install
if errorlevel 1 (
  echo npm install is mislukt.
  exit /b 1
)

echo [4/4] Browser openen op http://localhost:3000 ...
start "" "http://localhost:3000"

echo Development server wordt gestart...
call npm run dev
