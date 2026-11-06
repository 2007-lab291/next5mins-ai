@echo off
chcp 65001 >nul
set NoDefaultCurrentDirectoryInExePath=1
cd /d "%~dp0"
echo 予行(にせのバカ。費用なし)で動かします。準備ができたら、ブラウザで http://127.0.0.1:4911/ が開きます。
node lab\server.mjs --dry --port 4911 --open
pause
