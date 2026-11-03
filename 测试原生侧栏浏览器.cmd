@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop\scripts\start-native-preview.ps1"
set "previewExit=%ERRORLEVEL%"
if not "%previewExit%"=="0" pause
endlocal & exit /b %previewExit%
