/** Static launcher contracts; these do NOT execute Windows PowerShell or cmd.exe. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const load=async name=>fs.readFile(new URL(name,root),'utf8');
const cmd=await load('Start-Console.cmd');
const ps=await load('scripts/windows/bootstrap.ps1');
const header=await load('scripts/windows/launcher-header.txt');
const pins=JSON.parse(await load('scripts/windows/runtime-lock.json'));
const norm=s=>s.replace(/\r\n/g,'\n');
const marker='#==JA21_POWERSHELL_PAYLOAD==';

test('launcher/static: generated .cmd embeds the exact readable reviewed payload',()=>{
 assert.equal(norm(cmd),norm(header).trimEnd()+'\n'+marker+'\n'+norm(ps));
 assert(cmd.includes('\r\n'));
 assert(!/(?<!\r)\n/.test(cmd),'launcher uses Windows CRLF');
});
test('launcher/static: the local payload starts after the LAST marker',()=>{
 assert.match(header,/LastIndexOf\(\$m,\[StringComparison\]::Ordinal\)/);
 const extracted=cmd.slice(cmd.lastIndexOf(marker)+marker.length).replace(/^\r?\n/,'');
 assert.equal(norm(extracted),norm(ps));
 assert.match(header,/exit \/b 1\s*$/);
});
test('launcher/static: system PowerShell is absolute and package paths pass as environment values',()=>{
 assert.match(header,/%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
 assert.match(header,/%SystemRoot%\\Sysnative\\WindowsPowerShell/);
 assert.match(header,/DisableDelayedExpansion/);
 assert.match(header,/JA21_BOOTSTRAP_SELF=%~f0/);
 assert.match(header,/JA21_BOOTSTRAP_ROOT=%~dp0/);
 const command=header.split('\n').find(x=>x.includes(' -Command '));
 assert(!command.includes('%~dp0')); assert(!command.includes('%~f0'));
});
test('launcher/static: neither launcher relies on a global Node or npm installation',async()=>{
 const nonComments=cmd.split(/\r?\n/).filter(line=>!/^\s*#/.test(line)).join('\n');
 assert(!/\bwhere\s+node|\bnpm\s+install|\bwinget\b|\bmsiexec\b/i.test(nonComments));
 assert.match(ps,/& \$node @nodeArguments/);
 const verify=await load('Verify.cmd');
 assert.match(verify,/Start-Console\.cmd" --verify/);
 assert(!/where node|node scripts/i.test(verify));
});
test('launcher/static: no security-policy or certificate bypass commands',()=>{
 for(const pattern of [/Set-ExecutionPolicy/i,/-ExecutionPolicy\s+Bypass/i,/Unblock-File/i,/ServerCertificateValidationCallback/i,/SkipCertificateCheck/i,/netsh/i,/Set-MpPreference/i,/Start-Process[^\n]+-Verb\s+RunAs/i]) assert(!pattern.test(cmd),String(pattern));
 assert.match(ps,/LanguageMode -ne 'FullLanguage'/);
});
test('launcher/static: pins match the exact official v24.21.0 checksum values',()=>{
 assert.equal(pins.nodeVersion,'24.21.0');
 assert.equal(pins.architectures.x64.archiveSha256,'158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541');
 assert.equal(pins.architectures.x64.exeSha256,'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32');
 assert.equal(pins.architectures.arm64.archiveSha256,'8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921');
 assert.equal(pins.architectures.arm64.exeSha256,'dff59da18b6ffe1bf1ca99e1d2af4906080c481740619f5b5098c0fca28bd9b7');
 for(const a of Object.values(pins.architectures)){
  assert(ps.includes(a.archiveSha256));assert(ps.includes(a.exeSha256));
  assert.match(a.archive,new RegExp(`^node-v${pins.nodeVersion.replaceAll('.','\\.')}-win-(x64|arm64)\\.zip$`));
 }
});
test('launcher/static: native Windows architecture uses OSArchitecture before legacy environment fallback',()=>{
 assert(ps.indexOf('[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture')<ps.indexOf('$nativeArchitecture = $env:PROCESSOR_ARCHITEW6432'));
 assert(ps.indexOf('$nativeArchitecture = $env:PROCESSOR_ARCHITEW6432')<ps.indexOf('$nativeArchitecture = $env:PROCESSOR_ARCHITECTURE'));
 assert.match(ps,/'AMD64' \{ return 'x64' \}/);
 assert.match(ps,/'ARM64' \{ return 'arm64' \}/);
 assert.match(ps,/\$arch = Get-WindowsRuntimeArchitecture/);
 assert.match(ps,/default \{ throw "Unsupported Windows architecture/);
});
test('launcher/static: HTTPS host/port is restricted and automatic redirects are disabled',()=>{
 assert.match(ps,/\$uri\.Scheme -ne 'https'/);assert.match(ps,/\$uri\.Host -ne 'nodejs\.org'/);
 assert.match(ps,/\$uri\.Port -ne 443/);assert.match(ps,/AllowAutoRedirect = \$false/);
 assert.match(ps,/https:\/\/nodejs\.org\/download\/release\/v/);
});
test('launcher/static: download has size, read, request and total transfer limits',()=>{
 assert.match(ps,/\$maxBytes = 100MB/); assert.match(ps,/Timeout = 30000/);
 assert.match(ps,/ReadWriteTimeout = 30000/);assert.match(ps,/Elapsed\.TotalSeconds -gt 300/);
 assert.match(ps,/\$total -ne \$response\.ContentLength/);
});
test('launcher/static: downloaded bytes are hashed before promotion; extraction follows archive verification',()=>{
 assert(ps.indexOf('Assert-FileHash $temporary $Expected')<ps.indexOf('[IO.File]::Move($temporary, $Destination)'));
 const main=ps.slice(ps.indexOf("$nodeVersion = '24.21.0'"));
 assert(main.indexOf('Assert-FileHash $archive $pin.Archive')<main.indexOf('Expand-MinimalRuntime $archive'));
 assert(main.indexOf("Assert-FileHash (Join-Path $script:StagePath 'node.exe') $pin.Exe")<main.indexOf('[IO.Directory]::Move($script:StagePath, $runtime)'));
 assert(main.indexOf('Assert-FileHash $node $pin.Exe')<main.indexOf('Confirm-Runtime $node'));
});
test('launcher/static: extraction is exact allowlisted entries, not archive path expansion',()=>{
 assert.deepEqual(pins.extraction,['node.exe','LICENSE','README.md']);
 assert.match(ps,/@\('node\.exe', 'LICENSE', 'README\.md'\)/);
 assert.match(ps,/\$matches\.Count -ne 1/);assert.match(ps,/Join-Path \$StagePath \$name/);
 assert.match(ps,/\$written -gt \$limit -or \$written -gt \$entry\.Length/);
 assert(!/Expand-Archive|ExtractToDirectory/.test(ps));
});
test('launcher/static: writable runtime locations reject reparse points and concurrent setup',()=>{
 assert.match(ps,/FileAttributes\]::ReparsePoint/);
 assert.match(ps,/Assert-PlainPath \$runtimeRoot|New-PrivateDirectory \$runtimeRoot/);
 assert.match(ps,/bootstrap\.lock/);assert.match(ps,/FileShare\]::None/);
 assert.match(ps,/RuntimeLock\.Dispose\(\)/);
});
test('launcher/static: partial downloads and staging are scoped, private, and cleaned',()=>{
 assert.match(ps,/\.part-' \+ \[Guid\]::NewGuid/);
 assert.match(ps,/'stage-' \+ \[Guid\]::NewGuid/);
 assert.match(ps,/\[IO\.File\]::Delete\(\$temporary\)/);
 assert.match(ps,/\[IO\.Directory\]::Delete\(\$script:StagePath, \$true\)/);
 assert(!/Delete\(\$root|Remove-Item[^\n]+\$root/.test(ps));
});
test('launcher/static: process-local Node injection settings are removed without editing PATH',()=>{
 for(const key of ['NODE_OPTIONS','NODE_PATH','OPENSSL_CONF','SSLKEYLOGFILE']) assert(ps.includes(`'${key}'`));
 assert.match(ps,/EnvironmentVariableTarget\]::Process/);
 assert(!/SetEnvironmentVariable\(['"]PATH/i.test(ps));
 assert(!/set\s+"?PATH=/i.test(header));
});
test('launcher/static: exact runtime version/platform/architecture probe is bounded before the host runs',()=>{
 assert.match(ps,/JSON.stringify\(\{version:process.version,arch:process.arch,platform:process.platform\}\)/);
 assert.match(ps,/\$process\.WaitForExit\(15000\)/);
 assert.match(ps,/\$probe\.version -cne \('v' \+ \$ExpectedVersion\)/);
 assert.match(ps,/\$probe\.arch -cne \$ExpectedArchitecture/);
 assert.match(ps,/\$probe\.platform -cne 'win32'/);
 assert.match(ps,/Assert-RuntimeMachine \$NodePath \$ExpectedArchitecture/);
 assert.match(ps,/\$info\.UseShellExecute = \$false/);
});
test('launcher/static: default origin is unchanged and port override is explicitly validated',()=>{
 assert.match(ps,/\$port = 8788/);
 assert.match(ps,/\$port -lt 1024 -or \$port -gt 65535/);
 assert.match(ps,/\$env:JA21_NO_OPEN -ne '1'/);
 assert.match(ps,/\$nodeArguments \+= '--open'/);
});
test('launcher/static: offline cache and preflight modes are explicit',()=>{
 assert.match(ps,/\$env:JA21_OFFLINE -eq '1'/);
 assert.match(ps,/\$mode -eq '--preflight'/);
 assert.match(ps,/Server\/browser were not started/);
 assert.match(ps,/\$package\.version -notin @\('2\.1\.0', '2\.1\.1', '2\.2\.0', '2\.2\.1', '2\.2\.2', '2\.3\.0', '2\.4\.0'\)/);
});
test('launcher/static: logs and native error status are retained',()=>{
 assert.match(ps,/launcher-\{0\}-\{1\}\.log/);
 assert.match(ps,/\$script:ExitCode = \$LASTEXITCODE/);
 assert.match(ps,/exit \$script:ExitCode/);
 assert.match(header,/set "JA21_RESULT=%ERRORLEVEL%"/);
 assert.match(header,/exit \/b %JA21_RESULT%/);
});
