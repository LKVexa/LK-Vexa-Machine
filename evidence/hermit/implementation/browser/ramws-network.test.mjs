import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import {createRamWsGateway} from '../server/ramws-gateway.mjs';
import {RamWsClient} from './ramws-client.js';
import {RamWsOwner} from './ramws-owner.js';

// Independent raw RFC6455 peer presents the browser API. This is real loopback network evidence,
// with a supplied fake RamLink; it is not browser/GPU execution or persistence evidence.
class NetworkSocket {
  constructor(url,protocols){
    const u=new URL(url);this.readyState=0;this.binaryType='arraybuffer';this.bufferedAmount=0;this.pending=Buffer.alloc(0);this.handshake=false;this.didClose=false;
    this.socket=net.createConnection({host:u.hostname,port:Number(u.port)});
    this.socket.on('connect',()=>{const request=`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Protocol: ${protocols.join(',')}\r\nOrigin: http://${u.host}\r\n\r\n`;this.socket.write(request);});
    this.socket.on('data',b=>this.parse(b));this.socket.on('error',e=>this.onerror?.(e));this.socket.on('close',()=>this.finish(1006));
  }
  frame(op,payload){payload=Buffer.from(payload);const n=payload.length,pos=n<126?2:4,h=Buffer.alloc(pos+4);h[0]=128|op;h[1]=128|(n<126?n:126);if(pos===4)h.writeUInt16BE(n,2);const mask=crypto.randomBytes(4);mask.copy(h,pos);for(let i=0;i<n;i++)payload[i]^=mask[i&3];return Buffer.concat([h,payload]);}
  send(value){if(this.readyState!==1)throw new Error('not open');const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(value instanceof ArrayBuffer?new Uint8Array(value):value);this.socket.write(this.frame(typeof value==='string'?1:2,bytes));this.bufferedAmount=this.socket.writableLength;}
  close(code=1000,reason=''){if(this.readyState>=2)return;const p=Buffer.alloc(2+Buffer.byteLength(reason));p.writeUInt16BE(code);p.write(reason,2);if(this.readyState===1)this.socket.write(this.frame(8,p));this.readyState=2;this.socket.end();}
  finish(code){if(this.didClose)return;this.didClose=true;this.readyState=3;this.onclose?.({code});}
  parse(chunk){
    this.pending=Buffer.concat([this.pending,chunk]);
    if(!this.handshake){const i=this.pending.indexOf('\r\n\r\n');if(i<0)return;const text=this.pending.subarray(0,i).toString();this.pending=this.pending.subarray(i+4);if(!/^HTTP\/1\.1 101 /.test(text)){this.onerror?.(new Error(text));this.socket.destroy();return;}this.handshake=true;this.readyState=1;this.onopen?.();}
    while(this.pending.length>=2){const b0=this.pending[0],b1=this.pending[1];assert.equal(b0&128,128);assert.equal(b1&128,0);let n=b1&127,pos=2;if(n===126){if(this.pending.length<4)return;n=this.pending.readUInt16BE(2);pos=4;}else if(n===127){if(this.pending.length<10)return;assert.equal(this.pending.readUInt32BE(2),0);n=this.pending.readUInt32BE(6);pos=10;}if(this.pending.length<pos+n)return;const bytes=Buffer.from(this.pending.subarray(pos,pos+n));this.pending=this.pending.subarray(pos+n);const op=b0&15;if(op===1)this.onmessage?.({data:bytes.toString()});else if(op===2){const ab=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);this.onmessage?.({data:ab});}else if(op===9)this.socket.write(this.frame(10,bytes));else if(op===8){const code=bytes.length>=2?bytes.readUInt16BE(0):1000;if(this.readyState===1)this.socket.write(this.frame(8,bytes));this.socket.end();this.finish(code);}}
  }
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,ms=3000){const end=Date.now()+ms;while(Date.now()<end){const x=f();if(x)return x;await delay(5);}throw new Error('condition timed out');}
async function start(){let gateway;const server=http.createServer((req,res)=>{if(!gateway.handleHttp(req,res)){res.writeHead(404);res.end();}});gateway=createRamWsGateway({server,origin:()=>`http://127.0.0.1:${server.address().port}`});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base=`http://127.0.0.1:${server.address().port}`,fetchImpl=(url,o={})=>fetch(url,{...o,headers:{...o.headers,Origin:base}});return{server,gateway,base,fetchImpl,stop:async()=>{gateway.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};}
function makeLink(){const sessions=[];return{ready:Promise.resolve(),epoch:'the_existing_worker_epoch',sessions,open:async opts=>{const s={opts,paused:false,input:[],pending:[],delayAck:false,writeBytesAccepted:async bytes=>{s.input.push(bytes.slice());if(s.delayAck)await new Promise(r=>s.pending.push(r));return{acceptedSeq:s.input.length};},pauseOutput(){s.paused=true;},resumeOutput(){s.paused=false;},resize(c,r){s.geometry=[c,r];},signal(){s.signalCount=(s.signalCount||0)+1;},close(reason){s.closed=true;opts.onClose(reason);}};sessions.push(s);return s;}};}

test('real loopback gateway and browser adapters use the supplied single worker, preserving input/output/ACK/resize/signal',async()=>{
  const h=await start(),link=makeLink(),owner=new RamWsOwner(link,{base:h.base,fetchImpl:h.fetchImpl,WebSocketImpl:NetworkSocket}),client=new RamWsClient({base:h.base,fetchImpl:h.fetchImpl,WebSocketImpl:NetworkSocket});
  try{
    await owner.start();const output=[];const socket=await client.open({onData:x=>output.push(x)});assert.equal(link.sessions.length,1);const session=link.sessions[0];
    const ack=await socket.writeAccepted('xpu info\r');assert.equal(ack.acceptedSeq,1);assert.equal(ack.executedSeq,0);assert.equal(new TextDecoder().decode(session.input[0]),'xpu info\r');
    session.opts.onData('existing XPU worker 😀\r\n');await until(()=>output.join('').includes('😀'));assert.equal(output.join(''),'existing XPU worker 😀\r\n');
    socket.resize(81,25);socket.signal();await until(()=>session.signalCount);assert.deepEqual(session.geometry,[81,25]);
    socket.close();await until(()=>h.gateway.status().activeSessions===0);assert.equal(session.closed,true);assert.equal(h.gateway.status().pendingInputBytes,0);
  }finally{client.close();owner.close();await h.stop();}
});
test('real gateway backpressure pauses the owner worker; owner loss reports unknown input with no replay',async()=>{
  const h=await start(),link=makeLink(),owner=new RamWsOwner(link,{base:h.base,fetchImpl:h.fetchImpl,WebSocketImpl:NetworkSocket}),client=new RamWsClient({base:h.base,fetchImpl:h.fetchImpl,WebSocketImpl:NetworkSocket});let release;const held=new Promise(r=>release=r);
  try{
    await owner.start();let outcome;const socket=await client.open({onData:async()=>await held,onClose:(r,d)=>outcome={r,d}}),session=link.sessions[0];
    for(let i=0;i<6;i++)session.opts.onData('A'.repeat(16384));await until(()=>session.paused);assert.ok(h.gateway.status().queuedOutputBytes>0);assert.ok(h.gateway.status().queuedOutputBytes<=524288);
    release();await until(()=>!session.paused);session.delayAck=true;socket.write('pending\r');await until(()=>session.input.length===1);owner.close('owner ended');await until(()=>outcome);assert.equal(outcome.d.unknownInputs,1);assert.equal(outcome.d.replayedInputs,0);assert.equal(link.sessions.length,1);assert.equal(h.gateway.status().activeSessions,0);for(const done of session.pending)done();await delay(10);assert.equal(h.gateway.status().pendingInputBytes,0);
  }finally{release();client.close();owner.close();await h.stop();}
});
