@echo off
title UARE Server - port 8787
cd /d "%~dp0"
:loop
echo [UARE] Starting server...
node server.mjs
echo [UARE] Server exited (code %ERRORLEVEL%). Restarting in 2s...
timeout /t 2 /nobreak >nul
goto loop
