/** Offline release checks; Node core only. This is not a CVE service or proof of safety. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { VERSION } from '../src/version.js';
import { PROTOCOL } from '../src/vendor/vws/frame.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function files(dir){const out=[];for(const d of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isSymbolicLink())throw new Error(`Release input is linked: ${path.relative(root,p)}`);if(d.isDirectory())out.push(...await files(p));else out.push(p);}return out;}
export async function check(){
 const results=[],require=(ok,name)=>{results.push({test:name,status:ok?'PASS':'FAIL'});if(!ok)throw new Error(name);};
 const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
 require(pkg.version===VERSION && lock.version===VERSION && lock.packages[''].version===VERSION && (await fs.readFile(path.join(root,'VERSION'),'utf8')).trim()===VERSION,'release versions agree');
 require(PROTOCOL==='hermit.vws.v3','wire protocol v3 is explicit');
 require(Object.keys(lock.packages).length===1 && !pkg.dependencies && !pkg.devDependencies,'zero third-party runtime/build packages');
 const runtime=JSON.parse(await fs.readFile(path.join(root,'scripts/windows/runtime-lock.json'),'utf8'));
 const header=await fs.readFile(path.join(root,'scripts/windows/launcher-header.txt'),'utf8'),payload=await fs.readFile(path.join(root,'scripts/windows/bootstrap.ps1'),'utf8');
 const launcher=await fs.readFile(path.join(root,'Start-Console.cmd'),'utf8');
 require(runtime.consoleVersion===VERSION && payload.includes(`JA21 launcher ${VERSION} | application`),'launcher release version agrees');
 require(launcher===(header.trimEnd()+'\n#==JA21_POWERSHELL_PAYLOAD==\n'+payload).replace(/\r?\n/g,'\r\n'),'generated Windows launcher matches reviewed source');
 let windowsPowerShellParse=null;
 if(process.platform==='win32'){
  const ps=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const command="$ErrorActionPreference='Stop';$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($env:JA21_PARSE_PATH,[ref]$tokens,[ref]$errors);if($errors.Count){$errors | ForEach-Object {[Console]::Error.WriteLine($_.Message)};exit 1};[Console]::WriteLine($PSVersionTable.PSVersion.ToString())";
  const parsed=spawnSync(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,JA21_PARSE_PATH:path.join(root,'scripts/windows/bootstrap.ps1')}});
  require(!parsed.error && parsed.status===0,`native Windows PowerShell payload parses${parsed.stderr?.trim()?': '+parsed.stderr.trim():''}`);
  windowsPowerShellParse={status:'PASS',version:parsed.stdout.trim(),scope:'Parse only; no runtime provisioning or application execution'};
 }
 let syntax=0,imports=0;
 for(const dir of ['src','web','scripts','tests'])for(const f of await files(path.join(root,dir))){
  if(!/\.(?:mjs|js)$/.test(f))continue;
  const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8',timeout:10000,windowsHide:true});
  require(r.status===0,`parse ${path.relative(root,f)}`);syntax++;
  if(dir!=='src')continue;
  const text=await fs.readFile(f,'utf8');
  for(const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)(['"])([^'"\r\n]+)\1/gm)){
   const target=m[2];if(target.startsWith('node:'))continue;
   require(target.startsWith('.'),`local-only module ${path.relative(root,f)} -> ${target}`);
   await fs.access(path.resolve(path.dirname(f),target));imports++;
  }
 }
 const html=await fs.readFile(path.join(root,'web/index.html'),'utf8');
 require(html.includes(`<title>JA21 Silicon Console ${VERSION}</title>`) && html.includes(`<span id="version">${VERSION}</span>`) && html.includes(`<h2>Release ${VERSION}</h2>`) && html.includes(`JA21 ${VERSION} · LOCAL_BROWSER`),'static UI release labels agree');
 require(!/\bon\w+\s*=|<script(?![^>]*\bsrc=)/i.test(html),'HTML has no inline handlers or scripts');
 const report={version:VERSION,protocol:PROTOCOL,node:process.version,syntaxFiles:syntax,resolvedLocalImports:imports,windowsPowerShellParse,results};
 await fs.mkdir(path.join(root,'audit'),{recursive:true});await fs.writeFile(path.join(root,'audit','RELEASE_CHECKS.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`Release checks PASS: ${syntax} JS files parsed, ${imports} local imports resolved, versions/dependencies checked.`);return report;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await check();
