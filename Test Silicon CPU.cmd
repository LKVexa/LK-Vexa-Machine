@echo off
setlocal EnableExtensions DisableDelayedExpansion
if not "%~2"=="" goto :usage
if "%~1"=="--preflight" goto :preflight
if not "%~1"=="" goto :usage
echo JA21 software CPU: automatic live WebView2 acceptance
echo This opens one test window and uses fresh isolated storage.
echo Keep the window open until the automatic test completes.
echo.
if not exist "%~dp0tools\Test-Silicon-WebView2.exe" (
  echo The native acceptance tool is missing. Use the complete extracted release.
  exit /b 1
)
"%~dp0tools\Test-Silicon-WebView2.exe"
goto :result
:preflight
"%~dp0tools\Test-Silicon-WebView2.exe" --preflight
:result
set "JA21_QA_EXIT=%ERRORLEVEL%"
echo.
echo Acceptance exit code: %JA21_QA_EXIT%
echo The tool prints the fresh result JSON path above.
echo Only a PASS report with browser_validation_passed true completes the live gate.
if not "%JA21_NO_PAUSE%"=="1" pause
exit /b %JA21_QA_EXIT%
:usage
echo Usage: Test Silicon CPU.cmd [--preflight]
echo An unknown argument does not start a browser.
exit /b 2
