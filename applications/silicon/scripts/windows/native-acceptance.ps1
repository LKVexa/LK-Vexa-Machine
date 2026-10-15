# Run on the Windows architecture being accepted, from an extracted package.
# This provisions the pinned private runtime, runs core verification and checks
# the production loopback host. Browser persistence has its own acceptance gate.
param(
    [ValidateSet('arm64', 'x64')][string]$ExpectedArchitecture = 'arm64',
    [ValidateRange(1024,65535)][int]$Port = 8792
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ExpectedArchitecture = $ExpectedArchitecture.ToLowerInvariant()
$script:LogPath = $null
$scriptDirectory = $PSScriptRoot
if (-not $scriptDirectory -and $env:JA21_ACCEPTANCE_SCRIPT) { $scriptDirectory = [IO.Path]::GetDirectoryName($env:JA21_ACCEPTANCE_SCRIPT) }
if (-not $scriptDirectory) { throw 'Run Native-Acceptance.cmd from the extracted package, or run this saved script directly.' }
$root = [IO.Path]::GetFullPath((Join-Path $scriptDirectory '../..'))
$bootstrap = Join-Path $scriptDirectory 'bootstrap.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($bootstrap, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
# Load only reviewed function declarations; do not execute bootstrap main.
foreach ($function in $ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] }) {
    . ([ScriptBlock]::Create($function.Extent.Text))
}
Assert-PlainPath $root
$audit = Join-Path $root 'audit'
New-PrivateDirectory $audit
$reportPath = Join-Path $audit ('NATIVE_ACCEPTANCE_' + $ExpectedArchitecture + '.json')
Assert-PlainPath $reportPath
$report = [ordered]@{
    schema = 'JA21/NATIVE_WINDOWS_ACCEPTANCE/1'
    status = 'RUNNING'
    startedUtc = [DateTime]::UtcNow.ToString('o')
    requestedArchitecture = $ExpectedArchitecture
    hostArchitecture = $null
    windowsPowerShell = $PSVersionTable.PSVersion.ToString()
    packageVersion = $null
    runtime = $null
    preflight = $null
    coreVerification = $null
    host = $null
    browserPersistence = 'SEPARATE_GATE'
    limits = @('Does not validate physical silicon or GPU execution.', 'Does not validate browser persistence or .NET reference execution.')
}
function Save-AcceptanceReport { [IO.File]::WriteAllText($reportPath, (($report | ConvertTo-Json -Depth 8) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false))) }
function Start-AcceptanceProcess([string]$Executable, [string]$Arguments) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = $Arguments
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables['JA21_NO_PAUSE'] = '1'
    $info.EnvironmentVariables['JA21_NO_OPEN'] = '1'
    foreach ($name in @('NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_ICU_DATA', 'NODE_REDIRECT_WARNINGS', 'NODE_V8_COVERAGE', 'OPENSSL_CONF', 'OPENSSL_MODULES', 'SSLKEYLOGFILE')) {
        $info.EnvironmentVariables.Remove($name)
    }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    if (-not $process.Start()) { $process.Dispose(); throw 'Windows did not start acceptance process.' }
    return $process
}
function Invoke-AcceptanceStep([string]$Arguments, [int]$TimeoutMilliseconds) {
    $process = Start-AcceptanceProcess (Join-Path $env:SystemRoot 'System32/cmd.exe') $Arguments
    try {
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutMilliseconds)) { try { $process.Kill() } catch {}; throw 'Native launcher acceptance step timed out.' }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        Write-Host $stdout
        if ($stderr) { Write-Host $stderr }
        if ($process.ExitCode -ne 0) { throw ('Native launcher acceptance step exited {0}: {1}' -f $process.ExitCode, ($stdout + $stderr)) }
        return [ordered]@{status='PASS';exitCode=$process.ExitCode;stdout=$stdout;stderr=$stderr}
    } finally { $process.Dispose() }
}
function Receive-AcceptanceResponse([string]$Path) {
    $request = [Net.HttpWebRequest]::Create(('http://127.0.0.1:' + $Port + $Path))
    $request.Proxy = $null
    $request.Timeout = 1000
    $request.ReadWriteTimeout = 1000
    $request.AllowAutoRedirect = $false
    $response = $null; $reader = $null
    try {
        $response = $request.GetResponse()
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        return [ordered]@{status=[int]$response.StatusCode;type=$response.ContentType;body=$reader.ReadToEnd();csp=$response.Headers['Content-Security-Policy']}
    } finally { if ($reader) { $reader.Dispose() }; if ($response) { $response.Close() }; $request.Abort() }
}
$hostProcess = $null
try {
    Save-AcceptanceReport
    $report.hostArchitecture = Get-WindowsRuntimeArchitecture
    if ($report.hostArchitecture -cne $ExpectedArchitecture) { throw ('Native acceptance requires Windows {0}; this host is {1}. No emulation/contract result is substituted.' -f $ExpectedArchitecture, $report.hostArchitecture) }
    $package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    $report.packageVersion = $package.version
    $launcher = Join-Path $root 'Start-Console.cmd'
    $report.preflight = Invoke-AcceptanceStep ('/d /s /c ""' + $launcher + '" --preflight"') 360000
    $pins = Get-Content -LiteralPath (Join-Path $scriptDirectory 'runtime-lock.json') -Raw | ConvertFrom-Json
    $node = Join-Path $root ('.runtime/node-v' + $pins.nodeVersion + '-win-' + $ExpectedArchitecture + '/node.exe')
    Confirm-Runtime $node $pins.nodeVersion $ExpectedArchitecture
    $report.runtime = [ordered]@{version=$pins.nodeVersion;platform='win32';architecture=$ExpectedArchitecture;peMachineVerified=$true;path=$node}
    $report.coreVerification = Invoke-AcceptanceStep ('/d /s /c ""' + $launcher + '" --verify"') 180000
    # Refuse an existing listener so a response from another console cannot be
    # mistaken for startup of this process. The production host binds loopback.
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $listener.ExclusiveAddressUse = $true; $listener.Start() } finally { $listener.Stop() }
    $hostProcess = Start-AcceptanceProcess $node ('"' + (Join-Path $root 'scripts/serve.mjs') + '" --port ' + $Port)
    $hostStdout = $hostProcess.StandardOutput.ReadToEndAsync()
    $hostStderr = $hostProcess.StandardError.ReadToEndAsync()
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $index = $null
    while (-not $index -and $clock.Elapsed.TotalSeconds -lt 20) {
        if ($hostProcess.HasExited) { throw ('Host exited before ready: ' + $hostStderr.GetAwaiter().GetResult()) }
        try { $index = Receive-AcceptanceResponse '/' } catch { Start-Sleep -Milliseconds 100 }
    }
    if (-not $index -or $index.status -ne 200 -or $index.body -notmatch [Regex]::Escape(('JA21 Silicon Console ' + $package.version))) { throw 'Production host did not serve the expected console.' }
    if (-not $index.csp -or $index.csp -notmatch "default-src 'none'") { throw 'Production host CSP was missing or unexpected.' }
    $version = Receive-AcceptanceResponse '/src/version.js'
    $worker = Receive-AcceptanceResponse '/src/vendor/ram-worker.js'
    if ($version.status -ne 200 -or $version.body -notmatch [Regex]::Escape($package.version) -or $worker.status -ne 200 -or $worker.type -notmatch 'javascript') { throw 'Production host version/worker module response failed.' }
    if ($hostProcess.HasExited) { throw 'Production host exited during acceptance.' }
    $report.host = [ordered]@{status='PASS';origin=('http://127.0.0.1:' + $Port);indexStatus=$index.status;versionStatus=$version.status;workerStatus=$worker.status;csp=$index.csp}
    $report.status = 'PASS_NATIVE_WINDOWS_STARTUP'
} catch {
    $report.status = 'FAIL'
    $report.error = $_.Exception.Message
    Write-Host ('NATIVE ACCEPTANCE FAILED: ' + $_.Exception.Message)
} finally {
    if ($hostProcess) {
        if (-not $hostProcess.HasExited) { try { $hostProcess.Kill(); [void]$hostProcess.WaitForExit(5000) } catch {} }
        if ($hostProcess.HasExited -and $report.host) { $report.host.stdout = $hostStdout.GetAwaiter().GetResult(); $report.host.stderr = $hostStderr.GetAwaiter().GetResult() }
        $hostProcess.Dispose()
    }
    $report.finishedUtc = [DateTime]::UtcNow.ToString('o')
    Save-AcceptanceReport
}
Write-Host ('Acceptance evidence: ' + $reportPath)
if ($report.status -eq 'PASS_NATIVE_WINDOWS_STARTUP') { exit 0 }
exit 1
