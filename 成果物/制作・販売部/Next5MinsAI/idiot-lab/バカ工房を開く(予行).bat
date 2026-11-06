@echo off
chcp 65001 >nul
set NoDefaultCurrentDirectoryInExePath=1
cd /d "%~dp0"
start "" http://127.0.0.1:4911/
node lab\server.mjs --dry --port 4911
pause
