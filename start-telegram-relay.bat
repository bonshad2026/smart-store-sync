@echo off
title Telegram Relay - Smart Store Sync
cd /d "%~dp0"
echo Keep this window open while publishing to Telegram.
node tools\telegram-relay.js
pause
