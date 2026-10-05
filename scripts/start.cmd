@echo off
rem Start the vs3d UI (8780) by default. Arguments go to start.ps1: -Site (showcase site on 8770), -All (both), -Station MilitaryGradePC
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
