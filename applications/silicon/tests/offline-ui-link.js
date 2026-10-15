import { russlOperation } from '../vendor/spiral/russl-service.js';
/** OFFLINE UI TEST FIXTURE ONLY. Real shell/field model; in-memory adapter, no IndexedDB or transport claim. */
import { SpiralKernel } from '../vendor/spiral/kernel.js';
import { Hpu } from '../vendor/spiral/hpu.js';
import { VERSION } from '../version.js';
export class RamLink extends EventTarget {
 constructor(){super();this.sockets=new Map();this.epoch='offline-fixture';this.snapshot=null;this.hpuSnapshot=null;}
 event(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
 async start(){this.destroy();this.epoch='offline-fixture';const hpu=new Hpu();if(this.hpuSnapshot)hpu.load(this.hpuSnapshot);this.hpu=hpu;const host={hpu,version:()=>VERSION,disk:()=>({model:'OFFLINE UI TEST DOUBLE',synced:true,writtenAt:Date.now()}),afterCommand:()=>this.save(),hpuTouch:()=>{this.hpuSnapshot=hpu.save();this.event('holo',hpu.preview());},sync:()=>this.save()};this.kernel=new SpiralKernel({hostBridge:host});this.kernel.vfs.mkdir('/var/hpu',{recursive:true});if(this.snapshot)this.kernel.vfs.importSnapshot(this.snapshot);this.kernel.on('data',e=>this.sockets.get(e.sessionId)?.data(e.chunk));this.kernel.on('exit',e=>this.sockets.get(e.sessionId)?.close(e.reason));setTimeout(()=>this.event('holo',hpu.preview()),0);return {version:VERSION};}
 save(){this.snapshot=this.kernel.vfs.exportSnapshot();this.hpuSnapshot=this.hpu.save();}
 async open({cols,rows,onData,onClose}){const k=this.kernel,o=k.openSession({cols,rows,deferStart:true});let closed=false;const s={sid:o.sessionId,data:onData,write:x=>k.write(o.sessionId,x),resize:(c,r)=>k.resize(o.sessionId,c,r),signal:()=>k.signal(o.sessionId,'SIGINT'),status:async()=>k.status(o.sessionId),close:reason=>{if(closed)return;closed=true;this.sockets.delete(o.sessionId);k.closeSession(o.sessionId);onClose(reason || 'closed');}};this.sockets.set(o.sessionId,s);k.startSession(o.sessionId);return s;}
 async rpc(op,m={}){const k=this.kernel;switch(op){case 'russl':{const result=await russlOperation({vfs:k.vfs,host:k.host},m.action,m.args || {});this.save();return result;}case 'commands':return k.registry.list().map(d=>({name:d.name,summary:d.summary,usage:d.usage}));case 'files':return k.vfs.readdir(m.path);case 'file':{const v=k.vfs.readFile(m.path);return {bytes:typeof v==='string'?new TextEncoder().encode(v):v};}case 'preview':return this.hpu.preview();case 'sync':this.save();return k.host.disk();case 'backup':this.save();return JSON.stringify({fixture:true,snap:this.snapshot});case 'power':this.save();this.destroy();this.event('halt',{reboot:!!m.reboot});return {stopped:true};default:throw new Error('not implemented in offline fixture: '+op);}}
 destroy(){for(const s of [...this.sockets.values()])s.close();this.sockets.clear();this.epoch=null;}
}
