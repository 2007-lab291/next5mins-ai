@echo off
chcp 65001 >nul
set NoDefaultCurrentDirectoryInExePath=1
cd /d "%~dp0"
echo 本物のAIで動かします。保存した鍵があれば、それを使います(無ければ、鍵を貼って Enter。暗号化して、このPCに保存します)。
echo 準備ができたら、ブラウザで http://127.0.0.1:4910/ が開きます。
node lab\server.mjs --port 4910 --open
pause
