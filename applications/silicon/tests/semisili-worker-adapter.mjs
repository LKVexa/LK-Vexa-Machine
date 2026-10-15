/** Real production worker source with marked GPU/storage/lock fixtures and timing gates.
 * The GPU import alone is substituted by a wrapper that forces fixture attribution.
 * Storage tests do not establish browser IndexedDB durability or crash semantics.
 */
import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs/promises';
import {fakeIndexedDB} from './fake-idb.mjs';
import {gpuFixture} from './semisili-gpu-fixture.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
let rid=0,digestGate=null,commitGate=null;
const waiting=new Map(),patched=new WeakSet();
const event=name=>parentPort.postMessage({kind:'fixture-event',event:name});
const broker=op=>new Promise(resolve=>{const id=++rid;waiting.set(id,resolve);parentPort.postMessage({kind:'lock',op,id});});
globalThis.self=globalThis;globalThis.isSecureContext=true;
const actualCrypto=globalThis.crypto;
Object.defineProperty(globalThis,'crypto',{value:{randomUUID:actualCrypto.randomUUID.bind(actualCrypto),
  getRandomValues:actualCrypto.getRandomValues.bind(actualCrypto),subtle:{async digest(...args){
    if(digestGate) {
      if(digestGate.skip>0)digestGate.skip--;
      else {const gate=digestGate;digestGate=null;event('digest-paused');await gate.promise;}
    }
    return actualCrypto.subtle.digest(...args);
  }}},configurable:true});
function patchDatabase(db) {
  if(patched.has(db))return;patched.add(db);
  const transaction=db.transaction.bind(db);
  db.transaction=(name,mode)=>{
    const tx=transaction(name,mode);let completion=null;
    Object.defineProperty(tx,'oncomplete',{configurable:true,set(fn){completion=fn;},get(){return (...args)=>{
      if(mode==='readwrite'&&commitGate) {const gate=commitGate;commitGate=null;event('commit-completion-paused');gate.promise.then(()=>completion?.(...args));}
      else completion?.(...args);
    };}});
    return tx;
  };
}
const storage=fakeIndexedDB(workerData.records,records=>parentPort.postMessage({kind:'commit',records}),workerData.faults);
globalThis.indexedDB={open(...args){const request=storage.open(...args);let success=null;
  Object.defineProperty(request,'onsuccess',{configurable:true,set(fn){success=fn;},get(){return (...eventArgs)=>{patchDatabase(request.result);success?.(...eventArgs);};}});
  return request;
}};
Object.defineProperty(globalThis,'navigator',{value:{locks:{async request(name,options,callback){
  const acquired=await broker('acquire');try{return await callback(acquired?{name}:null);}finally{if(acquired)await broker('release');}
}}},configurable:true});
if(workerData.gpuFixture) {
  globalThis.semisiGpuFixture=gpuFixture({mapGate:true});
  globalThis.semisiGpuFixture.mapStarted.then(()=>event('gpu-map-paused'));
}
globalThis.postMessage=(data,transfer=[])=>parentPort.postMessage({kind:'app',data},transfer);
const held=[];
parentPort.on('message',m=>{
  if(m.kind==='lock-result'){waiting.get(m.id)?.(m.result);waiting.delete(m.id);}
  else if(m.kind==='message')self.onmessage?.({data:m.data,ports:m.ports||[]});
  else if(m.kind==='control') {
    if(m.operation==='gate-digest'){digestGate={...deferred(),skip:m.skip||0};held.push(digestGate);}
    else if(m.operation==='gate-commit'){commitGate=deferred();held.push(commitGate);}
    else if(m.operation==='release-gates'){for(const gate of held)gate.resolve();globalThis.semisiGpuFixture?.releaseMap();}
    else throw new Error('unsupported fixture control');
    parentPort.postMessage({kind:'fixture-control',id:m.id});
  }
});
const workerUrl=new URL('../src/vendor/ram-worker.js',import.meta.url);
let source=await fs.readFile(workerUrl,'utf8');
source=source.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_match,_quote,relative)=>{
  const target=relative==='../lib/semisili-gpu.js'?new URL('./semisili-gpu-fixture-wrapper.mjs',import.meta.url):new URL(relative,workerUrl);
  return 'from '+JSON.stringify(target.href);
});
await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
