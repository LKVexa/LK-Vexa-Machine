import test from 'node:test';
import assert from 'node:assert/strict';
import {RamWsClient} from './ramws-client.js';
import {RamWsOwner} from './ramws-owner.js';
import {codec,dataFrame,ownerFrame,decodeOwnerFrame,LIMITS,boundedReason,loopbackBase} from './ramws-wire.js';
import {utf8} from './hermit-codec.js';

const epoch='Epoch_AAAAAAAAAAAAAA',sid='Session_AAAAAAAAAAAAAAAA';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class FakeSocket {
  static created=[];
  constructor(url,protocol){this.url=url;this.protocol=protocol;this.sent=[];this.closes=[];this.readyState=1;this.bufferedAmount=0;FakeSocket.created.push(this);}
  send(value){this.sent.push(value);}
  close(code,reason){this.closes.push({code,reason});this.readyState=3;}
  receive(value){this.onmessage?.({data:value});}
}
const fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify({ticket:'T'.repeat(43)})});
function hello(){return {v:2,type:'hello',payload:{protocol:'hermit.vws.v2',serverEpoch:epoch,profile:'LOCAL_VOLATILE',limits:{envelopeBytes:65536,inputBytes:8192,outputChunkBytes:16384,maxCreditWindowBytes:1048576,maxSessions:8},capabilities:{resume:false,browserPane:false,virtualCommands:true,fabric:false}}};}
const control=(ws,m)=>ws.receive(codec.encode(m,'server_to_client'));
async function clientOpen(options={}){
  const client=new RamWsClient({base:'http://127.0.0.1:8765',fetchImpl,WebSocketImpl:FakeSocket,timeoutMs:1000});
  const pending=client.open(options);await tick();const ws=FakeSocket.created.at(-1);ws.onopen();control(ws,hello());
  const open=JSON.parse(ws.sent.find(x=>typeof x==='string'&&JSON.parse(x).type==='session.open'));
  control(ws,{v:2,type:'session.opened',rid:open.rid,sid,epoch,payload:{cols:100,rows:28}});
  return {client,ws,socket:await pending};
}
test('strict codec rejects duplicate keys, wrong direction, depth, oversized controls and binary caps',()=>{
  assert.throws(()=>codec.decode('{"v":2,"v":2}','server_to_client'),/duplicate/);
  assert.throws(()=>codec.decode(codec.encode(hello(),'server_to_client'),'client_to_server'),/not allowed/);
  assert.throws(()=>codec.decode('['.repeat(10)+'0'+']'.repeat(10),'server_to_client'),/nesting/);
  assert.throws(()=>codec.decode(' '.repeat(65537),'server_to_client'),/large/);
  assert.throws(()=>codec.decodeData(new Uint8Array(8192+8).fill(1),'client_to_server'),/payload/);
});
test('uint48 and monotonic owner channel are exact',()=>{
  for(const n of [1,255,256,2**32-1,2**32,2**48-1]){const f=dataFrame(1,n,Uint8Array.of(65));assert.equal(codec.decodeData(f,'client_to_server').seq,n);}
  assert.throws(()=>dataFrame(1,2**48,Uint8Array.of(65)),/uint48/);
  const f=ownerFrame(0xffffffff,2,2**48-1,Uint8Array.of(240,159,152,128));const d=decodeOwnerFrame(f,'server_to_client');assert.equal(d.channel,0xffffffff);assert.equal(d.seq,2**48-1);assert.deepEqual(d.payload,Uint8Array.of(240,159,152,128));
  assert.throws(()=>ownerFrame(0,1,1,Uint8Array.of(65)),/channel/);
});
test('localhost URL and UTF8 close reason byte caps',()=>{
  assert.equal(loopbackBase('http://127.0.0.1:9000'),'http://127.0.0.1:9000');
  for(const u of ['https://evil.invalid','http://127.0.0.1:9000/path','http://user:pass@127.0.0.1'])assert.throws(()=>loopbackBase(u),/localhost/);
  const reason=boundedReason('😀'.repeat(100));assert.ok(utf8(reason).length<=123);assert.doesNotThrow(()=>new TextDecoder('utf-8',{fatal:true}).decode(utf8(reason)));
});
test('malformed binary fails closed without the original adapter temporal-dead-zone error',async()=>{
  let closed;const {ws}=await clientOpen({onClose:r=>closed=r});assert.doesNotThrow(()=>ws.receive(Uint8Array.of(2).buffer));assert.match(closed,/without payload/);assert.equal(ws.closes.at(-1).code,1002);
});
test('output gap is not published or credited',async()=>{
  const out=[];const {ws}=await clientOpen({onData:s=>out.push(s)});ws.receive(dataFrame(2,2,utf8('untrusted gap')).buffer);await tick();assert.deepEqual(out,[]);assert.equal(ws.closes.at(-1).code,1002);assert.ok(!ws.sent.some(x=>typeof x==='string'&&JSON.parse(x).type==='flow.credit'));
});
test('stale epoch ACK cannot erase pending inputs',async()=>{
  const {ws,socket}=await clientOpen();socket.write('a');control(ws,{v:2,type:'input.ack',sid,epoch:'Stale_AAAAAAAAAAAAAAAA',payload:{acceptedSeq:1,executedSeq:1}});assert.equal(ws.closes.at(-1).code,1002);assert.equal((await socket.status()).acceptedSeq,0);
});
test('input waits for actual accepted ACK and excessive paste is refused before send',async()=>{
  const {ws,socket}=await clientOpen();assert.throws(()=>socket.write('x'.repeat(16385)),/limit/);const promise=socket.writeAccepted('hello');let settled=false;promise.then(()=>settled=true);await tick();assert.equal(settled,false);control(ws,{v:2,type:'input.ack',sid,epoch,payload:{acceptedSeq:1,executedSeq:0}});assert.deepEqual(await promise,{acceptedSeq:1,executedSeq:0});assert.equal((await socket.status()).executionAcknowledgement,'UNKNOWN');socket.close();
});
test('split UTF8 output round trips and credit waits for consumer completion',async()=>{
  let release;const pending=new Promise(r=>release=r),out=[];const {ws,socket}=await clientOpen({onData:async s=>{out.push(s);await pending;}});
  const bytes=utf8('😀');ws.receive(dataFrame(2,1,bytes.subarray(0,2)).buffer);ws.receive(dataFrame(2,2,bytes.subarray(2)).buffer);await tick();assert.equal((await socket.status()).consumedSeq,1);assert.deepEqual(out,['😀']);release();await tick();assert.equal((await socket.status()).consumedSeq,2);socket.close();
});
test('output beyond byte credit fails closed; callback failure grants no credit',async()=>{
  let first=true;const {ws,socket}=await clientOpen({onData:()=>{if(first){first=false;throw new Error('consumer failed');}}});ws.receive(dataFrame(2,1,utf8('a')).buffer);await tick();assert.equal(ws.closes.at(-1).code,1002);assert.equal((await socket.status()).consumedSeq,0);
});
test('open timeout closes a peer that never sends hello',async()=>{
  const client=new RamWsClient({base:'http://127.0.0.1:8765',fetchImpl,WebSocketImpl:FakeSocket,timeoutMs:20});const p=client.open();await tick();const ws=FakeSocket.created.at(-1);await assert.rejects(p,/open timeout/);assert.equal(ws.readyState,3);
});
test('small input messages cannot evade metadata backpressure',async()=>{
  const {ws,socket}=await clientOpen();for(let i=0;i<LIMITS.inputPendingMessages;i++)socket.write('x');assert.throws(()=>socket.write('x'),/message backpressure/);assert.equal(ws.sent.filter(x=>typeof x!=='string').length,LIMITS.inputPendingMessages);socket.close();
});
test('cancelled ticket admission never opens a late WebSocket',async()=>{
  let release;const held=new Promise(r=>release=r),created=FakeSocket.created.length;const client=new RamWsClient({base:'http://127.0.0.1:8765',WebSocketImpl:FakeSocket,fetchImpl:async()=>{await held;return{ok:true,text:async()=>JSON.stringify({ticket:'T'.repeat(43)})};}});const pending=client.open(),check=assert.rejects(pending,/admission cancelled/);client.close();release();await check;assert.equal(FakeSocket.created.length,created);
});
async function ownerOpen(){
  const fakeSessions=[];
  const link={ready:Promise.resolve(),epoch:'worker_epoch',open:async opts=>{const s={opts,payloads:[],paused:false,closed:false,waits:[],writeBytesAccepted:bytes=>new Promise((resolve,reject)=>s.waits.push({bytes:bytes.slice(),resolve,reject})),pauseOutput(){s.paused=true;},resumeOutput(){s.paused=false;},resize(c,r){s.geometry=[c,r];},signal(){s.interrupted=true;},close(){s.closed=true;opts.onClose('closed');}};fakeSessions.push(s);return s;}};
  const owner=new RamWsOwner(link,{base:'http://127.0.0.1:8765',fetchImpl,WebSocketImpl:FakeSocket,timeoutMs:1000});const p=owner.connect();await tick();const ws=FakeSocket.created.at(-1);ws.onopen();ws.receive(JSON.stringify({v:1,type:'owner.ready',epoch}));await p;
  ws.receive(JSON.stringify({v:1,type:'owner.open',channel:1,sid,epoch,cols:100,rows:28}));await tick();return {owner,ws,fakeSessions,session:fakeSessions[0]};
}
test('owner reaches supplied XPU worker; ACK follows worker acceptance, not socket forwarding',async()=>{
  const {owner,ws,session}=await ownerOpen();const raw=Uint8Array.of(0xf0,0x9f);ws.receive(ownerFrame(1,1,1,raw).buffer);await tick();assert.deepEqual(session.waits[0].bytes,raw);assert.ok(!ws.sent.some(x=>typeof x==='string'&&JSON.parse(x).type==='owner.accepted'));session.waits[0].resolve({acceptedSeq:1});await tick();const ack=JSON.parse(ws.sent.find(x=>typeof x==='string'&&JSON.parse(x).type==='owner.accepted'));assert.equal(ack.upto,1);assert.ok(!ws.sent.some(x=>typeof x==='string'&&JSON.parse(x).type==='owner.executed'));owner.close();
});
test('owner pause/resume controls worker credits and bounded exact output queue',async()=>{
  const {owner,ws,session}=await ownerOpen();ws.receive(JSON.stringify({v:1,type:'owner.pause',channel:1,sid,epoch}));assert.equal(session.paused,true);session.opts.onData('😀 hello');assert.equal(ws.sent.filter(x=>typeof x!=='string').length,0);ws.receive(JSON.stringify({v:1,type:'owner.resume',channel:1,sid,epoch}));assert.equal(session.paused,false);const frame=ws.sent.find(x=>typeof x!=='string');assert.equal(new TextDecoder().decode(decodeOwnerFrame(frame,'server_to_client').payload),'😀 hello');owner.close();
});
test('owner output overflow closes session and clears owned queue',async()=>{
  const {owner,ws,session}=await ownerOpen();ws.receive(JSON.stringify({v:1,type:'owner.pause',channel:1,sid,epoch}));session.opts.onData('x'.repeat(LIMITS.queueBytes+1));assert.equal(session.closed,true);assert.equal(owner.sessions.size,0);owner.close();
});
test('small paused output messages cannot evade owner queue metadata cap',async()=>{
  const {owner,ws,session}=await ownerOpen();ws.receive(JSON.stringify({v:1,type:'owner.pause',channel:1,sid,epoch}));for(let i=0;i<LIMITS.outputQueueMessages+1;i++)session.opts.onData('a');assert.equal(session.closed,true);assert.equal(owner.sessions.size,0);owner.close();
});
test('owner close settles a pending connection immediately',async()=>{
  const link={ready:Promise.resolve(),epoch:'worker',open:()=>{throw new Error('unexpected');}},owner=new RamWsOwner(link,{base:'http://127.0.0.1:8765',fetchImpl,WebSocketImpl:FakeSocket,timeoutMs:1000});const pending=owner.start(),check=assert.rejects(pending,/owner cancelled/);await tick();owner.close('owner cancelled');await check;assert.equal(owner.active,false);
});
test('owner stale epoch fails closed and never replays input; channel reuse rejected',async()=>{
  const {owner,ws,session}=await ownerOpen();ws.receive(JSON.stringify({v:1,type:'owner.close',channel:1,sid,epoch}));assert.equal(session.closed,true);ws.receive(JSON.stringify({v:1,type:'owner.open',channel:1,sid,epoch,cols:100,rows:28}));await tick();assert.equal(owner.active,false);assert.equal(owner.sessions.size,0);
});
test('owner disconnect clears sessions and queued worker ACK cannot publish late',async()=>{
  const {owner,ws,session}=await ownerOpen();ws.receive(ownerFrame(1,1,1,utf8('x')).buffer);await tick();owner.close();session.waits[0].resolve({acceptedSeq:1});await tick();assert.equal(owner.sessions.size,0);assert.equal(session.closed,true);assert.ok(!ws.sent.some(x=>typeof x==='string'&&JSON.parse(x).type==='owner.accepted'));
});
