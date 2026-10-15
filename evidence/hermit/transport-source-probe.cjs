'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const root = path.join(__dirname, 'source', 'hermit-ramws');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname,'transport-probe-fixtures.json')));
const moduleContext = {module:{exports:{}},TextEncoder,TextDecoder,Uint8Array,ArrayBuffer};vm.createContext(moduleContext);vm.runInContext(fixtures['protocol/codec.js'],moduleContext);
const codec = moduleContext.module.exports;
const schema = JSON.parse(fixtures['protocol/envelope.schema.json']);
const meta = JSON.parse(fixtures['protocol/protocol-meta.json']);
const epoch = 'Epoch_AAAAAAAAAAAAAA', sid = 'Session_AAAAAAAAAAAAAAAA';
async function make() {
  const sockets = [];
  class FakeSocket {
    constructor() { this.readyState = 1; this.bufferedAmount = 0; this.sent = []; this.closes = []; sockets.push(this); }
    send(value) { this.sent.push(value); if (typeof value !== 'string') this.bufferedAmount += value.byteLength; }
    close(code, reason) { this.closes.push({code,reason}); }
  }
  const ctx = { crypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, console, setTimeout, clearTimeout, location: {origin:'http://127.0.0.1:9220'}, HermitVWS:{codec} };
  ctx.self = ctx; vm.createContext(ctx);
  for (const n of ['client/transport.js','client/ws-adapter.js']) vm.runInContext(fixtures[n],ctx,{filename:n});
  const fetchImpl = async u => ({ok:true,json: async () => u.endsWith('envelope.schema.json') ? schema : u.endsWith('protocol-meta.json') ? meta : {protocol:'hermit.vws.v2',auth:'none',ticketPath:'/ticket',wsPath:'/ws/terminal',capabilities:{fabric:false}}});
  const transport = ctx.HermitVWS.WsTransport({WebSocketImpl:FakeSocket,fetchImpl,autoReconnect:false});
  const pending = transport.open({cols:80,rows:24});
  while (!sockets.length) await new Promise(resolve=>setImmediate(resolve));
  const ws = sockets[0];
  ws.onmessage({data:JSON.stringify({v:2,type:'hello',payload:{protocol:'hermit.vws.v2',serverEpoch:epoch,profile:'LOCAL_VOLATILE',limits:{envelopeBytes:65536,inputBytes:8192,outputChunkBytes:16384,maxCreditWindowBytes:1048576,maxSessions:4},capabilities:{resume:false,browserPane:false,virtualCommands:true,fabric:false}}})});
  const open = JSON.parse(ws.sent.find(x=>typeof x==='string' && JSON.parse(x).type==='session.open'));
  ws.onmessage({data:JSON.stringify({v:2,type:'session.opened',rid:open.rid,sid,epoch,payload:{cols:80,rows:24}})});
  const {sessionId} = await pending; transport.start(sessionId);
  return {transport,ws,sessionId};
}
async function main() {
  const findings = {};
  {
    const {ws} = await make(); let error = null;
    try { ws.onmessage({data:Uint8Array.of(2).buffer}); } catch (e) { error = {name:e.name,message:e.message}; }
    findings.malformedBinary = {error,closes:ws.closes};
  }
  {
    const {ws,transport} = await make(); const output=[]; transport.onData(x=>output.push(x.chunk));
    const packet = new Uint8Array(8); codec.writeDataHeaderRaw(packet,2,2); packet[7]=65;
    ws.onmessage({data:packet.buffer});
    findings.noncontiguousOutput = {output,closes:ws.closes};
  }
  {
    const {ws,transport,sessionId} = await make(); transport.write(sessionId,'a');
    ws.onmessage({data:JSON.stringify({v:2,type:'input.ack',sid,epoch:'Stale_AAAAAAAAAAAAAAAA',payload:{acceptedSeq:1,executedSeq:1}})});
    findings.staleEpochAck = {status:await transport.status(sessionId),closes:ws.closes};
  }
  {
    const {ws,transport,sessionId} = await make(); transport.write(sessionId,'x'.repeat(2*1024*1024));
    findings.inputBackpressure = {queuedBinaryMessages:ws.sent.filter(x=>typeof x!=='string').length,bufferedAmount:ws.bufferedAmount,closes:ws.closes};
  }
  console.log(JSON.stringify({kind:'source_behavior_probe_with_fake_peer',hardwareOrNetworkEvidence:false,sourceVersion:'2.0.0-ramws.1',findings},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
