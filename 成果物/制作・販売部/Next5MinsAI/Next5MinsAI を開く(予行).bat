cd /d "%~dp0"
start "" http://127.0.0.1:4900/
node server\server.mjs --dry --port 4900
pause
