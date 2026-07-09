@echo off
setlocal

cd /d "%~dp0"

echo [1/3] Dependencies controleren...
call npm install
if errorlevel 1 (
  echo npm install is mislukt.
  exit /b 1
)

echo [2/4] Oude Next build-cache opschonen...
if exist ".next" (
  rmdir /s /q ".next"
)

echo [3/4] Production build maken...
call npm run build
if errorlevel 1 (
  echo npm run build is mislukt.
  exit /b 1
)

echo [4/4] Browser openen op http://localhost:3000 ...
start "" "http://localhost:3000"

echo Production server wordt gestart...
call npm run start
