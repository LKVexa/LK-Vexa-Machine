param([string]$StartUrl, [switch]$Preflight)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Assert-JA21ConsolePath {
    param([Parameter(Mandatory=$true)][string]$Path)
    $candidate = [IO.Path]::GetFullPath($Path)
    while ($candidate) {
        if (Test-Path -LiteralPath $candidate) {
            if (((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Console paths must not traverse a symbolic link or junction: $candidate"
            }
        }
        $parent = [IO.Directory]::GetParent($candidate)
        if ($parent) { $candidate = $parent.FullName } else { $candidate = $null }
    }
    return [IO.Path]::GetFullPath($Path)
}

function Get-JA21SoftwareConsoleConfiguration {
    param([Parameter(Mandatory=$true)][string]$PackageRoot, [string]$RequestedUrl)
    $PackageRoot = Assert-JA21ConsolePath $PackageRoot
    $files = @('console.json','CONSOLE_BUILD.json','CONSOLE_VERSION','host/Start-JA21Browser.ps1','applications/silicon/package.json','applications/silicon/VERSION','applications/silicon/dist/index.html','applications/silicon/dist/release.json','applications/silicon/dist/src/app.js','applications/silicon/dist/src/vendor/ram-worker.js','applications/silicon/dist/src/version.js')
    foreach ($relative in $files) {
        $path = Assert-JA21ConsolePath (Join-Path $PackageRoot $relative)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Software CPU console file is missing: $relative" }
    }
    $settings = Get-Content -LiteralPath (Join-Path $PackageRoot 'console.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $build = Get-Content -LiteralPath (Join-Path $PackageRoot 'CONSOLE_BUILD.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $version = (Get-Content -LiteralPath (Join-Path $PackageRoot 'CONSOLE_VERSION') -Raw -Encoding UTF8).Trim()
    if ($build.software_cpu_console -ne $true -or $build.console_version -cne $version -or $build.silicon_version -cne '2.3.0') { throw 'This launcher requires the combined JA21 software CPU console build and matching release metadata.' }
    $silicon = Get-Content -LiteralPath (Join-Path $PackageRoot 'applications/silicon/package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $siliconVersion = (Get-Content -LiteralPath (Join-Path $PackageRoot 'applications/silicon/VERSION') -Raw -Encoding UTF8).Trim()
    $distribution = Get-Content -LiteralPath (Join-Path $PackageRoot 'applications/silicon/dist/release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($silicon.name -cne 'ja21-silicon-console' -or $silicon.version -cne $build.silicon_version -or $siliconVersion -cne $silicon.version -or $distribution.version -cne $silicon.version) { throw 'The installed software CPU release and built browser distribution disagree.' }
    $origin = 'https://ja21-silicon.invalid'
    $defaultUrl = $origin + '/'
    if ([string]$settings.start_url -cne $defaultUrl -or @($settings.local_origins) -notcontains $origin) { throw 'The combined console must default to its fixed local HTTPS software CPU origin.' }
    if ([string]::IsNullOrWhiteSpace($RequestedUrl)) { $RequestedUrl = $defaultUrl }
    if ($RequestedUrl -cne $defaultUrl -and $RequestedUrl -cne 'about:blank') { throw 'StartUrl must be the fixed software CPU console URL or the explicit about:blank option.' }
    return [pscustomobject]@{Root=$PackageRoot;Settings=$settings;Build=$build;StartUrl=$RequestedUrl;SiliconVersion=$silicon.version;Origin=$origin}
}

if ($PSVersionTable.PSVersion -lt [Version]'5.1' -or $PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) { throw 'This console requires 64-bit Windows PowerShell 5.1 and the Windows WPF host.' }
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { throw 'Windows PowerShell language restrictions prevent this host. The launcher will not disable them.' }
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'Start this console using its Windows PowerShell -STA launcher.' }
if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) { throw 'Invoke the saved Start-Console.ps1 normally so its script paths retain their file context.' }
$console = Get-JA21SoftwareConsoleConfiguration -PackageRoot (Split-Path -Parent $PSScriptRoot) -RequestedUrl $StartUrl
$consolePackageRoot = $console.Root
if ($Preflight) {
    Write-Host ('PREFLIGHT PASS: JA21 console {0}; software CPU {1}; start {2}' -f $console.Build.console_version, $console.SiliconVersion, $console.StartUrl)
    Write-Host ('Windows PowerShell {0}; native process is 64-bit; STA; FullLanguage.' -f $PSVersionTable.PSVersion)
    Write-Host 'Scope: configuration and local files only. WPF/WebView2, JavaScript CPU execution and browser persistence were not started or validated.'
    return
}
$env:JA21_CONSOLE_MODE = '1'
$env:JA21_REDUCED_MOTION = '1'
$env:JA21_ALLOW_PRIVATE_HOSTS = '0'
$env:JA21_REQUIRE_LIVE_WEB = '1'
$env:JA21_CONSOLE_ORIGINS = @($console.Settings.local_origins) -join ';'
$env:JA21_PORTABLE_ROOT = Join-Path $consolePackageRoot 'workspace'
try {
    & (Join-Path $PSScriptRoot 'Start-JA21Browser.ps1') -Root $consolePackageRoot -StartUrl $console.StartUrl
} catch {
    $consoleErrorPath = Join-Path $consolePackageRoot 'workspace\logs\console-error.txt'
    $consoleFailure = $_
    try {
        $null = Assert-JA21ConsolePath $consoleErrorPath
        [void][IO.Directory]::CreateDirectory((Split-Path -Parent $consoleErrorPath))
        ($consoleFailure | Out-String) | Set-Content -LiteralPath $consoleErrorPath -Encoding UTF8
    } catch { }
    throw
}
