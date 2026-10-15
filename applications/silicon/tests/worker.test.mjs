import test from 'node:test';import assert from 'node:assert/strict';import { Worker,MessageChannel } from 'node:worker_threads';
import { encodeData,decodeData,KIND_INPUT,KIND_OUTPUT } from '../src/vendor/vws/frame.js';
import { VERSION } from '../src/version.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
class Broker {
 constructor(){this.records=[];this.owner=null;this.children=[];}
 launch(faults={}){const worker=new Worker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{records:structuredClone(this.records),faults}});const messages=[];let dead=false;worker.on('message',m=>{if(m.kind==='lock'){let result=false;if(m.op==='acquire' && !this.owner){this.owner=worker;result=true;}else if(m.op==='release' && this.owner===worker){this.owner=null;result=true;}worker.postMessage({kind:'lock-result',id:m.id,result});}else if(m.kind==='commit'){this.records=structuredClone(m.records);}else if(m.kind==='app')messages.push(m.data);});worker.on('exit',()=>{dead=true;if(this.owner===worker)this.owner=null;});this.children.push(worker);
  const wait=async (predicate,after=0)=>{const start=Date.now();while(Date.now()-start<5000){const m=messages.slice(after).find(predicate);if(m)return m;if(dead)throw new Error('worker exited');await delay(5);}throw new Error('worker message timeout: '+messages.map(m=>m.type+':'+(m.message || '')).join(','));};
  let id=0;
  return {worker,messages,wait,ready:()=>wait(m=>m.type==='ready' || m.type==='error'),send:(data,ports=[])=>worker.postMessage({kind:'message',data,ports},ports),rpc:async(op,args={})=>{const key=String(++id),after=messages.length;worker.postMessage({kind:'message',data:{type:'rpc',id:key,op,...args}});const m=await wait(m=>m.type==='rpc' && m.id===key,after);if(m.error)throw new Error(m.error);return m.result;},terminate:async()=>{await worker.terminate();if(this.owner===worker)this.owner=null;}};
 }
 async close(){await Promise.all(this.children.map(w=>w.terminate()));this.owner=null;}
}
async function terminal(client,epoch,{ack=true,cols=80,rows=24}={}){
 const {port1,port2}=new MessageChannel();const messages=[];let sid=null,text='',received=0,seq=0,request=0;
 const send=(type,payload={},rid)=>port1.postMessage({v:3,epoch,sid,type,payload,rid});
 port1.on('message',m=>{if(m instanceof Uint8Array || m instanceof ArrayBuffer){const f=decodeData(m);assert.equal(f.kind,KIND_OUTPUT);text+=new TextDecoder().decode(f.payload);received+=f.payload.length;if(ack)send('flow.ack',{consumedBytes:received});}else{messages.push(m);if(m.type==='hello')send('session.open',{cols,rows});else if(m.type==='session.opened'){sid=m.sid;send('session.start');}}});
 client.send({type:'attach'},[port2]);
 const wait=async predicate=>{const start=Date.now();while(Date.now()-start<5000){if(predicate())return;await delay(5);}throw new Error('terminal timeout '+text.slice(-300));};
 await wait(()=>sid!==null || messages.some(m=>m.type==='error'));
 return {get text(){return text;},get sid(){return sid;},port:port1,messages,send,write(data){port1.postMessage(encodeData(KIND_INPUT,++seq,new TextEncoder().encode(data)));},wait,async command(line){const start=text.length;this.write(line+'\r');await wait(()=>text.slice(start).includes('\r\n'));await delay(20);await this.idle();},async idle(){for(let i=0;i<100;i++){const rid=`status${++request}`;send('session.status',{},rid);await wait(()=>messages.some(m=>m.rid===rid));const st=messages.find(m=>m.rid===rid).payload;if(!st.busy)return;await delay(20);}throw new Error('command not idle');},close(){try{send('session.close');}catch{}port1.close();}};
}
test('real Node worker integration with explicit storage/lock test doubles',async t=>{
 const broker=new Broker();t.after(()=>broker.close());let client=broker.launch(),ready=await client.ready();assert.equal(ready.type,'ready');let term=await terminal(client,ready.epoch);t.after(()=>term.close());
 await t.test('boot publishes consistent version and protocol',()=>{assert.equal(ready.version,VERSION);assert.equal(ready.protocol,'hermit.vws.v3');assert(broker.records.some(([k])=>k==='nvme0n1'));});
 await t.test('binary command input traverses parser and VFS',async()=>{await term.command('echo durable > /tmp/probe');const file=await client.rpc('file',{path:'/tmp/probe'});assert.equal(new TextDecoder().decode(file.bytes),'durable\n');});
 await t.test('command registry exposes descriptors',async()=>{const commands=await client.rpc('commands');assert(commands.length>40);assert(commands.some(c=>c.name==='xpuinfo'));assert(commands.every(c=>typeof c.summary==='string'));});
 await t.test('all twenty modeled gates execute over transport',async()=>{for(const op of ['and','or','nand','xor','xnor'])for(const a of [0,1])for(const b of [0,1])await term.command(`hpu gate ${op} ${a} ${b}`);assert.match(term.text,/XOR/);});
 await t.test('byte command persists seven TIFFs and HPU state',async()=>{await term.command('hpu bytes');const files=await client.rpc('files',{path:'/var/hpu'});assert.equal(files.filter(f=>/^processor-\d\.tif$/.test(f.name)).length,7);assert(files.some(f=>f.name==='field.bin'));const record=JSON.parse(await client.rpc('backup'));assert.equal(record.v,2);assert.equal(record.sha256.length,64);});
 await t.test('second window is blocked without modifying the volume',async()=>{const before=JSON.stringify(broker.records);const second=broker.launch();const blocked=await second.ready();assert.equal(blocked.type,'error');assert.match(blocked.message,/another window/);await second.terminate();assert.equal(JSON.stringify(broker.records),before);});
 await t.test('invalid acknowledgement closes only its session',async()=>{const extra=await terminal(client,ready.epoch);extra.send('flow.ack',{consumedBytes:Number.MAX_SAFE_INTEGER});await extra.wait(()=>extra.messages.some(m=>m.type==='session.exit'));extra.close();await term.command('echo still-alive');assert.match(term.text,/still-alive/);});
 await t.test('legacy control version is rejected without a worker crash',async()=>{const extra=await terminal(client,ready.epoch);extra.port.postMessage({v:2,epoch:ready.epoch,sid:extra.sid,type:'session.status',payload:{}});await extra.wait(()=>extra.messages.some(m=>m.type==='session.exit'));extra.close();assert((await client.rpc('commands')).length>40);});
 await t.test('wrong sequence closes offending session',async()=>{const extra=await terminal(client,ready.epoch);extra.port.postMessage(encodeData(KIND_INPUT,9,new TextEncoder().encode('echo bad\r')));await extra.wait(()=>extra.messages.some(m=>m.type==='session.exit'));extra.close();});
 await t.test('null control record cannot crash worker',async()=>{const extra=await terminal(client,ready.epoch);extra.port.postMessage(null);await extra.wait(()=>extra.messages.some(m=>m.type==='session.exit'));extra.close();assert((await client.rpc('commands')).length>40);});
 await t.test('invalid restore is rejected without changing storage',async()=>{const before=JSON.stringify(broker.records);const record=JSON.parse(await client.rpc('backup'));record.sha256='0'.repeat(64);await assert.rejects(()=>client.rpc('restore',{text:JSON.stringify(record)}),/checksum/);assert.equal(JSON.stringify(broker.records),before);});
 await t.test('poweroff stays halted and stops sessions',async()=>{await client.rpc('power',{reboot:false});const halted=await client.wait(m=>m.type==='halt');assert.equal(halted.reboot,false);await assert.rejects(()=>client.rpc('commands'),/not ready/);term.close();await client.terminate();});
 await t.test('next boot restores the exact virtual file and XPU lanes',async()=>{client=broker.launch();ready=await client.ready();assert.equal(ready.type,'ready');assert.equal(ready.restored,true);const file=await client.rpc('file',{path:'/tmp/probe'});assert.equal(new TextDecoder().decode(file.bytes),'durable\n');const p=await client.rpc('preview');assert.equal(p.byteStages.length,7);term=await terminal(client,ready.epoch);});
 await t.test('validated restore keeps a previous committed volume',async()=>{const original=await client.rpc('backup');await term.command('echo changed > /tmp/probe');const result=await client.rpc('restore',{text:original});assert(result.restart);const previous=JSON.parse(await client.rpc('backup',{previous:true}));assert(previous.snap);await client.terminate();term.close();client=broker.launch();ready=await client.ready();assert.equal(ready.type,'ready');const file=await client.rpc('file',{path:'/tmp/probe'});assert.equal(new TextDecoder().decode(file.bytes),'durable\n');term=await terminal(client,ready.epoch);});
 await t.test('reboot emits reboot flag instead of silently powercycling',async()=>{await client.rpc('power',{reboot:true});const halted=await client.wait(m=>m.type==='halt');assert.equal(halted.reboot,true);});
});
test('corrupt volume boot fails closed and raw backup remains available',async t=>{const b=new Broker();t.after(()=>b.close());const c=b.launch();assert.equal((await c.ready()).type,'ready');await c.terminate();const entries=structuredClone(b.records);entries.find(([k])=>k==='nvme0n1')[1].sha256='invalid';b.records=entries;const before=JSON.stringify(b.records),bad=b.launch(),status=await bad.ready();assert.equal(status.type,'error');assert.match(status.message,/checksum/);assert.equal(JSON.stringify(b.records),before);assert.equal(JSON.parse(await bad.rpc('backup')).sha256,'invalid');});
test('read failure does not initialize over existing storage',async t=>{const b=new Broker();t.after(()=>b.close());b.records=[['nvme0n1',{v:1,snap:{not:'valid'},writtenAt:1}]];const before=JSON.stringify(b.records),c=b.launch({failRead:true});assert.equal((await c.ready()).type,'error');assert.equal(JSON.stringify(b.records),before);});
test('write failure prevents a falsely successful boot',async t=>{const b=new Broker();t.after(()=>b.close());const c=b.launch({failWrite:true});assert.equal((await c.ready()).type,'error');assert.equal(b.records.length,0);});

test('RUSSL management RPC in real Node worker with explicit storage/lock doubles',async t=>{
 const broker=new Broker();t.after(()=>broker.close());let client=broker.launch(),ready=await client.ready();assert.equal(ready.type,'ready');
 let revision,bytes;
 await t.test('capture requires revision token and writes a full f64 TIFF',async()=>{
  const absent=await client.rpc('russl',{action:'info'});assert.equal(absent.present,false);
  await assert.rejects(()=>client.rpc('russl',{action:'capture'}),/revision/);
  const captured=await client.rpc('russl',{action:'capture',args:{expected:absent.revision}});assert.equal(captured.sites,16384);revision=captured.revision;
  const f=await client.rpc('file',{path:captured.path});bytes=f.bytes;assert(bytes.length>131072);
 });
 await t.test('invalid imports and stale writes leave the staged TIFF unchanged',async()=>{
  await assert.rejects(()=>client.rpc('russl',{action:'import',args:{expected:revision,bytes:bytes.slice(0,20)}}));
  await assert.rejects(()=>client.rpc('russl',{action:'edit',args:{expected:'stale',indices:[0,0,0,0,0],value:3}}),/changed/);
  const info=await client.rpc('russl',{action:'info'});assert.equal(info.revision,revision);
 });
 await t.test('edit is staged and explicit apply updates the HPU',async()=>{
  const before=await client.rpc('preview');const edit=await client.rpc('russl',{action:'edit',args:{expected:revision,indices:[0,0,0,0,0],value:0.5}});revision=edit.revision;
  assert.deepEqual((await client.rpc('preview')).phase,before.phase);
  const site=await client.rpc('russl',{action:'get',args:{indices:[0,0,0,0,0]}});assert.equal(site.value,0.5);
  const applied=await client.rpc('russl',{action:'apply',args:{expected:revision}});assert.equal(applied.applied,true);assert.equal((await client.rpc('preview')).op,'RUSSL field apply');
 });
 await t.test('SHA-256 receipt and valid import traverse worker RPC',async()=>{
  const receipt=await client.rpc('russl',{action:'receipt'});assert.equal(receipt.logicalSHA256.length,64);assert.equal(receipt.authentication,false);
  const imported=await client.rpc('russl',{action:'import',args:{expected:revision,bytes}});revision=imported.revision;assert.equal(imported.sites,16384);
  assert.equal((await client.rpc('preview')).op,'RUSSL field apply');
 });
 await t.test('staged TIFF and applied HPU survive a transactional reboot',async()=>{
  await client.rpc('sync');await client.terminate();client=broker.launch();ready=await client.ready();assert.equal(ready.type,'ready');assert.equal(ready.restored,true);
  assert.equal((await client.rpc('russl',{action:'info'})).revision,revision);assert.equal((await client.rpc('preview')).op,'RUSSL field apply');
 });
 await t.test('TIFF apply is blocked while a terminal command is running',async()=>{
  const term=await terminal(client,ready.epoch);term.write('sleep 1\r');await delay(50);
  await assert.rejects(()=>client.rpc('russl',{action:'apply',args:{expected:revision}}),/active commands/);term.send('terminal.signal',{signal:'SIGINT'});await term.idle();term.close();
 });
});
