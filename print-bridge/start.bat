@echo off
REM start.bat -- entry point for Task Scheduler. Switches to this script's
REM own folder (so it works no matter what directory Task Scheduler
REM launches it from) and appends console output to a local log file, so
REM there's something to check without needing to keep a window open.
cd /d "%~dp0"
node index.js >> print-bridge.log 2>&1
