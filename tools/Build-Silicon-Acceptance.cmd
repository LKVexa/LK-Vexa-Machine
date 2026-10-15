@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "JA21_QA_CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%JA21_QA_CSC%" (
  echo Windows .NET Framework 4.x 64-bit compiler is required.
  exit /b 1
)
pushd "%~dp0.."
if errorlevel 1 exit /b 1
"%JA21_QA_CSC%" /nologo /warn:4 /warnaserror+ /platform:x64 /target:exe /main:VBJA21.SiliconWebView2Acceptance /out:tools\Test-Silicon-WebView2.exe /r:"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\WPF\PresentationFramework.dll" /r:"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\WPF\PresentationCore.dll" /r:"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll" /r:"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\System.Xaml.dll" /r:"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\System.Web.Extensions.dll" /r:"runtime\webview2-sdk\1.0.4191.47\Microsoft.Web.WebView2.Core.dll" /r:"runtime\webview2-sdk\1.0.4191.47\Microsoft.Web.WebView2.Wpf.dll" host\JA21VirtualBrowser.cs host\Vec1Substrate.cs host\PortableDesktop.cs host\LiveWebContracts.cs host\SiliconApp.cs host\LiveWebBridge.cs host\HostAdminBridge.cs host\AdminTerminal.cs host\SiliconConsoleEntry.cs tools\SiliconWebView2Acceptance.cs
set "JA21_QA_BUILD_EXIT=%ERRORLEVEL%"
popd
exit /b %JA21_QA_BUILD_EXIT%
