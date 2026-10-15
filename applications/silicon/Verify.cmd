@echo off
setlocal EnableExtensions DisableDelayedExpansion
if not exist "%~dp0Start-Console.cmd" goto :missing
rem Intentionally tail-chain into the other batch file; do not CALL/reparse it.
"%~dp0Start-Console.cmd" --verify
exit /b %ERRORLEVEL%
:missing
echo Start-Console.cmd is missing. Extract the complete package first.
if not "%JA21_NO_PAUSE%"=="1" pause
exit /b 1
