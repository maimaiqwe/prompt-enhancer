@echo off
rem The watchdog starts the enhancer only while an agent is running.
if exist "%~dp0watchdog.exe" (
    start "" "%~dp0watchdog.exe"
) else (
    echo watchdog.exe not found; run install.ps1 first.
)
