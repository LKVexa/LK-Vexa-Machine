import { russlOperation } from './spiral/russl-service.js';
import { VERSION, PROFILE } from '../version.js';
import { SpiralKernel, validGeometry } from './spiral/kernel.js';
import { VFS } from './spiral/vfs.js';
import { NODES } from './spiral/commands/ram.js';
import { DEVICE, VALIDATION_PROFILE, readVolume, writeVolume, revisionOf } from './spiral/ssd.js';
import { assertBackupSize } from './spiral/volume-format.js';
import { Hpu } from './spiral/hpu.js';
import { Buffer } from './spiral/buffer.js';
import { PROTOCOL, KIND_INPUT, KIND_OUTPUT, encodeData, decodeData } from './vws/frame.js';
import { FlowWindow, MAX_QUEUE } from './vws/flow.js';
import { prepareModel, loadModel, saveModel, modelField, exportModelTiff, importModelTiff, STATE_PATH, RECEIPT_PATH } from '../lib/semisili-model.js';
import { confirmFiniteGpu } from '../lib/semisili-gpu.js';
import { XpuDelegation, validDelegatedCommand } from '../lib/xpu-delegation.js';
const LIMITS={maxBytes:2*1024*1024,maxNodes:1500};
const startedAt=Date.now(), serverEpoch=crypto.randomUUID(), enc=new TextEncoder();
const connections=new Set(), bySid=new Map();
let kernel, hpu, phase='booting', revision=0, dirty=0, savedDirty=0, pending=null, timer, releaseLock, ownsLock=false, factorySeal='', imageCache=null, rpcBusy=false;
let lastRecord=null;
let delegation;
let xpuDraft=null, xpuJob=null, xpuCancelEpoch=0, xpuCommitting=false, xpuProof=null;
const disk={device:DEVICE, model:'IndexedDB virtual volume (not NVMe)', fs:'virtual', mount:'/', synced:false, restored:false, writtenAt:0, error:''};
function message(error) { return String(error?.message || error).slice(0,512); }
async function hash(text) { const out=await crypto.subtle.digest('SHA-256',enc.encode(text)); return [...new Uint8Array(out)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function seed(k) {
  k.vfs.mkdir('/var/hpu',{recursive:true}); k.vfs.mkdir('/usr/share/doc',{recursive:true}); k.vfs.mkdir('/df/nodes',{recursive:true});
  k.vfs.writeFile('/etc/os-release',`NAME=JA21 Silicon Console\nVERSION=${VERSION}\nPROFILE=${PROFILE}\nIMPLEMENTATION=JavaScript-software-simulation\n`);
  k.vfs.writeFile('/home/operator/README', 'JA21 RAM-resident numerical console. Use the Semi-sili XPU tab for finite p-adic phase arithmetic and neuron sampling.\nGPU-required runs dispatch WebGPU and compare every arithmetic result; CPU preview is available explicitly.\nUse help, disk, xpuinfo, hpu gate xor 1 0, hpu bytes, sync. Legacy hpu bytes remains CPU-only.\nExport a backup before closing. Browser storage can be cleared or evicted.\n');
  k.vfs.writeFile('/usr/share/doc/architecture.txt','Browser UI -> MessageChannel frames -> worker -> bounded numerical HPU / semi-sili model -> IndexedDB.\nThe native presenter or local static server serves the same application. WebGPU confirms finite ring arithmetic when supported. Phase and neuron evolution run on the CPU.\nXPU terminals cannot execute host programs. Administrator PowerShell is a separate, explicitly opened Windows capability outside this worker. image verify compares canonical content with the current factory seed, not a trusted signature.\n');
  for (const n of NODES) { k.vfs.mkdir(`/df/nodes/${n.node}`,{recursive:true}); k.vfs.writeFile(`/df/nodes/${n.node}/image.txt`,`${n.node}\nrole: ${n.role}\nstatus: descriptive virtual-node manifest only; no booted VM\n`); }
}
function markDirty() { dirty++; disk.synced=false; imageCache=null; clearTimeout(timer); timer=setTimeout(()=>{ flush().catch(e=>{ disk.error=message(e); }); },80); }
async function makeRecord(snap,next) {
  const record={v:2,device:DEVICE,version:VERSION,revision:next,writer:serverEpoch,writtenAt:Date.now(),snap,sha256:await hash(JSON.stringify(snap))};
  assertBackupSize(JSON.stringify(record)); // Reject an un-restorable envelope before the IndexedDB commit.
  return record;
}
async function flush() {
  if (!ownsLock || !kernel || !['ready','booting','stopping'].includes(phase)) throw new Error('volume is not writable');
  clearTimeout(timer);
  if (pending) { await pending; if(savedDirty===dirty) return; }
  if (savedDirty===dirty && disk.synced) return;
  pending=(async()=>{
    try {
      while(savedDirty!==dirty || !disk.synced) {
        const target=dirty, record=await makeRecord(kernel.vfs.exportSnapshot(),revision+1);
        revision=await writeVolume(record,revision); lastRecord=record; savedDirty=target;
        disk.synced=(savedDirty===dirty); disk.writtenAt=record.writtenAt; disk.error='';
      }
    } catch(e) { disk.synced=false; disk.error=message(e); throw e; }
  })();
  try { await pending; } finally { pending=null; }
}
async function validateRecord(record) {
  if (!record || ![1,2].includes(record.v) || !record.snap) throw new Error('unsupported volume format');
  assertBackupSize(JSON.stringify(record));
  if(record.v===2 && (typeof record.sha256!=='string' || record.sha256!==await hash(JSON.stringify(record.snap)))) throw new Error('volume checksum mismatch');
  const vfs=new VFS({...LIMITS,seed:false}); vfs.importSnapshot(record.snap);
  const processor=new Hpu();
  if(vfs.exists('/var/hpu/field.bin') && !processor.load(vfs.readFile('/var/hpu/field.bin'))) throw new Error('invalid HPU snapshot; existing volume retained without writes');
  if(vfs.exists(STATE_PATH))loadModel(String(vfs.readFile(STATE_PATH)));
  if(vfs.exists(RECEIPT_PATH))await validatedReceipt(vfs);
  return {vfs,processor};
}
function publishHolo() { if(hpu && phase==='ready') postMessage({type:'holo',epoch:serverEpoch,payload:hpu.preview()}); }
async function image() { if(!imageCache) imageCache=hash(JSON.stringify(kernel.vfs.canonicalSnapshot())); return {seal:factorySeal,digest:await imageCache,epoch:serverEpoch,profile:PROFILE}; }
function persistHpu() { xpuDraft=null;xpuProof=null; kernel.vfs.mkdir('/var/hpu',{recursive:true}); kernel.vfs.writeFile('/var/hpu/field.bin',Buffer.from(hpu.save())); publishHolo(); }

function xpuPrior(){return kernel.vfs.exists(STATE_PATH)?loadModel(String(kernel.vfs.readFile(STATE_PATH))):null;}
async function validatedReceipt(vfs){
  if(!vfs.exists(STATE_PATH))throw new Error('XPU receipt has no neuron bank');
  const text=String(vfs.readFile(RECEIPT_PATH));if(enc.encode(text).length>65536)throw new Error('XPU receipt exceeds limit');
  const r=JSON.parse(text),digest=/^[a-f0-9]{64}$/;
  if(!r||typeof r!=='object'||Array.isArray(r)||r.schema!=='JA21-SEMISILI-RUN/1'||
    !['CPU_VALIDATED','CPU_AND_GPU_CONFIRMED'].includes(r.status)||r.publication!=='COMMITTED'||
    typeof r.engine!=='string'||!/^\d+\.\d+\.\d+$/.test(r.engine)||r.engine.length>32||
    typeof r.serverEpoch!=='string'||r.serverEpoch.length>64||typeof r.job!=='string'||r.job.length>64||
    !Number.isSafeInteger(r.createdAt)||r.createdAt<0||!Number.isSafeInteger(r.committedAt)||r.committedAt<r.createdAt||
    !digest.test(r.sourceFieldSha256)||!digest.test(r.stateSha256)||!r.summary||r.summary.samples!==4096||r.summary.cpu?.status!=='PASS'||
    typeof r.gpu?.status!=='string'||r.gpu.status.length>64||typeof r.gpu?.gpu?.hardwareConfirmed!=='boolean'||
    !Array.isArray(r.coverage?.cpu)||!Array.isArray(r.coverage?.gpu))throw new Error('invalid saved XPU receipt');
  const model=loadModel(String(vfs.readFile(STATE_PATH))),modulus=model.config.prime**model.config.precision;
  if(r.status==='CPU_AND_GPU_CONFIRMED'&&(r.gpu.schema!=='JA21-FINITE-GPU-CONFIRMATION/1'||r.gpu.fixture!==false||
    r.gpu.status!=='GPU_CONFIRMED'||r.gpu.gpu.hardwareConfirmed!==true||r.gpu.gpu.apiConfirmed!==true||r.gpu.gpu.fallback!==false||
    r.gpu.comparison?.status!=='PASS'||r.gpu.comparison?.mismatches!==0||r.gpu.comparison?.elements!==4096||
    r.gpu.coverage?.stage!=='finite-arithmetic'||r.gpu.coverage?.samples!==4096||r.gpu.coverage?.modulus!==modulus||
    r.gpu.coverage?.operation!==model.config.operation||r.summary.operation!==model.config.operation||r.summary.modulus!==modulus||
    r.summary.cpu.comparisonElements!==4096||r.coverage.gpu.length!==1||r.coverage.gpu[0]!=='finite ring arithmetic'))throw new Error('incoherent saved GPU receipt');
  if(r.status==='CPU_VALIDATED'&&(r.gpu.gpu.hardwareConfirmed!==false||r.coverage.gpu.length!==0))throw new Error('incoherent saved CPU receipt');
  if(r.stateSha256!==await hash(String(vfs.readFile(STATE_PATH))))throw new Error('XPU receipt state checksum mismatch');
  return r;
}
async function fieldDigest(){const data=hpu.save();const out=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(out)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function xpuInfo(){
  const prior=xpuPrior();let receipt=null;
  if(kernel.vfs.exists(RECEIPT_PATH)){
    const text=String(kernel.vfs.readFile(RECEIPT_PATH));if(text.length>65536)throw new Error('XPU receipt exceeds limit');
    receipt=JSON.parse(text);
  }
  const currentProof=!!receipt&&xpuProof!==null&&xpuProof.stateText===String(kernel.vfs.readFile(STATE_PATH))&&xpuProof.receiptText===String(kernel.vfs.readFile(RECEIPT_PATH));
  return {present:!!prior,path:STATE_PATH,sequence:prior?.current.sequence??0,historyFrames:prior?.frames.length??0,
    ring:prior?`${prior.config.prime}^${prior.config.precision}`:null,revision:String(revision),
    capability:{secureContext:self.isSecureContext,webGpuApi:!!navigator.gpu,hardwareGpu:'requires successful dispatch and readback'},
    savedReceipt:receipt?{...receipt,historical:!currentProof,freshHardwareConfirmation:currentProof&&receipt.status==='CPU_AND_GPU_CONFIRMED'}:null,
    draft:xpuDraft?{token:xpuDraft.token,canApply:xpuDraft.canApply,receipt:xpuDraft.receipt}:null};
}
async function xpuOperation(action,args={},cancelEpoch=xpuCancelEpoch){
  if(!['info','run','apply','export','import'].includes(action))throw new Error('unsupported XPU action');
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('invalid XPU arguments');
  if(action==='info')return xpuInfo();
  if(action==='export'){const prior=xpuPrior();if(!prior)throw new Error('no saved neuron field');return {bytes:exportModelTiff(prior)};}
  const baseRevision=revision,baseDigest=await fieldDigest();
  if(action==='run'||action==='import'){
    if(cancelEpoch!==xpuCancelEpoch)throw new Error('XPU run cancelled before startup');
    xpuDraft=null;
    const controller=new AbortController(),job={id:crypto.randomUUID(),controller};xpuJob=job;
    try{
      let candidate,confirmation;
      if(action==='run'){
        candidate=prepareModel({re:hpu.re,im:hpu.im,prior:xpuPrior(),args});
        if(candidate.state.config.requireGpu)confirmation=await confirmFiniteGpu({a:candidate.a,b:candidate.b,modulus:candidate.ring.modulus,operation:candidate.state.config.operation,expected:candidate.expected},{signal:controller.signal,timeoutMs:10000});
      }else{
        if(Object.keys(args).some(k=>k!=='bytes')||!(args.bytes instanceof Uint8Array)||args.bytes.length>192*1024)throw new Error('select a bounded Pixel160 TIFF');
        const state=importModelTiff(args.bytes),text=saveModel(state);
        candidate={state,text,summary:{samples:4096,operation:'import',cpu:{status:'PASS',arithmetic:'not rerun; finite profile and phase readout validated'},canonicalFrameBytes:81920,stateBytes:enc.encode(text).length}};
      }
      if(controller.signal.aborted||xpuJob!==job||phase!=='ready')throw new Error('XPU run cancelled');
      if(baseRevision!==revision||baseDigest!==await fieldDigest())throw new Error('resident state changed during XPU validation; retry');
      const required=action==='run'&&candidate.state.config.requireGpu;
      const canApply=!required||confirmation?.receipt.gpu.hardwareConfirmed===true;
      const receipt={schema:'JA21-SEMISILI-RUN/1',engine:VERSION,serverEpoch,job:job.id,createdAt:Date.now(),
        sourceFieldSha256:baseDigest,stateSha256:await hash(candidate.text),summary:candidate.summary,
        gpu:confirmation?.receipt??{status:'NOT_RUN',gpu:{hardwareConfirmed:false}},
        coverage:{cpu:['phase arithmetic','Float32 phase readout','finite neuron update','Pixel160 state validation'],gpu:confirmation?.receipt.gpu.hardwareConfirmed?['finite ring arithmetic']:[]},
        status:canApply?(required?'CPU_AND_GPU_CONFIRMED':'CPU_VALIDATED'):'GPU_REQUIREMENT_UNMET',publication:'PREVIEW'};
      if(controller.signal.aborted||xpuJob!==job)throw new Error('XPU run cancelled');
      xpuDraft={...candidate,receipt,canApply,token:job.id,baseRevision,baseDigest};
      return {token:job.id,canApply,receipt,preview:previewModel(candidate.state)};
    }finally{if(xpuJob===job)xpuJob=null;}
  }
  if(Object.keys(args).some(k=>k!=='token')||typeof args.token!=='string'||!xpuDraft||args.token!==xpuDraft.token)throw new Error('run and review a new XPU preview before saving');
  const draft=xpuDraft;
  if(!draft.canApply)throw new Error('required hardware GPU confirmation was not completed');
  if(draft.baseRevision!==revision||draft.baseDigest!==await fieldDigest())throw new Error('XPU preview is stale; run again before saving');
  // Prepare a detached, quota-checked volume and processor before the atomic volume transaction.
  const nextVfs=new VFS({...LIMITS,seed:false});nextVfs.importSnapshot(kernel.vfs.exportSnapshot());
  const field=modelField(draft.state),processor=new Hpu();processor.re.set(field.re);processor.im.set(field.im);
  processor.op=`semi-sili ${draft.state.config.operation}`;processor.stage='semisili';processor.margin=draft.receipt.summary.cpu.float32MinimumMargin??0;
  const fieldBytes=processor.save(),receipt={...draft.receipt,publication:'COMMITTED',committedAt:Date.now()};
  nextVfs.mkdir('/var/xpu',{recursive:true});nextVfs.mkdir('/var/hpu',{recursive:true});
  const receiptText=JSON.stringify(receipt);
  nextVfs.writeFile(STATE_PATH,draft.text);nextVfs.writeFile(RECEIPT_PATH,receiptText);nextVfs.writeFile('/var/hpu/field.bin',Buffer.from(fieldBytes));
  const record=await makeRecord(nextVfs.exportSnapshot(),revision+1);
  if(cancelEpoch!==xpuCancelEpoch||xpuDraft!==draft)throw new Error('XPU save cancelled before commit');
  xpuCommitting=true;
  try{
  revision=await writeVolume(record,revision);lastRecord=record;
  // No GPU await remains between durable acceptance and live publication.
  kernel.vfs=nextVfs;kernel.vfs.onMutate=markDirty;hpu=processor;kernel.host.hpu=hpu;
  savedDirty=dirty;disk.synced=true;disk.writtenAt=record.writtenAt;disk.error='';imageCache=null;xpuDraft=null;xpuProof={stateText:draft.text,receiptText};publishHolo();
  return {saved:true,receipt,...xpuInfo()};
  }finally{xpuCommitting=false;}
}
function previewModel(state){const field=modelField(state),processor=new Hpu();processor.re.set(field.re);processor.im.set(field.im);return processor.preview();}
async function xpuTerminal(action,args,signal){
  if(!['info','run','apply'].includes(action)||phase!=='ready'||!ownsLock)throw new Error('XPU terminal service unavailable');
  if(rpcBusy||[...kernel.sessions.values()].filter(s=>s.running).length>1)throw new Error('wait for other commands or management operations before XPU computation');
  if(signal?.aborted)throw new Error('XPU command interrupted');
  rpcBusy=true;const resume=kernel.holdCommands(),cancelEpoch=xpuCancelEpoch;
  const cancel=()=>{if(!xpuCommitting){xpuCancelEpoch++;xpuJob?.controller.abort();xpuDraft=null;}};
  signal?.addEventListener('abort',cancel,{once:true});
  try{await flush();if(signal?.aborted)throw new Error('XPU command interrupted before startup');return await xpuOperation(action,args,cancelEpoch);}
  finally{signal?.removeEventListener('abort',cancel);resume();rpcBusy=false;}
}
const browser={visible:false,url:'about:blank',engine:'built-in information pane; not a separate browser engine'};
function openBrowser(url='about:blank') { if(!['about:blank','ram://status'].includes(url)) throw new Error('external navigation is disabled in the isolated local profile'); browser.visible=true; browser.url=url; postMessage({type:'browser',payload:{...browser}}); return {...browser}; }
async function stop(reboot=false) {
  if(phase!=='ready') throw new Error('server is not running');
  // A shell power command itself is active, but must not stop another session mid-command.
  if([...kernel.sessions.values()].some(s=>s.running?.signal.aborted))throw new Error('power operation interrupted');
  if([...kernel.sessions.values()].filter(s=>s.running).length>1)throw new Error('wait for other running commands before power operation');
  phase='stopping';
  for (const c of [...connections]) c.close('power operation: quiescing');
  try { await flush(); }
  catch(error) { phase='ready'; throw error; }
  phase='halted'; for(const c of [...connections]) c.close('server stopped');
  releaseLock?.(); ownsLock=false; postMessage({type:'halt',reboot,epoch:serverEpoch});
}
async function boot() {
  const host={version:()=>VERSION,profile:()=>PROFILE,disk:()=>({...disk}),sync:flush,afterCommand:flush,linkInfo:()=>({protocol:PROTOCOL,profile:PROFILE,epoch:serverEpoch}),image,
    fabricRoster:()=>NODES.map(n=>({...n,present:true,built:false})),openBrowser,navigateBrowser:openBrowser,browserState:()=>({...browser}),closeBrowser:()=>{browser.visible=false;postMessage({type:'browser',payload:{...browser}});},
    poweroff:()=>stop(false),reboot:()=>stop(true)};
  kernel=new SpiralKernel({hostBridge:host,vfsLimits:LIMITS,limits:{captureBytes:524288,historyEntries:400},baseEnv:{HOST:'virtual0',PROFILE,CONSOLE:`JA21/${VERSION}`}});
  seed(kernel); factorySeal=await hash(JSON.stringify(kernel.vfs.canonicalSnapshot()));
  delegation=new XpuDelegation(kernel);
  lastRecord=await readVolume(); revision=revisionOf(lastRecord);
  hpu=new Hpu();
  if(lastRecord!==null) { const recovered=await validateRecord(lastRecord); kernel.vfs=recovered.vfs; hpu=recovered.processor; disk.restored=true; disk.synced=true; disk.writtenAt=lastRecord.writtenAt || 0; }
  host.hpu=hpu; host.hpuTouch=persistHpu;host.xpuTerminal=xpuTerminal;
  kernel.vfs.onMutate=markDirty;
  kernel.on('data',e=>bySid.get(e.sessionId)?.emit(e.chunk));
  kernel.on('exit',e=>bySid.get(e.sessionId)?.close(e.reason || 'session closed',e.code));
  if(lastRecord===null) { dirty=1; await flush(); }
  phase='ready'; postMessage({type:'ready',epoch:serverEpoch,protocol:PROTOCOL,version:VERSION,restored:disk.restored}); publishHolo();
}
function bind(port) {
  if(phase!=='ready' || connections.size>=8) { port.postMessage({type:'error',message:'server unavailable or session limit reached'}); port.close(); return; }
  const flow=new FlowWindow();
  const c={sid:null,closed:false,inSeq:0,outSeq:0,queue:[],queued:0,decoder:new TextDecoder('utf-8',{fatal:true}),windowAt:performance.now(),received:0,
    send(o){ if(!c.closed) port.postMessage({v:3,epoch:serverEpoch,sid:c.sid,...o}); },
    close(reason,code=0){ if(c.closed)return; c.send({type:'session.exit',payload:{reason,code}}); c.closed=true; clearTimeout(openTimer); bySid.delete(c.sid); connections.delete(c); kernel?.closeSession(c.sid,reason); c.queue=[]; c.queued=0; port.close(); },
    emit(text){ const u=enc.encode(text); if(c.queued+u.length>MAX_QUEUE) {c.close('output queue limit exceeded',1);return;} for(let i=0;i<u.length;i+=16384) c.queue.push(u.slice(i,i+16384)); c.queued+=u.length; c.pump(); },
    pump(){ while(c.queue.length && flow.canSend(c.queue[0].length)) {const u=c.queue.shift();c.queued-=u.length;flow.send(u.length);const frame=encodeData(KIND_OUTPUT,++c.outSeq,u);port.postMessage(frame,[frame.buffer]);} }
  };
  connections.add(c); const openTimer=setTimeout(()=>{if(!c.sid)c.close('open timeout');},5000);
  port.onmessageerror=()=>c.close('message decode failure',1);
  port.onmessage=async e=>{
    try {
      if(c.closed || phase!=='ready')return;
      if(performance.now()-c.windowAt>1000){c.windowAt=performance.now();c.received=0;}
      if(++c.received>2048) throw new Error('message rate limit');
      const m=e.data;
      if(m instanceof ArrayBuffer || m instanceof Uint8Array) {
        const f=decodeData(m);if(!c.sid || f.kind!==KIND_INPUT || f.seq!==c.inSeq+1 || f.payload.length>8192) throw new Error('invalid input frame');
        const text=c.decoder.decode(f.payload,{stream:true});c.inSeq=f.seq;
        kernel.write(c.sid,text);c.send({type:'input.ack',payload:{acceptedSeq:c.inSeq}});return;
      }
      if(!m || typeof m!=='object' || Array.isArray(m) || m.v!==3 || m.epoch!==serverEpoch || typeof m.type!=='string' || JSON.stringify(m).length>2048) throw new Error('invalid control record');
      if(c.sid && m.sid!==c.sid) throw new Error('session mismatch');
      const q=m.payload || {};
      if(typeof q!=='object' || Array.isArray(q))throw new Error('invalid control payload');
      if(m.type==='session.open') {if(c.sid) throw new Error('session already open'); if(!validGeometry(q.cols,q.rows))throw new Error('invalid geometry'); const opened=kernel.openSession({cols:q.cols,rows:q.rows,deferStart:true});c.sid=opened.sessionId;bySid.set(c.sid,c);clearTimeout(openTimer);c.send({type:'session.opened',rid:m.rid,payload:opened});return;}
      if(!c.sid) throw new Error('session not open');
      switch(m.type) {
        case 'session.start':kernel.startSession(c.sid);break;
        case 'flow.ack':flow.acknowledge(q.consumedBytes);c.pump();break;
        case 'terminal.resize':if(!kernel.resize(c.sid,q.cols,q.rows))throw new Error('invalid geometry');break;
        case 'terminal.signal':if(q.signal!=='SIGINT')throw new Error('unsupported signal');kernel.signal(c.sid,'SIGINT');break;
        case 'session.close':c.close('client closed');break;
        case 'session.status':c.send({type:'session.status',rid:m.rid,payload:{...kernel.status(c.sid),...await image(),uptimeMs:Date.now()-startedAt,version:VERSION,epoch:serverEpoch}});break;
        default:throw new Error('unsupported control record');
      }
    } catch(error) { c.send({type:'error',message:message(error)}); c.close(message(error),1); }
  };
  port.start();c.send({type:'hello',payload:{protocol:PROTOCOL}});
}
async function rpc(m) {
  if(typeof m.id!=='string' || m.id.length>64 || typeof m.op!=='string')throw new Error('bad RPC');
  if(m.op==='backup') {if(phase==='ready')await flush();const record=await readVolume(!!m.previous);if(!record)throw new Error('no saved volume');const text=JSON.stringify(record,null,2);assertBackupSize(text);return text;}
  if(m.op==='restore') {
    if(!ownsLock || !['ready','failed'].includes(phase))throw new Error('writer lock required for restore');
    if(kernel && [...kernel.sessions.values()].some(s=>s.running||s.waiting||s.delegation))throw new Error('wait for running commands before restore');
    assertBackupSize(m.text);
    const record=JSON.parse(m.text), checked=await validateRecord(record);
    if(kernel && [...kernel.sessions.values()].some(s=>s.running||s.waiting||s.delegation))throw new Error('a command started during validation; retry when idle');
    const priorPhase=phase; phase='stopping';
    for(const c of [...connections])c.close('restore: quiescing');
    try {
      clearTimeout(timer);if(pending)await pending;
      if(priorPhase==='ready')await flush(); // Keep the latest pre-restore state as the atomic previous revision.
      const next=await makeRecord(checked.vfs.exportSnapshot(),revision+1);
      await writeVolume(next,revision); revision=next.revision;lastRecord=next;
    } catch(error) { phase=priorPhase; throw error; }
    phase='halted';for(const c of [...connections])c.close('volume restored'); releaseLock?.();ownsLock=false;
    return {restart:true};
  }
  if(phase!=='ready')throw new Error('server not ready');
  switch(m.op){
    case 'sync':await flush();return {...disk};
    case 'commands':return kernel.registry.list().map(d=>({name:d.name,summary:d.summary,usage:d.usage,aliases:d.aka || []}));
    case 'xpu': {
      if(!ownsLock||[...kernel.sessions.values()].some(s=>s.running||s.waiting||s.delegation))throw new Error('wait for active commands before XPU operations');
      const resume=kernel.holdCommands(),cancelEpoch=xpuCancelEpoch;
      try{await flush();return await xpuOperation(m.action,m.args??{},cancelEpoch);}finally{resume();}
    }
    case 'russl': {
      if(!ownsLock || [...kernel.sessions.values()].some(s=>s.running||s.waiting||s.delegation))throw new Error('wait for active commands before TIFF operations');
      const operation=m.action;
      if(!['info','get','receipt','capture','edit','apply','import'].includes(operation))throw new Error('unsupported TIFF action');
      if(['capture','edit','apply','import'].includes(operation) && typeof m.args?.expected!=='string')throw new Error('TIFF revision token required');
      const resume=kernel.holdCommands();
      try {
        const result=await russlOperation({vfs:kernel.vfs,host:kernel.host},operation,m.args || {});
        if(['capture','edit','apply','import'].includes(operation))await flush();
        return result;
      } finally { resume(); }
    }
    case 'preview':return hpu.preview();
    case 'files':return kernel.vfs.readdir(m.path || '/');
    case 'file': {const st=kernel.vfs.stat(m.path);if(st.type!=='file' || st.size>LIMITS.maxBytes)throw new Error('not an exportable file');const contents=kernel.vfs.readFile(m.path);return {path:m.path,bytes:contents instanceof Uint8Array ? new Uint8Array(contents) : enc.encode(contents)};}
    case 'power':if([...kernel.sessions.values()].some(s=>s.running||s.waiting||s.delegation))throw new Error('wait for commands or interrupt before power operation');await stop(!!m.reboot);return {stopped:true};
    default:throw new Error('unsupported RPC');
  }
}
self.onmessage=e=>{
  const m=e.data;
  if(m?.type==='attach') { if(e.ports?.length===1)bind(e.ports[0]);else for(const port of e.ports || [])port.close();return; }
  for(const port of e.ports || [])port.close();
  if(m?.type==='rpc') {
    if(m.op==='delegate'){
      if(typeof m.id!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(m.id)||typeof m.requestId!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(m.requestId)||typeof m.sid!=='string'||m.sid.length>64||!validDelegatedCommand(m.command)||phase!=='ready'||!ownsLock||rpcBusy){postMessage({type:'rpc',id:m.id,error:'delegation unavailable or invalid'});return;}
      delegation.run(m.sid,m.command,m.requestId).then(result=>postMessage({type:'rpc',id:m.id,result}),error=>postMessage({type:'rpc',id:m.id,error:message(error)}));return;
    }
    if(m.op==='delegate-cancel'){
      if(typeof m.id!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(m.id)||typeof m.sid!=='string'||typeof m.requestId!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(m.requestId)){postMessage({type:'rpc',id:m.id,error:'invalid delegation cancellation'});return;}
      postMessage({type:'rpc',id:m.id,result:{cancelled:!!delegation?.cancel(m.sid,m.requestId)}});return;
    }
    // Cancellation has a separate, literal control path so it can interrupt an awaited GPU run.
    if(m.op==='xpu-cancel'){
      if(typeof m.id!=='string'||m.id.length>64){postMessage({type:'rpc',id:typeof m.id==='string'?m.id.slice(0,64):'',error:'bad RPC'});return;}
      if(xpuCommitting){postMessage({type:'rpc',id:m.id,result:{cancelled:false,commitInProgress:true}});return;}
      xpuCancelEpoch++;xpuJob?.controller.abort();xpuDraft=null;postMessage({type:'rpc',id:m.id,result:{cancelled:true}});return;
    }
    if(rpcBusy){postMessage({type:'rpc',id:m.id,error:'another management request is active'});return;}
    rpcBusy=true;rpc(m).then(result=>postMessage({type:'rpc',id:m.id,result}),error=>postMessage({type:'rpc',id:m.id,error:message(error)})).finally(()=>{rpcBusy=false;});
  }
};
async function main(){
  if(!self.isSecureContext || !navigator.locks || !self.indexedDB || !crypto.subtle) throw new Error('secure context, Web Locks, IndexedDB and Web Crypto are required');
  await navigator.locks.request(VALIDATION_PROFILE?'ja21-semisili-validation-v1:writer':'ja21-ssd:nvme0n1:writer-v2',{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('another window owns this volume; close it and retry');
    ownsLock=true;
    const held=new Promise(resolve=>{releaseLock=resolve;});
    try{await boot();}catch(error){phase='failed';disk.error=message(error);postMessage({type:'error',message:disk.error,phase});}
    await held;
  });
}
main().catch(error=>{phase='failed';postMessage({type:'error',message:message(error),phase});});
