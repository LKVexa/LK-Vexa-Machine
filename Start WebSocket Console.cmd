@echo off
setlocal EnableExtensions DisableDelayedExpansion
if not "%~1"=="" (
  echo This launcher takes no arguments. Set JA21_PORT before launch to choose a different local port.
  exit /b 2
)
call "%~dp0applications\silicon\Start-Console.cmd" --websocket
exit /b %ERRORLEVEL%
