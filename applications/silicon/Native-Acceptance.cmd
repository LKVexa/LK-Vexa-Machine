@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "JA21_ACCEPTANCE_SCRIPT=%~dp0scripts\windows\native-acceptance.ps1"
set "JA21_ACCEPTANCE_ARCH=%~1"
if "%JA21_ACCEPTANCE_ARCH%"=="" set "JA21_ACCEPTANCE_ARCH=arm64"
if not "%~2"=="" goto :usage
if /i "%JA21_ACCEPTANCE_ARCH%"=="arm64" goto :run
if /i "%JA21_ACCEPTANCE_ARCH%"=="x64" goto :run
:usage
echo Usage: Native-Acceptance.cmd [arm64 ^| x64]
exit /b 1
:run
set "JA21_PSHOST=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "JA21_PSHOST=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
"%JA21_PSHOST%" -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop';try{& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:JA21_ACCEPTANCE_SCRIPT))) -ExpectedArchitecture $env:JA21_ACCEPTANCE_ARCH}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}"
exit /b %ERRORLEVEL%
