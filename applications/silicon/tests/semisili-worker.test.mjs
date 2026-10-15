import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {VFS} from '../src/vendor/spiral/vfs.js';
import {STATE_PATH,RECEIPT_PATH,loadModel} from '../src/lib/semisili-model.js';
import {encodeData,decodeData,KIND_INPUT,KIND_OUTPUT} from '../src/vendor/vws/frame.js';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cpuArgs={requireGpu:false,prime:2,precision:8,operation:'add',operand:1,steps:1,source:'field'};
const digest=text=>createHash('sha256').update(text).digest('hex');
class Broker {
  constructor(records=[]){this.records=structuredClone(records);this.owner=null;this.children=[];}
  launch(faults={},gpuFixture=false) {
    const worker=new Worker(new URL('./semisili-worker-adapter.mjs',import.meta.url),{workerData:{records:structuredClone(this.records),faults,gpuFixture}});
    const messages=[];let dead=false,error=null,id=0;
    worker.on('error',e=>{error=e;});
    worker.on('message',m=>{
      if(m.kind==='lock') {
        let result=false;
        if(m.op==='acquire'&&!this.owner){this.owner=worker;result=true;}
        else if(m.op==='release'&&this.owner===worker){this.owner=null;result=true;}
        worker.postMessage({kind:'lock-result',id:m.id,result});
      }else if(m.kind==='commit')this.records=structuredClone(m.records);
      else messages.push(m);
    });
    worker.on('exit',()=>{dead=true;if(this.owner===worker)this.owner=null;});this.children.push(worker);
    const wait=async(predicate,after=0)=>{const start=Date.now();while(Date.now()-start<5000){
      const found=messages.slice(after).find(predicate);if(found)return found;
      if(error)throw error;if(dead)throw new Error('fixture worker exited');await delay(2);
    }throw new Error('fixture worker message timeout');};
    const send=(data,ports=[])=>worker.postMessage({kind:'message',data,ports},ports);
    return {worker,messages,send,wait,ready:()=>wait(m=>m.kind==='app'&&['ready','error'].includes(m.data.type)).then(m=>m.data),
      async rpc(op,args={}) {const key=String(++id),after=messages.length;send({type:'rpc',id:key,op,...args});
        const response=(await wait(m=>m.kind==='app'&&m.data.type==='rpc'&&m.data.id===key,after)).data;
        if(response.error)throw new Error(response.error);return response.result;},
      async control(operation,args={}){const key='control-'+(++id),after=messages.length;worker.postMessage({kind:'control',id:key,operation,...args});await wait(m=>m.kind==='fixture-control'&&m.id===key,after);},
      event:name=>wait(m=>m.kind==='fixture-event'&&m.event===name),
      async terminate(){await worker.terminate();if(this.owner===worker)this.owner=null;}};
  }
  async close(){await Promise.all(this.children.map(w=>w.terminate()));this.owner=null;}
}
async function started(t,records=[],faults={},gpuFixture=false) {
  const broker=new Broker(records);t.after(()=>broker.close());const client=broker.launch(faults,gpuFixture);
  assert.equal((await client.ready()).type,'ready');return {broker,client};
}
const snapshot=broker=>JSON.stringify(broker.records);
const run=(client,args=cpuArgs)=>client.rpc('xpu',{action:'run',args});
const apply=(client,token)=>client.rpc('xpu',{action:'apply',args:{token}});
const info=client=>client.rpc('xpu',{action:'info'});
async function terminal(client,epoch){
  const {port1,port2}=new MessageChannel(),messages=[];let sid=null,seq=0,received=0,text='',request=0;
  const send=(type,payload={},rid)=>port1.postMessage({v:3,epoch,sid,type,payload,rid});
  port1.on('message',m=>{if(m instanceof Uint8Array||m instanceof ArrayBuffer){const f=decodeData(m);assert.equal(f.kind,KIND_OUTPUT);text+=new TextDecoder().decode(f.payload);received+=f.payload.length;send('flow.ack',{consumedBytes:received});}
    else{messages.push(m);if(m.type==='hello')send('session.open',{cols:80,rows:24});else if(m.type==='session.opened'){sid=m.sid;send('session.start');}}});
  const wait=async predicate=>{const begin=Date.now();while(Date.now()-begin<5000){if(predicate())return;await delay(2);}throw new Error('fixture terminal timeout '+text.slice(-100));};
  client.send({type:'attach'},[port2]);await wait(()=>sid!==null);
  return {async command(line){const start=text.length;port1.postMessage(encodeData(KIND_INPUT,++seq,new TextEncoder().encode(line+'\r')));await wait(()=>text.slice(start).includes('\r\n'));await delay(10);
    for(let i=0;i<100;i++){const rid='status'+(++request);send('session.status',{},rid);await wait(()=>messages.some(m=>m.rid===rid));if(!messages.find(m=>m.rid===rid).payload.busy)return;await delay(10);}throw new Error('fixture command remains busy');},
    close(){try{send('session.close');}catch{}port1.close();}};
}
function modifiedBackup(text,path,content) {
  const record=JSON.parse(text),vfs=new VFS({seed:false,maxBytes:2*1024*1024,maxNodes:1500});
  vfs.importSnapshot(record.snap);vfs.writeFile(path,content);record.snap=vfs.exportSnapshot();record.sha256=digest(JSON.stringify(record.snap));
  return JSON.stringify(record);
}

test('XPU preview validates CPU results without a volume write or live field publication (storage/lock fixtures)',async t=>{
  const {broker,client}=await started(t),before=snapshot(broker),field=await client.rpc('preview');
  const candidate=await run(client);assert.equal(candidate.canApply,true);assert.equal(candidate.receipt.status,'CPU_VALIDATED');
  assert.equal(candidate.receipt.publication,'PREVIEW');assert.equal(candidate.receipt.gpu.gpu.hardwareConfirmed,false);
  assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);assert.equal((await info(client)).present,false);
});

test('required GPU absent never permits apply or changes the resident field (actual Node capability, storage/lock fixtures)',async t=>{
  const {broker,client}=await started(t),before=snapshot(broker),field=await client.rpc('preview');
  const candidate=await run(client,{...cpuArgs,requireGpu:true});assert.equal(candidate.canApply,false);assert.equal(candidate.receipt.status,'GPU_REQUIREMENT_UNMET');
  assert.equal(candidate.receipt.gpu.status,'GPU_UNAVAILABLE');await assert.rejects(apply(client,candidate.token),/GPU confirmation/);
  assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);
});

test('explicit CPU save and reboot restore exact model state and historical receipt (storage/lock fixtures)',async t=>{
  const {broker,client}=await started(t),candidate=await run(client),saved=await apply(client,candidate.token);
  assert.equal(saved.saved,true);assert.equal(saved.receipt.publication,'COMMITTED');
  const current=(await info(client)).savedReceipt;assert.equal(current.historical,false);assert.equal(current.freshHardwareConfirmation,false);
  const state=await client.rpc('file',{path:STATE_PATH}),receipt=await client.rpc('file',{path:RECEIPT_PATH}),field=await client.rpc('preview');
  assert.equal(loadModel(new TextDecoder().decode(state.bytes)).current.sequence,1);
  await client.rpc('power',{reboot:true});await client.terminate();
  const restored=broker.launch();assert.equal((await restored.ready()).restored,true);
  assert.deepEqual((await restored.rpc('file',{path:STATE_PATH})).bytes,state.bytes);
  assert.deepEqual((await restored.rpc('file',{path:RECEIPT_PATH})).bytes,receipt.bytes);assert.deepEqual(await restored.rpc('preview'),field);
  const restoredInfo=await info(restored);assert.equal(restoredInfo.savedReceipt.historical,true);assert.equal(restoredInfo.savedReceipt.freshHardwareConfirmation,false);
  assert.equal(restoredInfo.draft,null);assert.equal(restoredInfo.sequence,1);
});

for(const edit of ['receipt','state','hpu'])test('current CPU receipt becomes historical after '+edit+' edit through the real console transport (storage/lock fixtures)',async t=>{
  const {client}=await started(t),candidate=await run(client);await apply(client,candidate.token);
  const before=(await info(client)).savedReceipt;assert.equal(before.historical,false);assert.equal(before.freshHardwareConfirmation,false);
  assert.equal((await info(client)).savedReceipt.historical,false);
  const term=await terminal(client,(await client.ready()).epoch);t.after(()=>term.close());
  if(edit==='hpu')await term.command('hpu gate xor 1 0');
  else if(edit==='state'){
    await term.command('cp '+STATE_PATH+' /tmp/prior-xpu-state');
    const later=await run(client,{...cpuArgs,source:'bank'});await apply(client,later.token);
    assert.notEqual((await info(client)).savedReceipt.stateSha256,before.stateSha256);
    assert.equal((await info(client)).savedReceipt.historical,false);
    await term.command('cp /tmp/prior-xpu-state '+STATE_PATH);
  }else await term.command('echo >> '+RECEIPT_PATH);
  const after=(await info(client)).savedReceipt;assert.equal(after.historical,true);assert.equal(after.freshHardwareConfirmation,false);
});

test('a concurrent volume revision invalidates an otherwise valid XPU preview (storage/lock fixtures)',async t=>{
  const {broker,client}=await started(t),candidate=await run(client);
  const staged=await client.rpc('russl',{action:'info'});await client.rpc('russl',{action:'capture',args:{expected:staged.revision}});
  const before=snapshot(broker),field=await client.rpc('preview');await assert.rejects(apply(client,candidate.token),/stale/);
  assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);
});

test('malformed model and receipt restores reject before any durable or live replacement (storage/lock fixtures)',async t=>{
  const {broker,client}=await started(t),candidate=await run(client);await apply(client,candidate.token);
  const backup=await client.rpc('backup'),before=snapshot(broker),field=await client.rpc('preview');
  for(const path of [STATE_PATH,RECEIPT_PATH]) {
    await assert.rejects(client.rpc('restore',{text:modifiedBackup(backup,path,'malformed-json')}));
    assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);
    assert.equal((await info(client)).present,true);
  }
});

test('valid JSON receipt with wrong state digest or incoherent GPU status cannot be restored (storage/lock fixtures)',async t=>{
  const {broker,client}=await started(t),candidate=await run(client);await apply(client,candidate.token);
  const backup=await client.rpc('backup'),before=snapshot(broker),field=await client.rpc('preview');
  const saved=JSON.parse(new TextDecoder().decode((await client.rpc('file',{path:RECEIPT_PATH})).bytes));
  const malformed=[{...saved,stateSha256:'0'.repeat(64)},{...saved,status:'CPU_AND_GPU_CONFIRMED'}];
  for(const receipt of malformed){
    await assert.rejects(client.rpc('restore',{text:modifiedBackup(backup,RECEIPT_PATH,JSON.stringify(receipt))}),/receipt|checksum/);
    assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);
    assert.equal((await info(client)).savedReceipt.status,'CPU_VALIDATED');
  }
});

test('restored GPU history rejects fixture, fallback, unknown, and mismatched coverage; coherent history remains historical (synthetic receipt fixture)',async t=>{
  const {broker,client}=await started(t),candidate=await run(client);await apply(client,candidate.token);
  const backup=await client.rpc('backup');
  const saved=JSON.parse(new TextDecoder().decode((await client.rpc('file',{path:RECEIPT_PATH})).bytes));
  // This synthetic historical data checks validation only. It is not a GPU run.
  const proof={...saved,status:'CPU_AND_GPU_CONFIRMED',coverage:{...saved.coverage,gpu:['finite ring arithmetic']},
    gpu:{schema:'JA21-FINITE-GPU-CONFIRMATION/1',fixture:false,status:'GPU_CONFIRMED',
      gpu:{apiConfirmed:true,hardwareConfirmed:true,fallback:false},
      comparison:{status:'PASS',mismatches:0,elements:4096},
      coverage:{stage:'finite-arithmetic',samples:4096,modulus:256,operation:'add'}}};
  const mutations=[
    r=>{r.gpu.fixture=true;},r=>{r.gpu.gpu.fallback=true;},r=>{r.gpu.gpu.fallback=null;},
    r=>{r.gpu.comparison.elements=4095;},r=>{r.gpu.coverage.samples=4095;},
    r=>{r.gpu.coverage.operation='sub';},r=>{r.gpu.coverage.modulus=65536;},
    r=>{r.gpu.gpu.apiConfirmed=false;},r=>{r.summary.cpu.comparisonElements=4095;},
    r=>{r.status='CPU_VALIDATED';},
  ];
  const before=snapshot(broker),field=await client.rpc('preview');
  for(const mutate of mutations){const invalid=structuredClone(proof);mutate(invalid);
    await assert.rejects(client.rpc('restore',{text:modifiedBackup(backup,RECEIPT_PATH,JSON.stringify(invalid))}),/incoherent/);
    assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);
  }
  // Positive structural control prevents a common invalid template masking the guards.
  await client.rpc('restore',{text:modifiedBackup(backup,RECEIPT_PATH,JSON.stringify(proof))});
  await client.terminate();const restored=broker.launch();assert.equal((await restored.ready()).type,'ready');
  const history=(await info(restored)).savedReceipt;assert.equal(history.historical,true);assert.equal(history.freshHardwareConfirmation,false);
  const fresh=await run(restored,{...cpuArgs,requireGpu:true});assert.equal(fresh.canApply,false);
  assert.equal(fresh.receipt.status,'GPU_REQUIREMENT_UNMET');await assert.rejects(apply(restored,fresh.token),/GPU confirmation/);
});

test('VFS quota exhaustion prevents apply without changing the prior volume or live field (quota fixture)',async t=>{
  const initial=await started(t);const record=JSON.parse(await initial.client.rpc('backup'));
  const vfs=new VFS({seed:false,maxBytes:2*1024*1024,maxNodes:1500});vfs.importSnapshot(record.snap);
  vfs.writeFile('/tmp/quota-fill','x'.repeat(2*1024*1024-vfs.usedBytes-1024));record.snap=vfs.exportSnapshot();record.sha256=digest(JSON.stringify(record.snap));
  await initial.client.terminate();const {broker,client}=await started(t,[['nvme0n1',record]]);
  const before=snapshot(broker),field=await client.rpc('preview'),candidate=await run(client);
  await assert.rejects(apply(client,candidate.token),/quota/);assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);
});

test('IndexedDB write failure preserves the exact prior committed and resident state (failure fixture)',async t=>{
  const initial=await started(t),records=structuredClone(initial.broker.records);await initial.client.terminate();
  const {broker,client}=await started(t,records,{failWrite:true}),before=snapshot(broker),field=await client.rpc('preview'),candidate=await run(client);
  await assert.rejects(apply(client,candidate.token),/write failure/);assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);
});

for(const skip of [0,2])test('cancel during run digest '+skip+' prevents a late preview or write (digest/storage/lock fixtures)',async t=>{
  const {broker,client}=await started(t),before=snapshot(broker);await client.control('gate-digest',{skip});
  const pending=run(client);const rejected=assert.rejects(pending,/cancelled/);await client.event('digest-paused');
  assert.equal((await client.rpc('xpu-cancel')).cancelled,true);await client.control('release-gates');await rejected;
  assert.equal((await info(client)).draft,null);assert.equal(snapshot(broker),before);
});

test('cancelling apply before its final digest does not commit or publish (digest/storage/lock fixtures)',async t=>{
  const {broker,client}=await started(t),candidate=await run(client),before=snapshot(broker),field=await client.rpc('preview');
  await client.control('gate-digest',{skip:2});const pending=apply(client,candidate.token),rejected=assert.rejects(pending,/cancelled/);
  await client.event('digest-paused');assert.equal((await client.rpc('xpu-cancel')).cancelled,true);await client.control('release-gates');await rejected;
  assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);assert.equal((await info(client)).draft,null);
});

test('cancellation honestly reports a durable commit already underway (delayed IDB completion fixture)',async t=>{
  const {client}=await started(t),candidate=await run(client);await client.control('gate-commit');
  const pending=apply(client,candidate.token);await client.event('commit-completion-paused');
  const cancellation=await client.rpc('xpu-cancel');assert.equal(cancellation.cancelled,false);assert.equal(cancellation.commitInProgress,true);
  await client.control('release-gates');assert.equal((await pending).saved,true);assert.equal((await info(client)).present,true);
});

test('cancel during GPU mapping prevents late preview and any state write (marked GPU/storage/lock fixtures)',async t=>{
  const {broker,client}=await started(t,[],{},true),before=snapshot(broker),field=await client.rpc('preview');
  const pending=run(client,{...cpuArgs,requireGpu:true}),rejected=assert.rejects(pending,/cancelled/);await client.event('gpu-map-paused');
  assert.equal((await client.rpc('xpu-cancel')).cancelled,true);await client.control('release-gates');await rejected;
  assert.equal((await info(client)).draft,null);assert.equal(snapshot(broker),before);assert.deepEqual(await client.rpc('preview'),field);
});

test('malformed cancellation RPC cannot interrupt a legitimate job (marked GPU/storage/lock fixtures)',async t=>{
  const {client}=await started(t,[],{},true);const pending=run(client,{...cpuArgs,requireGpu:true});await client.event('gpu-map-paused');
  const badId='x'.repeat(65),after=client.messages.length;client.send({type:'rpc',id:badId,op:'xpu-cancel'});
  const response=await client.wait(m=>m.kind==='app'&&m.data.type==='rpc'&&m.data.id===badId.slice(0,64),after);assert(response.data.error);
  await client.control('release-gates');const result=await pending;
  assert.equal(result.receipt.status,'GPU_REQUIREMENT_UNMET');assert.equal(result.receipt.gpu.fixture,true);assert.equal(result.receipt.gpu.gpu.hardwareConfirmed,false);
});
