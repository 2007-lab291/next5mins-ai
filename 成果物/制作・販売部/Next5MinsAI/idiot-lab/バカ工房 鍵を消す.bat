@echo off
chcp 65001 >nul
set NoDefaultCurrentDirectoryInExePath=1
cd /d "%~dp0"
echo このPCに保存したバカ工房の鍵を消します。
node lab\server.mjs --delete-key
pause
