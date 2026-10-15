/** Native PowerShell contract execution on the current Windows host.
 * Synthetic ARM64 PE bytes are parsed, never executed; this is not ARM64 startup.
 * Run scripts/windows/native-acceptance.ps1 on actual Windows ARM64 for that gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const loadFunctions=String.raw`$ErrorActionPreference='Stop'
$script:LogPath=$null
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:JA21_TEST_PAYLOAD,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
foreach($function in $ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]}){. ([ScriptBlock]::Create($function.Extent.Text))}
`;
function run(source,env={}){
 const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const result=spawnSync(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',loadFunctions+source],{encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,JA21_TEST_PAYLOAD:path.join(root,'scripts/windows/bootstrap.ps1'),...env}});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;
}

test('launcher/native: x64/ARM64 resolver accepts native names and refuses unsupported/null names',{skip:process.platform!=='win32'},()=>{
 const output=run(String.raw`
foreach($entry in @(@('X64','x64'),@('AMD64','x64'),@('ARM64','arm64'),@('aRm64','arm64'))){if((Resolve-WindowsRuntimeArchitecture $entry[0]) -cne $entry[1]){throw 'Wrong architecture selection'}}
foreach($unsupported in @('x86','IA64','ARM','', 'x64 ', $null)){
 $rejected=$false;try{Resolve-WindowsRuntimeArchitecture $unsupported}catch{$rejected=$true}
 if(-not $rejected){throw 'Unsupported native architecture accepted'}
}
$native=[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
$env:PROCESSOR_ARCHITEW6432='ARM';$env:PROCESSOR_ARCHITECTURE='x86'
if((Get-WindowsRuntimeArchitecture) -cne (Resolve-WindowsRuntimeArchitecture $native)){throw 'Process environment overrode native OS architecture'}
[Console]::WriteLine('architecture-contract-pass')
`);
 assert.match(output,/architecture-contract-pass/);
});

test('launcher/native: PE machine and PE32+ checks reject swapped, truncated and malformed runtime headers',{skip:process.platform!=='win32'},async t=>{
 await fs.mkdir(path.join(root,'audit'),{recursive:true});
 const dir=await fs.mkdtemp(path.join(root,'audit','.machine-fixture-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const pe=machine=>{const bytes=Buffer.alloc(512);bytes.writeUInt16LE(0x5a4d,0);bytes.writeUInt32LE(128,0x3c);bytes.writeUInt32LE(0x4550,128);bytes.writeUInt16LE(machine,132);bytes.writeUInt16LE(240,148);bytes.writeUInt16LE(0x20b,152);return bytes;};
 await fs.writeFile(path.join(dir,'x64.exe'),pe(0x8664));await fs.writeFile(path.join(dir,'arm64.exe'),pe(0xaa64));
 const corruptions=[['short.exe',Buffer.alloc(63)],['no-mz.exe',Buffer.alloc(512)],['bad-offset.exe',pe(0xaa64)],['bad-signature.exe',pe(0xaa64)],['bad-magic.exe',pe(0xaa64)],['bad-optional-length.exe',pe(0xaa64)]];
 corruptions[2][1].writeUInt32LE(0xffffffff,0x3c);corruptions[3][1].writeUInt32LE(0,128);corruptions[4][1].writeUInt16LE(0x10b,152);corruptions[5][1].writeUInt16LE(512,148);
 for(const [name,bytes] of corruptions)await fs.writeFile(path.join(dir,name),bytes);
 const output=run(String.raw`
$dir=$env:JA21_TEST_DIRECTORY
Assert-RuntimeMachine (Join-Path $dir 'x64.exe') 'x64'
Assert-RuntimeMachine (Join-Path $dir 'arm64.exe') 'arm64'
foreach($pair in @(@('x64.exe','arm64'),@('arm64.exe','x64'))){
 $rejected=$false;try{Assert-RuntimeMachine (Join-Path $dir $pair[0]) $pair[1]}catch{if($_.Exception.Message -match 'does not match Windows'){$rejected=$true}else{throw}}
 if(-not $rejected){throw 'Architecture-swapped executable accepted'}
}
foreach($name in @('short.exe','no-mz.exe','bad-offset.exe','bad-signature.exe','bad-magic.exe','bad-optional-length.exe')){
 $rejected=$false;try{Assert-RuntimeMachine (Join-Path $dir $name) 'arm64'}catch{$rejected=$true}
 if(-not $rejected){throw ('Malformed executable accepted: '+$name)}
}
[Console]::WriteLine('pe-machine-contract-pass')
`,{JA21_TEST_DIRECTORY:dir});
 assert.match(output,/pe-machine-contract-pass/);
});

test('launcher/native: runtime probe executes current native Node and rejects wrong version/architecture',{skip:process.platform!=='win32'},()=>{
 const output=run(String.raw`
Confirm-Runtime $env:JA21_TEST_NODE $env:JA21_TEST_VERSION $env:JA21_TEST_ARCH
$rejected=$false
try{Confirm-Runtime $env:JA21_TEST_NODE '0.0.0' $env:JA21_TEST_ARCH}catch{if($_.Exception.Message -match 'runtime identity mismatch'){$rejected=$true}else{throw}}
if(-not $rejected){throw 'Unexpected runtime version accepted'}
$other=if($env:JA21_TEST_ARCH -eq 'arm64'){'x64'}else{'arm64'}
$rejected=$false
try{Confirm-Runtime $env:JA21_TEST_NODE $env:JA21_TEST_VERSION $other}catch{if($_.Exception.Message -match 'does not match Windows'){$rejected=$true}else{throw}}
if(-not $rejected){throw 'Wrong runtime architecture accepted'}
[Console]::WriteLine('native-runtime-probe-pass')
`,{JA21_TEST_NODE:process.execPath,JA21_TEST_VERSION:process.version.slice(1),JA21_TEST_ARCH:process.arch});
 assert.match(output,/native-runtime-probe-pass/);
});

test('launcher/native: real-target acceptance refuses another Windows architecture before provisioning',{skip:process.platform!=='win32'},async t=>{
 const native=run("[Console]::WriteLine(('native-arch='+ (Get-WindowsRuntimeArchitecture)))").match(/native-arch=(x64|arm64)/)?.[1];
 assert(native);const other=native==='arm64'?'x64':'arm64';
 await fs.mkdir(path.join(root,'audit'),{recursive:true});const dir=await fs.mkdtemp(path.join(root,'audit','.acceptance-fixture-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.mkdir(path.join(dir,'scripts/windows'),{recursive:true});
 for(const name of ['bootstrap.ps1','native-acceptance.ps1'])await fs.copyFile(path.join(root,'scripts/windows',name),path.join(dir,'scripts/windows',name));
 await fs.copyFile(path.join(root,'Native-Acceptance.cmd'),path.join(dir,'Native-Acceptance.cmd'));
 const cmd=path.join(process.env.SystemRoot,'System32/cmd.exe');
 const result=spawnSync(cmd,['/d','/s','/c',`""${path.join(dir,'Native-Acceptance.cmd')}" ${other}"`],{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,timeout:15000});
 assert.equal(result.error,undefined);assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stdout,/Native acceptance requires Windows/);
 const report=JSON.parse(await fs.readFile(path.join(dir,`audit/NATIVE_ACCEPTANCE_${other}.json`),'utf8'));
 assert.equal(report.status,'FAIL');assert.equal(report.hostArchitecture,native);assert.equal(report.preflight,null);assert.equal(report.runtime,null);
 await assert.rejects(fs.access(path.join(dir,'.runtime')),/ENOENT/);
});
