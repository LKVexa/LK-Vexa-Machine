import { VERSION } from './version.js';
import { RamLink } from './lib/ram-link.js';
const $=id=>document.getElementById(id),link=new RamLink({validation:true});
const KEY='ja21-semisili-browser-validation-v1';
let report=null,busy=false;
function show(){ $('results').textContent=JSON.stringify(report,null,2);$('download').disabled=!report; }
function add(name,status,details={}){report.checks.push({name,status,...details});show();}
function finish(){report.status=report.checks.some(c=>c.status==='FAIL')?'FAIL':report.checks.some(c=>!['PASS','INFO'].includes(c.status))?'PARTIAL':'PASS';report.finishedAt=new Date().toISOString();show();}
async function boot(){const ready=await link.start();return ready;}
async function stageOne(){
  report={schema:'JA21-SEMISILI-BROWSER-ACCEPTANCE/1',version:VERSION,startedAt:new Date().toISOString(),
    origin:location.origin,scope:'Live browser worker, isolated IndexedDB volume, numerical CPU pipeline, WebGPU confirmation',
    browser:navigator.userAgent,secureContext:isSecureContext,checks:[]};show();
  const ready=await boot();add('production worker startup','PASS',{epoch:ready.epoch});
  const preview=await link.rpc('xpu',{action:'run',args:{requireGpu:false,operation:'mul',operand:17,prime:2,precision:16,steps:8}});
  if(!preview.canApply||preview.receipt.status!=='CPU_VALIDATED')throw new Error('CPU preview was not validated');
  add('CPU phase, neuron, Float32 readout','PASS',{receipt:preview.receipt});
  const saved=await link.rpc('xpu',{action:'apply',args:{token:preview.token}});
  if(!saved.saved)throw new Error('volume commit was not accepted');
  add('atomic neuron and field commit','PASS',{stateSha256:saved.receipt.stateSha256});
  const backup=JSON.parse(await link.rpc('backup'));
  localStorage.setItem(KEY,JSON.stringify({phase:2,report,expectedStateSha256:saved.receipt.stateSha256,expectedJob:saved.receipt.job,backupSha256:backup.sha256}));
  link.destroy('validation reload');$('status').textContent='Committed. Reloading to test persistent recovery…';location.reload();
}
async function stageTwo(saved){
  report=saved.report;show();const ready=await boot();
  if(!ready.restored)throw new Error('validation volume was not restored after reload');
  const info=await link.rpc('xpu',{action:'info'}),backup=JSON.parse(await link.rpc('backup'));
  if(info.savedReceipt?.stateSha256!==saved.expectedStateSha256||info.savedReceipt?.job!==saved.expectedJob||backup.sha256!==saved.backupSha256)throw new Error('recovered state differs from the committed state');
  if(info.savedReceipt.freshHardwareConfirmation!==false||info.savedReceipt.historical!==true)throw new Error('saved GPU status was incorrectly treated as fresh');
  add('reload and exact IndexedDB recovery','PASS',{epoch:ready.epoch,stateSha256:saved.expectedStateSha256});
  const tiff=await link.rpc('xpu',{action:'export'}),imported=await link.rpc('xpu',{action:'import',args:{bytes:tiff.bytes}});
  if(!imported.canApply||imported.receipt.gpu.status!=='NOT_RUN')throw new Error('Pixel160 import verification failed');
  add('Pixel160 TIFF round trip','PASS',{bytes:tiff.bytes.length});
  const second=new RamLink({validation:true});let blocked=false;
  try{await second.start();}catch(error){blocked=/another window/.test(error.message);}finally{second.destroy('writer exclusion check');}
  if(!blocked)throw new Error('a second validation window acquired the writer volume');
  add('single-writer browser lock','PASS');
  for(const operation of ['add','sub','mul','negate','complement']){
    const run=await link.rpc('xpu',{action:'run',args:{source:'bank',prime:2,precision:16,operation,operand:65535,steps:1,requireGpu:true}});
    const confirmed=run.canApply&&run.receipt.gpu.gpu.hardwareConfirmed===true;
    add(`hardware GPU ${operation}`,confirmed?'PASS':run.receipt.gpu.status==='GPU_MISMATCH'?'FAIL':'UNMET',{receipt:run.receipt});
  }
  const before=await link.rpc('backup'),bad=JSON.parse(before);bad.sha256='0'.repeat(64);
  let rejected=false;try{await link.rpc('restore',{text:JSON.stringify(bad)});}catch{rejected=true;}
  if(!rejected||await link.rpc('backup')!==before)throw new Error('invalid restore changed the volume');
  add('invalid restore retains saved volume','PASS');
  let storage='UNAVAILABLE';if(navigator.storage?.persisted)storage=await navigator.storage.persisted();
  add('browser persistence grant','INFO',{granted:storage,meaning:'Grant is separate from verified reload persistence; retain exported backups.'});
  finish();localStorage.setItem(KEY,JSON.stringify({phase:3,report,expectedStateSha256:saved.expectedStateSha256,expectedJob:saved.expectedJob,backupSha256:saved.backupSha256}));
  $('status').textContent='Validation complete. Download results. Close and reopen this page, then select Check after browser restart for the final persistence check.';
}
async function restartCheck(saved){
  report=saved.report;show();const ready=await boot(),info=await link.rpc('xpu',{action:'info'}),backup=JSON.parse(await link.rpc('backup'));
  if(!ready.restored||info.savedReceipt?.stateSha256!==saved.expectedStateSha256||backup.sha256!==saved.backupSha256)throw new Error('saved validation volume did not survive reopening');
  add('reopened browser persistent recovery','PASS',{requiresHumanConfirmation:'User must close the browser/application completely before this check.'});finish();
  localStorage.setItem(KEY,JSON.stringify({...saved,report}));$('status').textContent='Reopened-volume check completed. Download the updated results.';
}
async function run(fn){if(busy)return;busy=true;$('run').disabled=true;$('restart').disabled=true;try{await fn();}catch(error){report??={schema:'JA21-SEMISILI-BROWSER-ACCEPTANCE/1',version:VERSION,checks:[]};add('live browser acceptance','FAIL',{message:String(error.message||error).slice(0,512)});finish();$('status').textContent='Validation stopped. Download the results for diagnosis.';}finally{busy=false;$('run').disabled=false;$('restart').disabled=false;link.destroy('validation complete');}}
$('run').addEventListener('click',()=>run(stageOne));
$('restart').addEventListener('click',()=>run(async()=>{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved?.phase!==3)throw new Error('complete the initial validation first');await restartCheck(saved);}));
$('download').addEventListener('click',()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`JA21-${VERSION}-browser-results.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved?.phase===2)await run(()=>stageTwo(saved));else if(saved?.phase===3){report=saved.report;show();$('status').textContent='Prior results loaded. Check after a complete browser/application restart, or run a new validation.';}}catch(error){$('status').textContent=String(error.message||error);}
