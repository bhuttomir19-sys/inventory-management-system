@echo off
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0Install.ps1" %*
exit /b %errorlevel%
