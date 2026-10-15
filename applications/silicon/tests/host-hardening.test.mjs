import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer,parseServerArgs } from '../scripts/serve.mjs';
import { build } from '../scripts/build.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=async t=>{
  await fs.mkdir(path.join(root,'audit'),{recursive:true});
  const dir=await fs.mkdtemp(path.join(root,'audit','.host-fixture-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
};
const request=(port,url,method='GET')=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:url,method},res=>{let body='';res.on('data',bytes=>body+=bytes);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});
  req.on('error',reject);req.end();
});

test('host: CLI refuses ambiguous, orphan and out-of-range arguments before build',()=>{
  assert.deepEqual(parseServerArgs([]),{port:8788,open:false});
  assert.deepEqual(parseServerArgs(['--port','8791','--open']),{port:8791,open:true});
  for(const args of [['8788'],['--open','--open'],['--port','8788','--port','8791'],['--port'],['--port','--open'],['--port','1023'],['--port','65536'],['--port','1e4'],['--unknown']])assert.throws(()=>parseServerArgs(args),/usage|port/);
});

test('host: Windows streams, device aliases and filename normalization are rejected',async t=>{
  const dir=await fixture(t);await fs.writeFile(path.join(dir,'index.html'),'fixture');
  const server=await createServer({port:0,root:dir});t.after(()=>server.close());const port=server.address().port;
  for(const url of ['/index.html:secret.json','/index.html%3Asecret.json','/index.html.','/index.html%20','/CON.json','/nul.js','/COM1.js','/LPT9.html','/a//b.js','/a%3Fb.js','/a%7Cb.js'])assert.equal((await request(port,url)).status,400,url);
  assert.equal((await request(port,'/')).status,200);
  assert.equal((await request(port,'/index.html?ignored=1')).status,200);
});

test('host: oversized assets and directories are unavailable, HEAD reports length without body',async t=>{
  const dir=await fixture(t);await fs.writeFile(path.join(dir,'index.html'),'fixture');
  await fs.writeFile(path.join(dir,'oversize.js'),Buffer.alloc(2*1024*1024+1));await fs.mkdir(path.join(dir,'directory.json'));
  const server=await createServer({port:0,root:dir});t.after(()=>server.close());const port=server.address().port;
  assert.equal((await request(port,'/oversize.js')).status,404);assert.equal((await request(port,'/directory.json')).status,404);
  const head=await request(port,'/','HEAD');assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(head.headers['content-length'],'7');
});

test('build: invalid input preserves the previous complete distribution',async t=>{
  const dir=await fixture(t);await fs.mkdir(path.join(dir,'web'));await fs.mkdir(path.join(dir,'dist'));
  await fs.writeFile(path.join(dir,'web/index.html'),'new');await fs.writeFile(path.join(dir,'dist/index.html'),'previous');
  await assert.rejects(build({root:dir}),/ENOENT/);assert.equal(await fs.readFile(path.join(dir,'dist/index.html'),'utf8'),'previous');
});

test('build: complete static publication excludes the Node-only worker',async t=>{
  const dir=await fixture(t);await fs.mkdir(path.join(dir,'web'));await fs.mkdir(path.join(dir,'src'));await fs.mkdir(path.join(dir,'dist'));
  await fs.writeFile(path.join(dir,'web/index.html'),'new');await fs.writeFile(path.join(dir,'src/app.js'),'export const value=1;');
  await fs.writeFile(path.join(dir,'src/regex-worker-node.js'),'node-only');await fs.writeFile(path.join(dir,'dist/stale.js'),'stale');
  await build({root:dir});assert.equal(await fs.readFile(path.join(dir,'dist/index.html'),'utf8'),'new');
  await assert.rejects(fs.access(path.join(dir,'dist/src/regex-worker-node.js')),/ENOENT/);await assert.rejects(fs.access(path.join(dir,'dist/stale.js')),/ENOENT/);
  assert.equal((await fs.readdir(dir)).filter(name=>name.startsWith('.dist-stage-')).length,0);
});

test('build: failed publication restores the previous complete distribution',async t=>{
  const dir=await fixture(t);await fs.mkdir(path.join(dir,'web'));await fs.mkdir(path.join(dir,'src'));await fs.mkdir(path.join(dir,'dist'));
  await fs.writeFile(path.join(dir,'web/index.html'),'new');await fs.writeFile(path.join(dir,'src/app.js'),'export const value=1;');
  const dist=path.join(dir,'dist');await fs.writeFile(path.join(dist,'index.html'),'previous');
  let failed=false;
  const rename=async(from,to)=>{if(to===dist && !failed){failed=true;const error=new Error('simulated locked publication destination');error.code='EACCES';throw error;}return fs.rename(from,to);};
  await assert.rejects(build({root:dir,rename}),/simulated locked publication/);
  assert.equal(await fs.readFile(path.join(dist,'index.html'),'utf8'),'previous');
  assert.equal((await fs.readdir(dir)).filter(name=>name.startsWith('.dist-stage-')).length,0);
});

test('build: failed rollback preserves and reports recoverable previous files',async t=>{
  const dir=await fixture(t);await fs.mkdir(path.join(dir,'web'));await fs.mkdir(path.join(dir,'src'));await fs.mkdir(path.join(dir,'dist'));
  await fs.writeFile(path.join(dir,'web/index.html'),'new');await fs.writeFile(path.join(dir,'src/app.js'),'export const value=1;');
  const dist=path.join(dir,'dist');await fs.writeFile(path.join(dist,'index.html'),'previous');
  const rename=async(from,to)=>{if(to===dist){const error=new Error('simulated unavailable destination');error.code='EACCES';throw error;}return fs.rename(from,to);};
  let failure;try{await build({root:dir,rename});}catch(error){failure=error;}
  assert(failure instanceof AggregateError);assert.match(failure.message,/previous distribution retained at/);
  assert.equal(await fs.readFile(path.join(failure.recoveryPath,'index.html'),'utf8'),'previous');
  assert(failure.recoveryPath.startsWith(dir+path.sep));
});

test('build: linked output cannot redirect a recursive build replacement',async t=>{
  const dir=await fixture(t);await fs.mkdir(path.join(dir,'web'));await fs.mkdir(path.join(dir,'src'));await fs.mkdir(path.join(dir,'preserve'));
  await fs.writeFile(path.join(dir,'preserve/keep.json'),'keep');
  try{await fs.symlink(path.join(dir,'preserve'),path.join(dir,'dist'),process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('link creation unavailable');return;}throw error;}
  await assert.rejects(build({root:dir}),/linked/);assert.equal(await fs.readFile(path.join(dir,'preserve/keep.json'),'utf8'),'keep');
});

test('launcher/native: PowerShell hash verification and linked-ancestor boundary', {skip:process.platform!=='win32'},async t=>{
  const dir=await fixture(t);
  const payload=path.join(root,'scripts/windows/bootstrap.ps1');
  const source=String.raw`$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:JA21_TEST_PAYLOAD,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
foreach($function in $ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]}){. ([ScriptBlock]::Create($function.Extent.Text))}
$dir=$env:JA21_TEST_DIRECTORY
[void][IO.Directory]::CreateDirectory((Join-Path $dir 'target'))
$linked=$false
try{[void](New-Item -ItemType Junction -Path (Join-Path $dir 'linked') -Target (Join-Path $dir 'target'));$linked=$true}catch{[Console]::WriteLine('junction-unavailable')}
if($linked){
 $rejected=$false
 try{New-PrivateDirectory (Join-Path $dir 'linked/child')}catch{if($_.Exception.Message -match 'reparse point'){$rejected=$true}else{throw}}
 if(-not $rejected -or (Test-Path -LiteralPath (Join-Path $dir 'target/child'))){throw 'Linked ancestor was followed'}
 [Console]::WriteLine('junction-boundary-pass')
}
[IO.File]::WriteAllText((Join-Path $dir 'sample.bin'),'modified')
$rejected=$false
try{Assert-FileHash (Join-Path $dir 'sample.bin') ('0'*64)}catch{if($_.Exception.Message -match 'SHA-256 mismatch'){$rejected=$true}else{throw}}
if(-not $rejected){throw 'Wrong hash was accepted'}
Assert-FileHash (Join-Path $dir 'sample.bin') $env:JA21_TEST_HASH
[Console]::WriteLine('native-boundary-pass')
`;
  const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=spawnSync(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',source],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,JA21_TEST_PAYLOAD:payload,JA21_TEST_DIRECTORY:dir,JA21_TEST_HASH:createHash('sha256').update('modified').digest('hex')}});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/native-boundary-pass/);
  await t.test('linked-ancestor dynamic rejection',{skip:result.stdout.includes('junction-unavailable')?'Junction creation unavailable':false},()=>assert.match(result.stdout,/junction-boundary-pass/));
});

test('launcher/native: cmd preflight refuses absent/corrupt offline runtime without starting a server', {skip:process.platform!=='win32'},async t=>{
  const dir=await fixture(t),app=path.join(dir,"app with spaces & apostrophe' bang! percent%");
  await fs.mkdir(path.join(app,'scripts'),{recursive:true});await fs.mkdir(path.join(app,'src'));
  await fs.copyFile(path.join(root,'Start-Console.cmd'),path.join(app,'Start-Console.cmd'));
  await fs.copyFile(path.join(root,'package.json'),path.join(app,'package.json'));
  for(const name of ['serve.mjs','build.mjs','verify.mjs'])await fs.writeFile(path.join(app,'scripts',name),'throw new Error("must not execute fixture");');
  await fs.writeFile(path.join(app,'src/version.js'),'fixture');
  const exe=path.join(process.env.SystemRoot,'System32/cmd.exe');
  const run=()=>spawnSync(exe,['/d','/s','/c',`""${path.join(app,'Start-Console.cmd')}" --preflight"`],{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,timeout:15000,env:{...process.env,JA21_OFFLINE:'1',JA21_NO_OPEN:'1',JA21_NO_PAUSE:'1',JA21_PORT:''}});
  const missing=run();assert.equal(missing.error,undefined);assert.equal(missing.status,1,missing.stdout+missing.stderr);assert.match(missing.stdout,/Offline mode:/);
  const pins=JSON.parse(await fs.readFile(path.join(root,'scripts/windows/runtime-lock.json'),'utf8'));
  const nativeArch=(process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE).toUpperCase();const architecture=nativeArch==='ARM64'?'arm64':'x64';
  await fs.writeFile(path.join(app,'.runtime/downloads',pins.architectures[architecture].archive),'corrupt fixture ZIP');
  const corrupt=run();assert.equal(corrupt.error,undefined);assert.equal(corrupt.status,1,corrupt.stdout+corrupt.stderr);assert.match(corrupt.stdout,/SHA-256 mismatch/);
  assert(!/PREFLIGHT PASS|Starting local host|must not execute fixture/.test(missing.stdout+corrupt.stdout));
  assert.equal((await fs.readdir(path.join(app,'.runtime'))).filter(name=>name.startsWith('node-v')).length,0);
});

test('launcher/native: minimal ZIP extraction ignores traversal entries and refuses duplicate executable entries', {skip:process.platform!=='win32'},async t=>{
  const dir=await fixture(t);
  const source=String.raw`$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:JA21_TEST_PAYLOAD,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
foreach($function in $ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]}){. ([ScriptBlock]::Create($function.Extent.Text))}
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$dir=$env:JA21_TEST_DIRECTORY
foreach($duplicate in @($false,$true)){
 $suffix=if($duplicate){'duplicate'}else{'valid'}
 $archive=Join-Path $dir ($suffix+'.zip')
 $stage=Join-Path $dir $suffix
 [void][IO.Directory]::CreateDirectory($stage)
 $zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
 try{
  $names=@('node-fixture/node.exe','node-fixture/LICENSE','node-fixture/README.md','../escape.js')
  if($duplicate){$names+='node-fixture/node.exe'}
  foreach($name in $names){$entry=$zip.CreateEntry($name);$output=$entry.Open();try{$bytes=[Text.Encoding]::UTF8.GetBytes('synthetic fixture, never executed');$output.Write($bytes,0,$bytes.Length)}finally{$output.Dispose()}}
 }finally{$zip.Dispose()}
 if($duplicate){
  $rejected=$false
  try{Expand-MinimalRuntime $archive 'node-fixture' $stage}catch{if($_.Exception.Message -match 'Expected one archive entry'){$rejected=$true}else{throw}}
  if(-not $rejected){throw 'Duplicate executable entry accepted'}
 }else{
  Expand-MinimalRuntime $archive 'node-fixture' $stage
  if(@([IO.Directory]::GetFiles($stage)).Count -ne 3){throw 'Unexpected extraction output'}
 }
}
if([IO.File]::Exists((Join-Path $dir 'escape.js'))){throw 'Traversal entry was extracted'}
[Console]::WriteLine('native-extraction-pass')
`;
  const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=spawnSync(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',source],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,JA21_TEST_PAYLOAD:path.join(root,'scripts/windows/bootstrap.ps1'),JA21_TEST_DIRECTORY:dir}});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/native-extraction-pass/);
});
