@echo off
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0Update.ps1" %*
exit /b %errorlevel%
