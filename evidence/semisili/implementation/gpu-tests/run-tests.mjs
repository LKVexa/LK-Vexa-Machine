import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const folder=path.dirname(fileURLToPath(import.meta.url));
const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',path.join(folder,'semisili-gpu.test.mjs')],
  {encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,timeout:30000});
const tap=(result.stdout || '')+(result.stderr || '');
fs.writeFileSync(path.join(folder,'GPU_TEST_RESULTS.tap'),tap);
const summary={};
for(const line of tap.split(/\r?\n/))for(const key of ['tests','pass','fail','skipped','cancelled','duration_ms'])
  if(line.startsWith('# '+key+' '))summary[key]=Number(line.split(' ').at(-1));
const source=path.join(folder,'../src/lib/semisili-gpu.js');
const report={schema:'JA21-GPU-POLICY-TESTS/1',status:result.status===0 && summary.fail===0 && summary.cancelled===0?'PASS':'FAIL',
  generatedAt:new Date().toISOString(),node:process.version,exitCode:result.status,error:result.error?.message || null,
  summary,sourceSha256:createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
  scope:'Marked WebGPU API fixtures and independent BigInt arithmetic oracle. These tests do not compile WGSL or establish actual GPU hardware execution.',
  liveGpuExecution:'NOT_RUN',hardwareConfirmed:false};
fs.writeFileSync(path.join(folder,'GPU_TEST_RESULTS.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.status!=='PASS')console.log(tap.slice(-6000));
process.exitCode=report.status==='PASS'?0:1;
