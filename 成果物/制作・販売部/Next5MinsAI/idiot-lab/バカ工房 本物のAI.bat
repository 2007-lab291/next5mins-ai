chcp 65001 >nul
cd /d "%~dp0"
echo 本物のAIで動かします。鍵を貼って Enter(保存しません)。そのあとブラウザで http://127.0.0.1:4910/ を開く
node lab\server.mjs --port 4910
pause
