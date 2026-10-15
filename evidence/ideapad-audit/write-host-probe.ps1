# Read-only hardware identification. Run under the configured PowerShell policy.
# Serial numbers and credentials are deliberately not collected.
param([string]$OutputPath = (Join-Path $PSScriptRoot 'host/HOST_PROBE.json'))
$ErrorActionPreference = 'Stop'
function Decode-CpuWords([int[]]$words) {
    $value = ''
    foreach ($word in $words) { $value += [Text.Encoding]::ASCII.GetString([BitConverter]::GetBytes($word)) }
    return $value
}
$zero = [System.Runtime.Intrinsics.X86.X86Base]::CpuId(0, 0)
$one = [System.Runtime.Intrinsics.X86.X86Base]::CpuId(1, 0)
$brand = ''
foreach ($leaf in -2147483646..-2147483644) {
    $row = [System.Runtime.Intrinsics.X86.X86Base]::CpuId($leaf, 0)
    $brand += Decode-CpuWords @($row.Item1, $row.Item2, $row.Item3, $row.Item4)
}
$bios = 'HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\BIOS'
$report = [ordered]@{
    schema = 'JA21/HOST_PROBE/1'
    timestampUtc = [DateTime]::UtcNow.ToString('o')
    manufacturer = [Microsoft.Win32.Registry]::GetValue($bios, 'SystemManufacturer', $null)
    model = [Microsoft.Win32.Registry]::GetValue($bios, 'SystemProductName', $null)
    family = [Microsoft.Win32.Registry]::GetValue($bios, 'SystemFamily', $null)
    registryProcessor = [Microsoft.Win32.Registry]::GetValue('HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\CentralProcessor\0', 'ProcessorNameString', $null).Trim()
    cpuid = [ordered]@{
        available = [System.Runtime.Intrinsics.X86.X86Base]::IsSupported
        vendor = Decode-CpuWords @($zero.Item2, $zero.Item4, $zero.Item3)
        brand = $brand.Trim([char]0, ' ')
        family = ($one.Item1 -shr 8) -band 15
        model = (($one.Item1 -shr 4) -band 15) -bor ((($one.Item1 -shr 16) -band 15) -shl 4)
        stepping = $one.Item1 -band 15
        hypervisorPresent = ($one.Item3 -band [int]::MinValue) -ne 0
        leaf1 = @($one.Item1, $one.Item2, $one.Item3, $one.Item4)
    }
    processArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    osArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    osVersion = [Environment]::OSVersion.VersionString
    logicalProcessorsAvailableToProcess = [Environment]::ProcessorCount
    probeRuntime = [System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription
    avx2Support = [System.Runtime.Intrinsics.X86.Avx2]::IsSupported
    limitation = 'Registry and process CPUID identify the execution host, not manufacturing authenticity. Hypervisor presence may reflect Windows virtualization security; no JA21 hardware acceleration is established.'
}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
