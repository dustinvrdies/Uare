@echo off
setlocal
cd /d "%~dp0"
echo Starting UARE Smart Launcher...
where node >nul 2>nul
if %errorlevel% neq 0 (
  where winget >nul 2>nul
  if %errorlevel%==0 (
    echo Node.js not found. Attempting install with winget...
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  ) else (
    where choco >nul 2>nul
    if %errorlevel%==0 (
      echo Node.js not found. Attempting install with Chocolatey...
      choco install nodejs-lts -y
    )
  )
)
where node >nul 2>nul
if %errorlevel%==0 (
  node start-uare.mjs
) else (
  echo Node.js could not be installed automatically.
  echo Install Node.js LTS, then run this launcher again.
  pause
)
endlocal
