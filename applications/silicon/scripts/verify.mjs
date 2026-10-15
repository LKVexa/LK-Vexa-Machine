/** Repeatable offline release gate. Static launcher checks are NOT Windows execution. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from './build.mjs';
import { check } from './check.mjs';
import { VERSION } from '../src/version.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reportPath=path.join(root,'audit/VERIFICATION.json');
const report={version:VERSION,status:'RUNNING',node:process.version,platform:process.platform,startedUtc:new Date().toISOString(),
 excluded:['This core gate does not itself provision the private runtime; separate x64 download/cache/preflight evidence is recorded under audit. Full fresh-machine/ARM64 startup remains a separate acceptance check.','Normal-browser worker/IndexedDB/Web Locks/CSP integration','Native C# compilation','Physical GPU/XPU or quantum hardware','Live advisory-database scan'],
 optional:['node scripts/make-tiff-examples.mjs followed by python tests/russl_interop.py (NumPy, tifffile, Pillow)','python tests/codecs.py (Pillow)','python tests/browser_offline.py (Playwright + Chromium; explicit in-memory fixture)','node tests/browser-production.mjs (Playwright + Chromium/Edge; real production integration, separate acceptance gate)']};
async function save(){await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}
try{
 await save(); // Invalidate an old PASS before starting a new run.
 await build();const checks=await check();report.windowsPowerShellParse=checks.windowsPowerShellParse;
 const r=spawnSync(process.execPath,[path.join(root,'scripts/test.mjs')],{cwd:root,stdio:'inherit',timeout:150000,windowsHide:true});
 if(r.error)throw r.error;if(r.status!==0)throw new Error(`test runner exited ${r.status}`);
 const tap=await fs.readFile(path.join(root,'audit/TEST_RESULTS.tap'),'utf8');
 const count=key=>{const m=tap.match(new RegExp(`^# ${key} (\\d+)$`,'m'));if(!m)throw new Error(`missing TAP ${key} summary`);return Number(m[1]);};
 Object.assign(report,{tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),cancelled:count('cancelled'),todo:count('todo')});
 if(!report.tests || report.failed!==0 || report.cancelled!==0)throw new Error('test summary missing or failing');
 report.staticLauncherChecks=(tap.match(/^# Subtest: launcher\/static:/gm)||[]).length;
 report.nativeLauncherBoundaryChecks=(tap.match(/^# Subtest: launcher\/native:/gm)||[]).length;
 report.staticLauncherNote='Text/packaging contracts only. Native PowerShell parsing and safe failure-path execution are reported separately; successful runtime provisioning is excluded.';
 report.status='PASS_FOR_OFFLINE_GATE';report.finishedUtc=new Date().toISOString();await save();
 console.log(`\nJA21 ${VERSION}: ${report.passed}/${report.tests} tests passed, ${report.skipped} skipped; includes ${report.staticLauncherChecks} STATIC launcher checks. Browser/ARM64/full fresh-machine acceptance is separate from this core gate.`);
}catch(error){
 report.status='FAIL';report.error=error.message;report.finishedUtc=new Date().toISOString();
 try{await save();}catch(writeError){console.error('Could not save verification status:',writeError.message);}
 console.error('VERIFY FAILED:',error.message);process.exitCode=1;
}
