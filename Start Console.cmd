@echo off
setlocal EnableExtensions DisableDelayedExpansion
title JA21 software CPU console
set "JA21_PACKAGE_ROOT=%~dp0."
set "JA21_NATIVE_EXE=%~dp0JA21-Silicon-Console.exe"
set "JA21_START_PREFLIGHT="
set "JA21_START_BLANK="
set "JA21_START_EXTRA=%~3"
if not "%JA21_START_EXTRA%"=="" goto :usage
if "%~1"=="" goto :run
if /i "%~1"=="--preflight" set "JA21_START_PREFLIGHT=--preflight"
if /i "%~1"=="--blank" set "JA21_START_BLANK=--blank"
if "%JA21_START_PREFLIGHT%%JA21_START_BLANK%"=="" goto :usage
if "%~2"=="" goto :run
if /i "%~2"=="%~1" goto :usage
if /i "%~2"=="--preflight" set "JA21_START_PREFLIGHT=--preflight"
if /i "%~2"=="--blank" set "JA21_START_BLANK=--blank"
if /i not "%~2"=="--preflight" if /i not "%~2"=="--blank" goto :usage
:run
if not exist "%JA21_NATIVE_EXE%" goto :missing_host
echo JA21 software CPU console
echo Package: "%~dp0"
echo Starting the native Windows application under the configured Windows policy.
"%JA21_NATIVE_EXE%" --root "%JA21_PACKAGE_ROOT%" %JA21_START_PREFLIGHT% %JA21_START_BLANK%
set "JA21_START_RESULT=%ERRORLEVEL%"
if "%JA21_START_RESULT%"=="0" exit /b 0
echo.
echo Startup exited with code %JA21_START_RESULT%. The error above is the reason.
if not "%JA21_NO_PAUSE%"=="1" pause
exit /b %JA21_START_RESULT%
:missing_host
echo Native application JA21-Silicon-Console.exe is missing. Extract the full combined release.
if not "%JA21_NO_PAUSE%"=="1" pause
exit /b 2
:usage
echo Usage: "Start Console.cmd" [--preflight] [--blank]
exit /b 1
