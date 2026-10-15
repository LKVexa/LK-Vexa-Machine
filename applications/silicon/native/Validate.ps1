[CmdletBinding()]
param(
    [string]$Dotnet = 'dotnet',
    [string]$Node = 'node',
    [string]$Python = 'python',
    [string]$WorkDirectory = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $WorkDirectory) { $WorkDirectory = Join-Path $root '.local\native-validation' }
$work = [IO.Path]::GetFullPath($WorkDirectory)
[void][IO.Directory]::CreateDirectory($work)
$env:DOTNET_CLI_HOME = Join-Path $work 'cli-home'
$env:APPDATA = Join-Path $work 'appdata'
$env:LOCALAPPDATA = Join-Path $work 'localappdata'
$env:NUGET_PACKAGES = Join-Path $work 'packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:DOTNET_ADD_GLOBAL_TOOLS_TO_PATH = 'false'
$project = Join-Path $PSScriptRoot 'ReferenceTests\ChipHarness.ReferenceTests.csproj'
$config = Join-Path $PSScriptRoot 'ReferenceTests\NuGet.Config'
$vectors = Join-Path $work 'vectors'
$results = Join-Path $work 'results'
[void][IO.Directory]::CreateDirectory($results)
$aggregatePath = Join-Path $results 'VALIDATION.json'
$aggregate = [ordered]@{
    status = 'RUNNING'
    stage = 'SDK'
    startedUtc = [DateTime]::UtcNow.ToString('o')
    sourceSha256 = (Get-FileHash -LiteralPath (Join-Path $root 'src\vendor\spiral\ChipHarness.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Save-Aggregate { $aggregate | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $aggregatePath -Encoding utf8 }
Save-Aggregate
# Invalidate only this runner's two report files before any subprocess can fail.
foreach ($name in @('native-results.json', 'native-tiff-results.json')) {
    @{status='INVALIDATED'; reason='A new native validation run has started.'; startedUtc=$aggregate.startedUtc} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $results $name) -Encoding utf8
}
$binary = Join-Path $work 'bin'
$intermediate = (Join-Path $work 'obj') + [IO.Path]::DirectorySeparatorChar
try {
    $sdkOutput = & $Dotnet --version
    if ($LASTEXITCODE -ne 0) { throw 'A .NET SDK with net8.0 targeting support is required.' }
    $env:JA21_NATIVE_SDK = ($sdkOutput -join "`n").Trim()
    $aggregate.sdk = $env:JA21_NATIVE_SDK
    $aggregate.stage = 'JavaScript vectors'; Save-Aggregate
    & $Node (Join-Path $root 'tests\native-vectors.mjs') $vectors
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript vector generation failed.' }
    $aggregate.stage = 'C# compilation'; Save-Aggregate
    & $Dotnet build $project --configuration Release "-p:RestoreConfigFile=$config" "-p:BaseIntermediateOutputPath=$intermediate" --output $binary
    if ($LASTEXITCODE -ne 0) { throw 'C# compilation failed.' }
    $aggregate.stage = 'Native assertions'; Save-Aggregate
    & $Dotnet (Join-Path $binary 'ChipHarness.ReferenceTests.dll') $vectors $results
    if ($LASTEXITCODE -ne 0) { throw 'Native C# validation failed.' }
    $aggregate.stage = 'Independent TIFF decode'; Save-Aggregate
    & $Python (Join-Path $root 'tests\native-tiff.py') $vectors $results
    if ($LASTEXITCODE -ne 0) { throw 'Independent TIFF verification failed; Pillow is required.' }
    $native = Get-Content -LiteralPath (Join-Path $results 'native-results.json') -Raw | ConvertFrom-Json
    $tiff = Get-Content -LiteralPath (Join-Path $results 'native-tiff-results.json') -Raw | ConvertFrom-Json
    if ($native.status -ne 'PASS' -or $tiff.status -ne 'PASS' -or $native.sourceSha256 -ne $aggregate.sourceSha256) {
        throw 'Native result status or source checksum disagrees with this run.'
    }
    $aggregate.assertions = $native.assertions
    $aggregate.nativeTiffs = $tiff.nativeTiffs
    $aggregate.pixelsPerImplementation = $tiff.pixelsPerImplementation
    $aggregate.status = 'PASS'
    $aggregate.stage = 'Complete'
    Write-Host "Native C#/JavaScript/Pillow validation PASS. Reports: $results"
} catch {
    $aggregate.status = 'FAIL'
    $aggregate.error = $_.Exception.Message
    throw
} finally {
    $aggregate.finishedUtc = [DateTime]::UtcNow.ToString('o')
    Save-Aggregate
}
