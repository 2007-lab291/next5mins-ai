@echo off
chcp 65001 >nul
set NoDefaultCurrentDirectoryInExePath=1
cd /d "%~dp0"
echo 鍵を貼り直します。新しい鍵を貼って Enter(暗号化して、前の鍵と置き換えます)。そのあと本物のAIで動きます。
echo 準備ができたら、ブラウザで http://127.0.0.1:4910/ が開きます。
node lab\server.mjs --port 4910 --new-key --open
pause
