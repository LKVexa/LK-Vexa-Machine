// Real RamLink lifecycle with controlled worker failures; no browser, storage, host process or UAC.
import test from 'node:test';
import assert from 'node:assert/strict';
import {RamLink} from '../src/lib/ram-link.js';
import {PROTOCOL} from '../src/vendor/vws/frame.js';
let workerSerial=0;
class WorkerFixture {
  static created=[];
  constructor(){this.number=++workerSerial;this.epoch='fixture-epoch-'+this.number;this.ports=[];this.rpc=[];this.terminated=false;WorkerFixture.created.push(this);}
  postMessage(message,ports=[]){if(message.type==='rpc'){this.rpc.push(message);return;}if(message.type==='attach'){
    const port=ports[0];this.ports.push(port);port.onmessage=e=>{const m=e.data;if(m?.type==='session.open')port.postMessage({v:3,epoch:this.epoch,sid:'fixture-session-'+this.number,type:'session.opened',payload:{}});};port.start();port.postMessage({v:3,epoch:this.epoch,sid:null,type:'hello',payload:{protocol:PROTOCOL}});
  }}
  ready(){this.onmessage?.({data:{type:'ready',protocol:PROTOCOL,epoch:this.epoch}});}
  fail(kind){if(kind==='execution')this.onerror?.({message:'fixture execution failure'});else if(kind==='control')this.onmessage?.({data:{type:'error',message:'fixture worker fatal control'}});else this.onmessageerror?.({});}
  terminate(){this.terminated=true;for(const p of this.ports)p.close();this.ports.length=0;}
}
const lastWorker=()=>WorkerFixture.created.at(-1);
function fixture(t){const original=globalThis.Worker;globalThis.Worker=WorkerFixture;const link=new RamLink();t.after(()=>{link.destroy('fixture cleanup');globalThis.Worker=original;});return link;}
for(const kind of ['execution','control','decode']){
  test('pre-ready '+kind+' failure tears down before notifying and can restart',async t=>{
    const link=fixture(t),faults=[],boot=link.start(),worker=lastWorker(),rejected=assert.rejects(boot,/fixture|decode|message/i);
    link.addEventListener('fault',e=>faults.push({message:e.detail.message,worker:link.worker,epoch:link.epoch,ready:link.ready,sockets:link.sockets.size,pending:link.pending.size,terminated:worker.terminated}));
    worker.fail(kind);await rejected;assert.equal(faults.length,1);assert.equal(faults[0].worker,null);assert.equal(faults[0].epoch,null);assert.equal(faults[0].ready,null);assert.equal(faults[0].sockets,0);assert.equal(faults[0].pending,0);assert.equal(faults[0].terminated,true);assert.match(faults[0].message,/fixture|decode|message/i);
    const restarted=link.start(),next=lastWorker();assert.notEqual(next,worker);next.ready();await restarted;assert.equal(link.epoch,next.epoch);worker.onmessage?.({data:{type:'ready',protocol:PROTOCOL,epoch:'stale'}});assert.equal(link.epoch,next.epoch);
  });
  test('post-ready '+kind+' failure rejects open-session waiters and management requests before notifying',async t=>{
    const link=fixture(t),boot=link.start(),worker=lastWorker();worker.ready();await boot;const closed=[];const socket=await link.open({onClose:reason=>closed.push(reason)});assert.ok(socket.sid);assert.equal(link.sockets.size,1);
    const rpc=assert.rejects(link.rpc('sync'),/fixture|failure|message|decode/i),status=assert.rejects(socket.status(),/fixture|failure|message|decode/i),input=assert.rejects(socket.writeBytesAccepted(new TextEncoder().encode('echo fixture\r')),/fixture|failure|message|decode/i);
    const faults=[];link.addEventListener('fault',e=>faults.push({message:e.detail.message,worker:link.worker,epoch:link.epoch,ready:link.ready,sockets:link.sockets.size,pending:link.pending.size,closed:closed.length,terminated:worker.terminated}));
    worker.fail(kind);await Promise.all([rpc,status,input]);assert.equal(faults.length,1);assert.equal(faults[0].worker,null);assert.equal(faults[0].epoch,null);assert.equal(faults[0].ready,null);assert.equal(faults[0].sockets,0);assert.equal(faults[0].pending,0);assert.equal(faults[0].closed,1);assert.equal(faults[0].terminated,true);assert.throws(()=>socket.write('late'),/closed/);assert.match(faults[0].message,/fixture|decode|message/i);
    const restarted=link.start(),next=lastWorker();next.ready();await restarted;const replacement=await link.open();assert.notEqual(replacement.sid,socket.sid);assert.equal(link.epoch,next.epoch);replacement.close();assert.equal(link.sockets.size,0);
  });
}
