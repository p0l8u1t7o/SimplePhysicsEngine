@echo off
rem Start the local web pages (showcase site on 8770 and the vs3d UI on 8780). Arguments go to start.ps1, e.g. start.cmd -Station MilitaryGradePC
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
