/** Node integration adapter: real worker/module/kernel/framing, test-double IDB and lock broker. */
import { parentPort, workerData } from 'node:worker_threads';
import { fakeIndexedDB } from './fake-idb.mjs';
let rid=0;const waiting=new Map();
const broker=(op)=>new Promise(resolve=>{const id=++rid;waiting.set(id,resolve);parentPort.postMessage({kind:'lock',op,id});});
globalThis.self=globalThis;globalThis.isSecureContext=true;
globalThis.indexedDB=fakeIndexedDB(workerData.records,records=>parentPort.postMessage({kind:'commit',records}),workerData.faults);
Object.defineProperty(globalThis,'navigator',{value:{locks:{async request(name,options,callback){const acquired=await broker('acquire');try{return await callback(acquired?{name}:null);}finally{if(acquired)await broker('release');}}}},configurable:true});
globalThis.postMessage=(data,transfer=[])=>parentPort.postMessage({kind:'app',data},transfer);
parentPort.on('message',m=>{if(m.kind==='lock-result'){waiting.get(m.id)?.(m.result);waiting.delete(m.id);}else if(m.kind==='message')self.onmessage?.({data:m.data,ports:m.ports || []});});
await import('../src/vendor/ram-worker.js');
