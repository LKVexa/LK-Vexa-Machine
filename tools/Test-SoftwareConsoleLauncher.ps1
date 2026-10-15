param([Parameter(Mandatory=$true)][string]$Root, [Parameter(Mandatory=$true)][string]$Work)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$Work = [IO.Path]::GetFullPath($Work)
$payload = Join-Path $Root 'host/Start-Console.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($payload,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
# Execute only the pure file/configuration declarations. This does not run the
# host script, instantiate WPF/WebView2, or substitute for startup acceptance.
foreach($function in $ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]}) {
    . ([ScriptBlock]::Create($function.Extent.Text))
}
$null=Assert-JA21ConsolePath $Work
[void][IO.Directory]::CreateDirectory($Work)
$report=[ordered]@{schema='JA21/SOFTWARE_CONSOLE_LAUNCHER/1';status='RUNNING';startedUtc=[DateTime]::UtcNow.ToString('o');powerShell=$PSVersionTable.PSVersion.ToString();checks=@();nativePreflight=$null;desktopExecution='NOT_RUN';scope='Configuration declarations, packaging and normal launcher preflight only. No WPF/WebView2, software CPU or persistence execution.'}
$reportPath=Join-Path $Work 'SOFTWARE_CONSOLE_LAUNCHER_RESULTS.json'
function Save-Report {[IO.File]::WriteAllText($reportPath,(($report|ConvertTo-Json -Depth 8)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))}
function Check([string]$Name,[bool]$Passed) {
    if(-not $Passed){throw ('Launcher contract failed: '+$Name)}
    $report.checks+=@([ordered]@{name=$Name;status='PASS'})
}
function Expect-Rejection([string]$Name,[ScriptBlock]$Action) {
    $rejected=$false;try{& $Action | Out-Null}catch{$rejected=$true}
    Check $Name $rejected
}
function Write-Json([string]$Path,$Value) {[IO.File]::WriteAllText($Path,(($Value|ConvertTo-Json -Depth 8)+[Environment]::NewLine),(New-Object Text.UTF8Encoding($false)))}
function Invoke-Preflight([string]$PackageRoot,[string]$Options) {
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=Join-Path $env:SystemRoot 'System32/cmd.exe'
    $info.Arguments='/d /s /c ""'+(Join-Path $PackageRoot 'Start Console.cmd')+'" '+$Options+'"'
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $info.EnvironmentVariables['JA21_NO_PAUSE']='1'
    $info.EnvironmentVariables['JA21_NATIVE_ONLY']='1'
    $info.EnvironmentVariables['JA21_DISABLE_LIVE_WEB']='1'
    $info.EnvironmentVariables['JA21_HEADLESS']='1'
    $process=New-Object Diagnostics.Process;$process.StartInfo=$info
    try{
        if(-not $process.Start()){throw 'Normal preflight process did not start'}
        $stdoutTask=$process.StandardOutput.ReadToEndAsync();$stderrTask=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit(15000)){try{$process.Kill()}catch{};throw 'Normal launcher preflight timed out'}
        return [ordered]@{exitCode=$process.ExitCode;stdout=$stdoutTask.GetAwaiter().GetResult();stderr=$stderrTask.GetAwaiter().GetResult()}
    }finally{$process.Dispose()}
}
try {
    Save-Report
    $cmd=[IO.File]::ReadAllText((Join-Path $Root 'Start Console.cmd'))
    $vbs=[IO.File]::ReadAllText((Join-Path $Root 'Start Console.vbs'))
    $source=[IO.File]::ReadAllText($payload)
    Check 'normal launcher invokes packaged native application directly' ($cmd.Contains('"%JA21_NATIVE_EXE%" --root "%JA21_PACKAGE_ROOT%"') -and -not ($cmd -match 'powershell|ReadAllText|ScriptBlock'))
    Check 'package root avoids trailing-backslash argument quoting and delayed expansion' ($cmd.Contains('JA21_PACKAGE_ROOT=%~dp0.') -and $cmd.Contains('DisableDelayedExpansion'))
    Check 'main launcher and compatibility alias have no policy bypass or hidden launch' (($cmd+$vbs+$source) -notmatch 'ExecutionPolicy\s+Bypass|Set-ExecutionPolicy|WindowStyle\s+Hidden|consoleShell\.Run\(consoleCommand,\s*0')
    Check 'main launcher never invokes Node/npm or opens a network server' ($cmd -notmatch '(?i)node\.exe|npm\s|serve\.mjs|Start-Process')
    Check 'software CPU path requires live web and a combined build' ($source.Contains("`$env:JA21_REQUIRE_LIVE_WEB = '1'") -and $source.Contains('$build.software_cpu_console'))
    $actual=Get-JA21SoftwareConsoleConfiguration -PackageRoot $Root
    Check 'current package configuration matches software CPU release' ($actual.StartUrl -ceq 'https://ja21-silicon.invalid/' -and $actual.SiliconVersion -ceq '2.4.0')
    $blank=Get-JA21SoftwareConsoleConfiguration -PackageRoot $Root -RequestedUrl 'about:blank'
    Check 'explicit blank option retained' ($blank.StartUrl -ceq 'about:blank')
    Expect-Rejection 'arbitrary remote and host URLs rejected' {Get-JA21SoftwareConsoleConfiguration -PackageRoot $Root -RequestedUrl 'https://example.com/'}
    $fixture=Join-Path $Work "console with spaces & apostrophe' bang! percent%"
    $null=Assert-JA21ConsolePath $fixture
    [void][IO.Directory]::CreateDirectory($fixture)
    $relativeFiles=@('console.json','CONSOLE_BUILD.json','CONSOLE_VERSION','host/Start-Console.ps1','host/Start-JA21Browser.ps1','applications/silicon/package.json','applications/silicon/VERSION','applications/silicon/dist/index.html','applications/silicon/dist/release.json','applications/silicon/dist/src/app.js','applications/silicon/dist/src/vendor/ram-worker.js','applications/silicon/dist/src/version.js','Start Console.cmd')
    foreach($relative in $relativeFiles){
        $target=Join-Path $fixture $relative;[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
        [IO.File]::Copy((Join-Path $Root $relative),$target,$true)
    }
    $pathCase=Get-JA21SoftwareConsoleConfiguration -PackageRoot $fixture
    Check 'literal package path handles spaces and shell punctuation' ($pathCase.Root -ceq $fixture)
    $buildPath=Join-Path $fixture 'CONSOLE_BUILD.json'
    $buildText=[IO.File]::ReadAllText($buildPath);$modified=$buildText|ConvertFrom-Json;$modified.software_cpu_console=$false;Write-Json $buildPath $modified
    Expect-Rejection 'blank-only build rejected before host startup' {Get-JA21SoftwareConsoleConfiguration -PackageRoot $fixture}
    [IO.File]::WriteAllText($buildPath,$buildText)
    $settingsPath=Join-Path $fixture 'console.json';$settingsText=[IO.File]::ReadAllText($settingsPath);$modified=$settingsText|ConvertFrom-Json;$modified.start_url='about:blank';Write-Json $settingsPath $modified
    Expect-Rejection 'wrong default origin rejected' {Get-JA21SoftwareConsoleConfiguration -PackageRoot $fixture}
    [IO.File]::WriteAllText($settingsPath,$settingsText)
    $releasePath=Join-Path $fixture 'applications/silicon/dist/release.json';$releaseText=[IO.File]::ReadAllText($releasePath);$modified=$releaseText|ConvertFrom-Json;$modified.version='0.0.0';Write-Json $releasePath $modified
    Expect-Rejection 'mismatched built software CPU version rejected' {Get-JA21SoftwareConsoleConfiguration -PackageRoot $fixture}
    [IO.File]::WriteAllText($releasePath,$releaseText)
    $workerPath=Join-Path $fixture 'applications/silicon/dist/src/vendor/ram-worker.js';[IO.File]::Move($workerPath,($workerPath+'.retained'))
    Expect-Rejection 'incomplete software CPU assets rejected' {Get-JA21SoftwareConsoleConfiguration -PackageRoot $fixture}
    [IO.File]::Move(($workerPath+'.retained'),$workerPath)
    # The small configuration fixture intentionally contains no executable.
    # Prove a missing host fails visibly and cannot open a desktop or substitute
    # a PowerShell interpreter; real EXE preflight is a separate native gate.
    $normal=Invoke-Preflight $fixture '--preflight'
    $combined=$normal.stdout+$normal.stderr
    Check 'missing native host fails visibly without substitute execution' ($normal.exitCode -eq 2 -and $combined -match 'JA21-Silicon-Console.exe is missing')
    $normal.status='PASS_MISSING_HOST_REFUSAL'
    $report.nativePreflight=$normal
    $nativeExe=Join-Path $Root 'JA21-Silicon-Console.exe'
    if(Test-Path -LiteralPath $nativeExe -PathType Leaf){
        [IO.File]::Copy($nativeExe,(Join-Path $fixture 'JA21-Silicon-Console.exe'),$true)
        # This fixture has no runtime seal, so the real native host must refuse
        # it before a presenter can start. Its boot-log path proves the quoted
        # shell punctuation was transported as one literal root argument.
        $transport=Invoke-Preflight $fixture '--preflight'
        Check 'native executable receives punctuated package root literally and refuses unsealed fixture' ($transport.exitCode -eq 1 -and ($transport.stdout+$transport.stderr).Contains((Join-Path $fixture 'workspace')) -and ($transport.stdout+$transport.stderr) -match 'JA21 software console could not start')
        $report.nativeArgumentTransport=[ordered]@{status='PASS_LITERAL_ROOT_AND_UNSEALED_REFUSAL';exitCode=$transport.exitCode;stdout=$transport.stdout;stderr=$transport.stderr}
    }
    $report.status='PASS_HEADLESS_CONFIGURATION_CONTRACTS'
}catch{$report.status='FAIL';$report.error=$_.Exception.Message;throw}
finally{$report.finishedUtc=[DateTime]::UtcNow.ToString('o');Save-Report}
Write-Host ('Launcher contracts passed: '+$report.checks.Count)
Write-Host ('Actual normal preflight: '+$report.nativePreflight.status)
Write-Host ('Evidence: '+$reportPath)
