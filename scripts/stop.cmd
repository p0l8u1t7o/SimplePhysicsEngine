@echo off
rem Stop the local web pages started by start.cmd. Arguments go to stop.ps1, e.g. stop.cmd -Studio
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
if errorlevel 1 pause
