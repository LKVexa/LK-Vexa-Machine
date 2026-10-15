# JA21 Silicon Console 2.4.0 - Windows PowerShell 5.1-compatible source.
# The .cmd contains this same readable payload so it also works as a one-file
# replacement launcher for an already extracted 2.1.0 package.
# No network script evaluation, npm install, elevation, or policy changes.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:LogPath = $null
$script:ExitCode = 1
$script:RuntimeLock = $null
$script:StagePath = $null

function Write-LaunchLog([string]$Message) {
    Write-Host $Message
    if ($script:LogPath) {
        [IO.File]::AppendAllText($script:LogPath, ('{0:u} {1}{2}' -f [DateTime]::UtcNow, $Message, [Environment]::NewLine))
    }
}

function Assert-PlainPath([string]$LiteralPath) {
    # Checking only the leaf misses a linked parent such as .runtime/downloads.
    $candidate = [IO.Path]::GetFullPath($LiteralPath)
    while ($candidate) {
        if (Test-Path -LiteralPath $candidate) {
            $item = Get-Item -LiteralPath $candidate -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "A private runtime/log path is a reparse point: $candidate. Use a normal local folder; no linked path will be written."
            }
        }
        $parent = [IO.Directory]::GetParent($candidate)
        if ($parent) { $candidate = $parent.FullName } else { $candidate = $null }
    }
}

function New-PrivateDirectory([string]$LiteralPath) {
    Assert-PlainPath $LiteralPath
    if (Test-Path -LiteralPath $LiteralPath) {
        if (-not (Test-Path -LiteralPath $LiteralPath -PathType Container)) {
            throw "Expected a directory: $LiteralPath"
        }
    } else {
        [void][IO.Directory]::CreateDirectory($LiteralPath)
    }
    Assert-PlainPath $LiteralPath
}

function Assert-FileHash([string]$LiteralPath, [string]$Expected) {
    Assert-PlainPath $LiteralPath
    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
        throw "Missing runtime file: $LiteralPath"
    }
    # Core .NET is available with PowerShell 5.1 even when optional module
    # discovery (and therefore Get-FileHash) is unavailable.
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = $null
    try {
        $stream = [IO.File]::Open($LiteralPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $actual = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally {
        if ($stream) { $stream.Dispose() }
        $algorithm.Dispose()
    }
    if (-not [string]::Equals($actual, $Expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw "SHA-256 mismatch: $LiteralPath. Nothing from this file was executed. Remove ONLY the affected private runtime file/directory and retry; do not clear browser data."
    }
}

function Receive-RuntimeArchive([string]$Url, [string]$Destination, [string]$Expected) {
    $uri = [Uri]$Url
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'nodejs.org' -or $uri.Port -ne 443 -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
        throw 'Only the fixed official Node.js HTTPS release URL is permitted.'
    }
    Assert-PlainPath $Destination
    $temporary = $Destination + '.part-' + [Guid]::NewGuid().ToString('N')
    $response = $null
    $source = $null
    $sink = $null
    $request = $null
    try {
        Write-LaunchLog ('Downloading official runtime: ' + $Url)
        # This changes TLS selection in this process only, not Windows policy.
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $request = [Net.HttpWebRequest]::Create($uri)
        $request.Method = 'GET'
        $request.AllowAutoRedirect = $false
        $request.Timeout = 30000
        $request.ReadWriteTimeout = 30000
        $request.UserAgent = 'JA21-Silicon-Console/2.4.0'
        # Use Windows' configured proxy and normal certificate validation.
        $request.Proxy = [Net.WebRequest]::GetSystemWebProxy()
        if ($request.Proxy) { $request.Proxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials }
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200) {
            throw ('Download returned HTTP ' + [int]$response.StatusCode + '. Redirects are not followed.')
        }
        $maxBytes = 100MB
        if ($response.ContentLength -gt $maxBytes) { throw 'Runtime download exceeds the 100 MiB limit.' }
        $source = $response.GetResponseStream()
        $sink = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $buffer = New-Object byte[] 65536
        $total = [long]0
        $lastProgress = [long]0
        $clock = [Diagnostics.Stopwatch]::StartNew()
        while (($count = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $count
            if ($total -gt $maxBytes) { throw 'Runtime download exceeds the 100 MiB limit.' }
            if ($clock.Elapsed.TotalSeconds -gt 300) { throw 'Runtime download exceeded its transfer deadline.' }
            $sink.Write($buffer, 0, $count)
            if (($total - $lastProgress) -ge 8MB) {
                Write-LaunchLog ('  Received {0:N1} MiB' -f ($total / 1MB))
                $lastProgress = $total
            }
        }
        if ($total -eq 0 -or ($response.ContentLength -ge 0 -and $total -ne $response.ContentLength)) {
            throw 'The runtime download was empty or incomplete.'
        }
        $sink.Dispose(); $sink = $null
        Assert-FileHash $temporary $Expected
        [IO.File]::Move($temporary, $Destination)
        Write-LaunchLog 'Archive SHA-256 verified before extraction.'
    } finally {
        if ($sink) { $sink.Dispose() }
        if ($source) { $source.Dispose() }
        if ($response) { $response.Close() }
        if ($request) { $request.Abort() }
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

function Expand-MinimalRuntime([string]$ArchivePath, [string]$ExpectedFolder, [string]$StagePath) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        # Extract ONLY these exact regular entries, never archive-provided paths.
        foreach ($name in @('node.exe', 'LICENSE', 'README.md')) {
            $fullName = $ExpectedFolder + '/' + $name
            $matches = @($zip.Entries | Where-Object { $_.FullName -ceq $fullName })
            if ($matches.Count -ne 1) { throw "Expected one archive entry: $fullName" }
            $entry = $matches[0]
            $limit = 128MB
            if ($name -ne 'node.exe') { $limit = 2MB }
            if ($entry.Length -le 0 -or $entry.Length -gt $limit) { throw "Invalid archive entry length: $fullName" }
            $inputStream = $null
            $outputStream = $null
            try {
                $inputStream = $entry.Open()
                $target = Join-Path $StagePath $name
                $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                $buffer = New-Object byte[] 65536
                $written = [long]0
                while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $written += $read
                    if ($written -gt $limit -or $written -gt $entry.Length) { throw "Oversized entry: $fullName" }
                    $outputStream.Write($buffer, 0, $read)
                }
                if ($written -ne $entry.Length) { throw "Incomplete archive entry: $fullName" }
            } finally {
                if ($outputStream) { $outputStream.Dispose() }
                if ($inputStream) { $inputStream.Dispose() }
            }
        }
    } finally { $zip.Dispose() }
}

function Resolve-WindowsRuntimeArchitecture([string]$NativeArchitecture) {
    if ([string]::IsNullOrWhiteSpace($NativeArchitecture)) { throw 'Windows did not report its native architecture.' }
    switch ($NativeArchitecture.ToUpperInvariant()) {
        'X64' { return 'x64' }
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        default { throw "Unsupported Windows architecture: $NativeArchitecture. This build requires x64 or ARM64 Windows." }
    }
}

function Get-WindowsRuntimeArchitecture {
    # OSArchitecture refers to Windows itself, even when PowerShell runs under
    # WOW64/emulation. Older .NET Framework installations may lack this type.
    $nativeArchitecture = $null
    try { $nativeArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch {}
    if (-not $nativeArchitecture) {
        $nativeArchitecture = $env:PROCESSOR_ARCHITEW6432
        if (-not $nativeArchitecture) { $nativeArchitecture = $env:PROCESSOR_ARCHITECTURE }
    }
    return Resolve-WindowsRuntimeArchitecture $nativeArchitecture
}

function Assert-RuntimeMachine([string]$NodePath, [string]$ExpectedArchitecture) {
    Assert-PlainPath $NodePath
    $expectedMachine = switch ($ExpectedArchitecture) {
        'x64' { 0x8664 }
        'arm64' { 0xAA64 }
        default { throw "Unknown expected runtime architecture: $ExpectedArchitecture" }
    }
    $stream = $null
    $reader = $null
    try {
        $stream = [IO.File]::Open($NodePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $reader = New-Object IO.BinaryReader($stream)
        if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5A4D) { throw 'Runtime has no valid DOS/PE header.' }
        $stream.Position = 0x3C
        $peOffset = $reader.ReadUInt32()
        if ($peOffset -lt 64 -or [long]$peOffset + 26 -gt $stream.Length) { throw 'Runtime PE header offset is outside the executable.' }
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Runtime has no valid PE signature.' }
        $machine = $reader.ReadUInt16()
        $stream.Position = [long]$peOffset + 20
        $optionalLength = $reader.ReadUInt16()
        if ($optionalLength -lt 2 -or [long]$peOffset + 24 + $optionalLength -gt $stream.Length) { throw 'Runtime PE optional header is truncated.' }
        $stream.Position = [long]$peOffset + 24
        if ($reader.ReadUInt16() -ne 0x020B) { throw 'Runtime must use a 64-bit PE32+ executable header.' }
        if ($machine -ne $expectedMachine) { throw ('Runtime PE machine 0x{0:X4} does not match Windows {1}.' -f $machine, $ExpectedArchitecture) }
    } finally {
        if ($reader) { $reader.Dispose() } elseif ($stream) { $stream.Dispose() }
    }
}

function Confirm-Runtime([string]$NodePath, [string]$ExpectedVersion, [string]$ExpectedArchitecture) {
    Assert-RuntimeMachine $NodePath $ExpectedArchitecture
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $NodePath
    $info.Arguments = '-p "JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'Windows did not start the private Node.js executable.' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            try { $process.Kill() } catch {}
            throw 'Private Node.js version probe timed out.'
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
        $stderr = $stderrTask.GetAwaiter().GetResult().Trim()
        if ($process.ExitCode -ne 0) {
            throw ('Private Node.js runtime probe failed. Exit={0}; stdout={1}; stderr={2}' -f $process.ExitCode, $stdout, $stderr)
        }
        try { $probe = $stdout | ConvertFrom-Json } catch { throw 'Private Node.js runtime probe did not return valid JSON.' }
        if ($probe.version -cne ('v' + $ExpectedVersion) -or $probe.arch -cne $ExpectedArchitecture -or $probe.platform -cne 'win32') {
            throw ('Private Node.js runtime identity mismatch. Expected v{0}/win32/{1}; stdout={2}' -f $ExpectedVersion, $ExpectedArchitecture, $stdout)
        }
        Write-LaunchLog ('Verified executable reports {0} / {1} / {2}' -f $probe.version, $probe.platform, $probe.arch)
    } catch {
        throw ('Private runtime could not run: ' + $_.Exception.Message + '. Security controls were not disabled. Check the Windows error and launcher log.')
    } finally { $process.Dispose() }
}

try {
    if ($PSVersionTable.PSVersion -lt [Version]'5.1') { throw 'Windows PowerShell 5.1 or newer is required.' }
    if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
        throw 'Windows has restricted PowerShell language features. This launcher will not bypass that policy. Ask the device administrator to approve this application.'
    }
    $root = [IO.Path]::GetFullPath($env:JA21_BOOTSTRAP_ROOT)
    $mode = $env:JA21_BOOTSTRAP_MODE
    if ([string]::IsNullOrWhiteSpace($mode)) { $mode = '--start' }
    if ($mode -notin @('--start', '--verify', '--preflight', '--websocket')) { throw 'Usage: Start-Console.cmd [--verify | --preflight | --websocket]' }
    if ($env:JA21_BOOTSTRAP_EXTRA) { throw 'Unexpected argument. Usage: Start-Console.cmd [--verify | --preflight | --websocket]' }
    foreach ($required in @('package.json', 'src/version.js', 'scripts/serve.mjs', 'scripts/build.mjs', 'scripts/verify.mjs')) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $required) -PathType Leaf)) {
            throw "Missing package file: $required. Put this launcher beside package.json in the fully extracted console folder, not beside the ZIP."
        }
    }
    $package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    if ($package.name -ne 'ja21-silicon-console' -or $package.version -notin @('2.1.0', '2.1.1', '2.2.0', '2.2.1', '2.2.2', '2.3.0', '2.4.0')) {
        throw 'This launcher supports JA21 Silicon Console 2.1.0, 2.1.1, 2.2.0, 2.2.1, 2.2.2, 2.3.0 and 2.4.0 only.'
    }
    if ($mode -eq '--websocket' -and $package.version -ne '2.4.0') { throw 'The WebSocket relay requires engine 2.4.0. Use the default launch mode for an older package.' }
    Set-Location -LiteralPath $root
    [Environment]::CurrentDirectory = $root
    $logs = Join-Path $root 'logs'
    New-PrivateDirectory $logs
    $script:LogPath = Join-Path $logs ('launcher-{0}-{1}.log' -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'), $PID)
    Write-LaunchLog ('JA21 launcher 2.4.0 | application ' + $package.version)
    Write-LaunchLog ('Package: ' + $root)
    Write-LaunchLog ('Log: ' + $script:LogPath)
    # Environment cleanup is limited to this launcher/child process. PATH is untouched.
    foreach ($name in @('NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_ICU_DATA', 'NODE_REDIRECT_WARNINGS', 'NODE_V8_COVERAGE', 'OPENSSL_CONF', 'OPENSSL_MODULES', 'SSLKEYLOGFILE')) {
        [Environment]::SetEnvironmentVariable($name, $null, [EnvironmentVariableTarget]::Process)
    }
    $port = 8788
    if ($env:JA21_PORT) {
        if (-not [int]::TryParse($env:JA21_PORT, [ref]$port) -or $port -lt 1024 -or $port -gt 65535) {
            throw 'JA21_PORT must be an integer in 1024..65535. The default 8788 preserves the existing browser-storage origin.'
        }
    }
    $arch = Get-WindowsRuntimeArchitecture
    $nodeVersion = '24.21.0'
    $pins = @{
        x64 = @{
            Archive = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
            Exe = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'
        }
        arm64 = @{
            Archive = '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921'
            Exe = 'dff59da18b6ffe1bf1ca99e1d2af4906080c481740619f5b5098c0fca28bd9b7'
        }
    }
    $pin = $pins[$arch]
    $runtimeRoot = Join-Path $root '.runtime'
    New-PrivateDirectory $runtimeRoot
    $lockPath = Join-Path $runtimeRoot 'bootstrap.lock'
    Assert-PlainPath $lockPath
    try {
        $script:RuntimeLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch { throw 'Another launcher is provisioning the private runtime, or the runtime folder is not writable. Close the other startup window and retry.' }
    $folder = 'node-v' + $nodeVersion + '-win-' + $arch
    $runtime = Join-Path $runtimeRoot $folder
    $node = Join-Path $runtime 'node.exe'
    Assert-PlainPath $runtime
    Write-LaunchLog ('Private runtime: Node.js ' + $nodeVersion + ' / Windows ' + $arch)
    if (-not (Test-Path -LiteralPath $runtime)) {
        $downloads = Join-Path $runtimeRoot 'downloads'
        New-PrivateDirectory $downloads
        $archiveName = $folder + '.zip'
        $archive = Join-Path $downloads $archiveName
        Assert-PlainPath $archive
        if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
            if ($env:JA21_OFFLINE -eq '1') {
                throw "Offline mode: copy the official $archiveName into $downloads, then retry. The downloaded ZIP must match the pinned SHA-256."
            }
            $url = 'https://nodejs.org/download/release/v' + $nodeVersion + '/' + $archiveName
            Receive-RuntimeArchive $url $archive $pin.Archive
        }
        Assert-FileHash $archive $pin.Archive
        $script:StagePath = Join-Path $runtimeRoot ('stage-' + [Guid]::NewGuid().ToString('N'))
        New-PrivateDirectory $script:StagePath
        Expand-MinimalRuntime $archive $folder $script:StagePath
        Assert-FileHash (Join-Path $script:StagePath 'node.exe') $pin.Exe
        Assert-RuntimeMachine (Join-Path $script:StagePath 'node.exe') $arch
        [IO.Directory]::Move($script:StagePath, $runtime)
        $script:StagePath = $null
        Write-LaunchLog 'Private runtime installed atomically; npm and global PATH were not used.'
    }
    Assert-FileHash $node $pin.Exe
    Assert-PlainPath (Join-Path $runtime 'LICENSE')
    if (-not (Test-Path -LiteralPath (Join-Path $runtime 'LICENSE') -PathType Leaf)) {
        throw 'The private runtime is incomplete: its upstream LICENSE is missing. Remove only its .runtime/node-v... directory and retry.'
    }
    Confirm-Runtime $node $nodeVersion $arch
    $script:RuntimeLock.Dispose(); $script:RuntimeLock = $null
    Write-LaunchLog ('Runtime path: ' + $node)
    if ($mode -eq '--preflight') {
        Write-LaunchLog 'PREFLIGHT PASS: package files and private runtime verified. Server/browser were not started.'
        $script:ExitCode = 0
    } else {
        if ($mode -eq '--verify') {
            $nodeArguments = @((Join-Path $root 'scripts/verify.mjs'))
            Write-LaunchLog 'Starting the application verification suite. Test output follows.'
        } else {
            $nodeArguments = @((Join-Path $root 'scripts/serve.mjs'), '--port', [string]$port)
            if ($mode -eq '--websocket') { $nodeArguments += '--websocket'; Write-LaunchLog 'WebSocket relay enabled on loopback. The browser XPU owner must connect before a web terminal can open.' }
            if ($env:JA21_NO_OPEN -ne '1') { $nodeArguments += '--open' }
            Write-LaunchLog 'Starting local host. Keep this window open; Ctrl+C stops the host.'
        }
        # Preserve the native exit status. In Windows PowerShell 5.1 stderr from
        # a native program must not become an early terminating PowerShell error.
        $ErrorActionPreference = 'Continue'
        try {
            & $node @nodeArguments
            $script:ExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = 'Stop' }
        if ($null -eq $script:ExitCode) { $script:ExitCode = 1 }
        Write-LaunchLog ('Application exit code: ' + $script:ExitCode)
    }
} catch {
    $script:ExitCode = 1
    $message = 'STARTUP/VERIFY FAILED: ' + $_.Exception.Message
    Write-Host ''
    try { Write-LaunchLog $message } catch { Write-Host $message }
    Write-Host 'No firewall, antivirus, execution-policy, registry, or system PATH settings were changed.'
    Write-Host 'The first private-runtime setup needs HTTPS access to nodejs.org, unless its exact ZIP is cached.'
    Write-Host 'Do not disable Windows security or clear browser storage to fix a runtime startup error.'
    if ($script:LogPath) { Write-Host ('Diagnostic log: ' + $script:LogPath) }
} finally {
    if ($script:RuntimeLock) { $script:RuntimeLock.Dispose() }
    if ($script:StagePath -and [IO.Directory]::Exists($script:StagePath)) {
        try {
            $stageFull = [IO.Path]::GetFullPath($script:StagePath)
            $runtimeFull = [IO.Path]::GetFullPath($runtimeRoot)
            if (-not [string]::Equals([IO.Path]::GetDirectoryName($stageFull), $runtimeFull, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($stageFull) -notmatch '^stage-[0-9a-f]{32}$') {
                throw 'Refusing to remove a staging directory outside the private runtime root.'
            }
            Assert-PlainPath $script:StagePath
            [IO.Directory]::Delete($script:StagePath, $true)
        } catch { Write-Host ('Temporary runtime staging folder retained: ' + $script:StagePath) }
    }
}
exit $script:ExitCode
