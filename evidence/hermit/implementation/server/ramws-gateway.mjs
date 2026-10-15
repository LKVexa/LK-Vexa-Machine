// HERMIT-derived RFC6455 framing and strict v2 codec; see HERMIT_LICENSE.txt.
// The broker only relays to the browser RAM worker. It has no compute kernel or host-command interface.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WsConnection, checkUpgrade, acceptUpgrade, rejectUpgrade } = require('./gateway/ws.cjs');
const { createCodec, strictParse } = require('./protocol/codec.cjs');
const schema = JSON.parse(fs.readFileSync(new URL('./protocol/envelope.schema.json', import.meta.url)));
const meta = JSON.parse(fs.readFileSync(new URL('./protocol/protocol-meta.json', import.meta.url)));
const codec = createCodec(schema, meta);
export const RAMWS_PROTOCOL = 'hermit.vws.v2';
export const RAMWS_LIMITS = Object.freeze({ maxSessions: 8, envelopeBytes: 65536, inputBytes: 8192, outputChunkBytes: 16384, maxCreditWindowBytes: 1048576, pendingOutputBytes: 524288, pendingInputBytes: 131072, sendQueueBytes: 524288, maxOutstandingMessages: 1024, tickets: 64, connections: 17 });
const loopback = (s) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(s).toLowerCase());
const ownKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const rid = () => crypto.randomBytes(12).toString('base64url');
const ticketHash = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function createRamWsGateway({ server, origin, host = '127.0.0.1', maxSessions = 8, ticketTtlMs = 15000, authTimeoutMs = 3000, openTimeoutMs = 10000, heartbeatMs = 20000, heartbeatWindowMs = 10000, idleMs = 1800000, pauseMs = 30000 } = {}) {
  if (!server || !['127.0.0.1', '::1'].includes(host) || !int(maxSessions, 1, 8)) throw new TypeError('RAMWS requires an HTTP server and literal loopback host, with 1..8 sessions');
  for (const [name,value] of Object.entries({ticketTtlMs,authTimeoutMs,openTimeoutMs,heartbeatMs,heartbeatWindowMs,idleMs,pauseMs})) if (!int(value,1,1800000)) throw new TypeError('invalid RAMWS timeout: '+name);
  if (heartbeatWindowMs > heartbeatMs) throw new TypeError('heartbeat window exceeds interval');
  const epoch = rid();
  const tickets = new Map(), peers = new Set(), sessions = new Map(), rate = new Map();
  let owner = null, channelNext = 1, closed = false, ticketRequests = 0, refused = 0, lostInputMessages = 0, unknownInputOutcomes = 0;
  function expectedOrigin() {
    const value = typeof origin === 'function' ? origin() : origin;
    const u = new URL(value);
    if (u.protocol !== 'http:' || !['127.0.0.1','[::1]'].includes(u.hostname) || u.origin !== value || !u.port || (host === '127.0.0.1' && u.hostname !== host) || (host === '::1' && u.hostname !== '[::1]')) throw new TypeError('RAMWS origin must be an exact loopback HTTP origin with port');
    return u;
  }
  if (typeof origin !== 'function') expectedOrigin();
  function admissible(req, needOrigin = false) {
    try { const u = expectedOrigin(); return !closed && loopback(req.socket.remoteAddress) && req.headers.host === u.host && (!needOrigin || req.headers.origin === u.origin); } catch { return false; }
  }
  function json(res, code, body) { const text=JSON.stringify(body);res.writeHead(code,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(text); }
  const sweepTickets=()=>{const now=Date.now();for(const [key,t]of tickets)if(t.exp<=now)tickets.delete(key);};
  function status() { return {protocol:RAMWS_PROTOCOL,backend:'browser-ram-worker-relay',epoch,ownerConnected:!!owner,activeSessions:sessions.size,connections:peers.size,tickets:tickets.size,queuedOutputBytes:[...sessions.values()].reduce((n,s)=>n+s.pendingBytes,0),pendingInputBytes:[...sessions.values()].reduce((n,s)=>n+s.inputPendingBytes,0),socketQueuedBytes:[...peers].reduce((n,p)=>n+p.ws.queuedBytes,0),lostInputMessages,unknownInputOutcomes,refused,limits:{...RAMWS_LIMITS,maxSessions},gpuExecution:'browser owner only',persistence:'browser IndexedDB; transport queues volatile',resume:false}; }
  function handleHttp(req,res) {
    const route=String(req.url||'').split('?')[0];
    if(!['/ramws-info','/ramws-ticket'].includes(route))return false;
    if(req.url!==route)return json(res,400,{error:'query not accepted'}),true;
    if(!admissible(req))return json(res,421,{error:'loopback host required'}),true;
    if(route==='/ramws-info') { if(req.method!=='GET')json(res,405,{error:'method'});else json(res,200,{...status(),ticketPath:'/ramws-ticket',ownerPath:'/ws/xpu-owner',terminalPath:'/ws/terminal'});return true; }
    if(req.method!=='POST')return json(res,405,{error:'method'}),true;
    if(!admissible(req,true)||req.headers['x-ja21-ramws']!=='1')return json(res,403,{error:'origin or request header'}),true;
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(req.headers['content-type']||'')))return json(res,415,{error:'json required'}),true;
    const now=Date.now();const key=req.socket.remoteAddress;let r=rate.get(key);if(!r||now-r.at>=60000){r={at:now,n:0};rate.set(key,r);}if(++r.n>60)return json(res,429,{error:'rate'}),true;
    ticketRequests++;let size=0,parts=[],done=false;
    const timer=setTimeout(()=>{if(!done){done=true;parts=[];json(res,408,{error:'ticket request timeout'});req.resume();}},authTimeoutMs);timer.unref();
    req.on('data',b=>{if(done)return;size+=b.length;if(size>256){done=true;clearTimeout(timer);parts=[];json(res,413,{error:'ticket request too large'});req.resume();}else parts.push(b);});
    req.on('error',()=>{done=true;clearTimeout(timer);parts=[];});
    req.on('end',()=>{if(done)return;done=true;clearTimeout(timer);if(closed){parts=[];return json(res,503,{error:'broker closed'});}try{const body=strictParse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));parts=[];if(!ownKeys(body,['role'])||!['owner','terminal'].includes(body.role))return json(res,400,{error:'invalid ticket role'});sweepTickets();if(tickets.size>=RAMWS_LIMITS.tickets)return json(res,503,{error:'ticket capacity'});const ticket=crypto.randomBytes(32).toString('base64url');tickets.set(ticketHash(ticket),{role:body.role,origin:req.headers.origin,exp:Date.now()+ticketTtlMs});json(res,200,{ticket,epoch,wsPath:body.role==='owner'?'/ws/xpu-owner':'/ws/terminal',protocol:RAMWS_PROTOCOL,expiresInMs:ticketTtlMs});}catch{json(res,400,{error:'invalid json'});}});
    return true;
  }
  function sendJson(p,obj,v2=false) { if(p.dead)return false;let text;try{text=v2?codec.encode(obj,'server_to_client'):JSON.stringify(obj);}catch{dropPeer(p,1011,'invalid relay output');return false;}if(!p.ws.sendText(text,{control:true})){dropPeer(p,1008,'send queue capacity');return false;}return true; }
  function v2Error(p,code,message,retryable=false) { return sendJson(p,{v:2,type:'error',payload:{code,message,retryable}},true); }
  function ownerMessage(type,s,extra={}) { return owner && sendJson(owner,{v:1,type,channel:s.channel,sid:s.sid,epoch,...extra}); }
  function clearSession(s,reason='closed',code=1000,notifyOwner=true,notifyClient=true,exitCode=code===1000?0:70) {
    if(s.dead)return;s.dead=true;sessions.delete(s.channel);clearTimeout(s.openTimer);lostInputMessages+=s.inputSizes.size;unknownInputOutcomes+=Math.max(0,s.inSeq-s.executed);s.inputSizes.clear();s.inputPendingBytes=0;s.pending.length=0;s.pendingBytes=0;s.outstanding.length=0;
    if(notifyOwner)ownerMessage('owner.close',s,{reason});
    if(notifyClient&&!s.peer.dead&&s.opened)sendJson(s.peer,{v:2,type:'session.exit',sid:s.sid,epoch,payload:{code:exitCode,reason:['closed','logout','shutdown','expired','quota','worker_failure'].includes(reason)?reason:'closed'}},true);
    s.peer.session=null;
    if(!s.peer.dead)dropPeer(s.peer,code,reason,true);
  }
  function dropPeer(p,code=1000,reason='closed',closeSocket=true) {
    if(p.dead)return;p.dead=true;clearTimeout(p.authTimer);clearTimeout(p.openTimer);if(p.session)clearSession(p.session,reason,code,true,false);
    if(owner===p){owner=null;for(const s of [...sessions.values()]){v2Error(s.peer,'NOT_READY','browser XPU owner disconnected; pending input outcome is unknown');clearSession(s,'worker_failure',1011,false,true);}}
    if(closeSocket){if(code===1006)p.ws.terminate(code,reason);else p.ws.close(code,reason);}
  }
  function flow(s) { const paused=s.pending.length>0;if(paused&&!s.paused){s.paused=true;s.pausedAt=Date.now();ownerMessage('owner.pause',s);}else if(!paused&&s.paused){s.paused=false;s.pausedAt=0;ownerMessage('owner.resume',s);} }
  function flush(s) {
    if(s.dead||!s.opened)return;
    while(s.pending.length){const item=s.pending[0];if(s.sentBytes+item.payloadBytes>s.creditBytes||s.outstanding.length>=RAMWS_LIMITS.maxOutstandingMessages)break;if(!s.peer.ws.sendBinary([item.bytes]))break;s.pending.shift();s.pendingBytes-=item.bytes.length;s.sentBytes+=item.payloadBytes;s.outSeq=item.seq;s.outstanding.push({seq:item.seq,cum:s.sentBytes});}
    flow(s);
  }
  function sessionPeerMessage(p,msg) {
    if(msg.type==='heartbeat.ping')return sendJson(p,{v:2,type:'heartbeat.pong',rid:msg.rid,payload:{nonce:msg.payload.nonce}},true);
    if(msg.type==='heartbeat.pong')return;
    if(msg.rid!==undefined){if(p.rids.has(msg.rid))return v2Error(p,'BAD_MESSAGE','duplicate rid');p.rids.add(msg.rid);p.ridList.push(msg.rid);if(p.ridList.length>512)p.rids.delete(p.ridList.shift());}
    if(msg.type==='session.open'){
      if(p.session)return v2Error(p,'BAD_MESSAGE','session already open');if(!owner)return v2Error(p,'NOT_READY','connect the browser XPU owner first',true);if(sessions.size>=maxSessions||channelNext>0xffffffff){v2Error(p,'LIMIT_EXCEEDED','session capacity');return dropPeer(p,1013,'capacity');}if(msg.payload.creditBytes>RAMWS_LIMITS.maxCreditWindowBytes){v2Error(p,'CREDIT_VIOLATION','initial credit exceeds window');return dropPeer(p,1008,'credit violation');}
      const previous=msg.payload.previous;if(previous)sendJson(p,{v:2,type:'session.reset',rid:msg.rid,payload:{reason:previous.epoch!==epoch?'process_restart':'session_not_found',outcome:previous.pendingInputs?'OUTCOME_UNKNOWN':'NO_PENDING_INPUT',previousEpoch:previous.epoch,pendingInputs:previous.pendingInputs}},true);
      clearTimeout(p.openTimer);const s={peer:p,channel:channelNext++,sid:crypto.randomBytes(18).toString('base64url'),rid:msg.rid,opened:false,dead:false,inSeq:0,accepted:0,executed:0,inputSizes:new Map(),inputPendingBytes:0,receivedOutSeq:0,outSeq:0,consumedSeq:0,consumedBytes:0,sentBytes:0,creditBytes:msg.payload.creditBytes,pending:[],pendingBytes:0,outstanding:[],paused:false,pausedAt:0,cols:msg.payload.cols,rows:msg.payload.rows};p.session=s;sessions.set(s.channel,s);s.openTimer=setTimeout(()=>{if(!s.opened){v2Error(p,'NOT_READY','browser terminal open timed out');clearSession(s,'worker_failure',1011);}},openTimeoutMs);s.openTimer.unref();ownerMessage('owner.open',s,{cols:s.cols,rows:s.rows});return;
    }
    const s=p.session;if(!s||!s.opened)return v2Error(p,'NOT_READY','session is not ready',true);
    if(msg.sid!==s.sid)return v2Error(p,'FORBIDDEN','session not available');if(msg.epoch!==epoch)return v2Error(p,'STALE_EPOCH','stale session epoch');
    if(msg.type==='session.close')return clearSession(s,msg.payload.reason==='logout'?'logout':'closed');
    if(msg.type==='terminal.resize'||msg.type==='terminal.signal'){ownerMessage(msg.type==='terminal.resize'?'owner.resize':'owner.signal',s,msg.type==='terminal.resize'?{cols:msg.payload.cols,rows:msg.payload.rows}:{signal:msg.payload.signal});return sendJson(p,{v:2,type:'request.ack',rid:msg.rid,sid:s.sid,epoch,payload:{operation:msg.type,stage:'accepted'}},true);}
    if(msg.type==='flow.credit'){
      const {consumedSeq,creditBytes}=msg.payload;if(consumedSeq<s.consumedSeq||consumedSeq>s.outSeq||creditBytes<s.creditBytes){v2Error(p,'CREDIT_VIOLATION','nonmonotonic or unsent credit acknowledgment');return clearSession(s,'quota',1008);}
      let consumed=s.consumedBytes;for(const o of s.outstanding)if(o.seq<=consumedSeq)consumed=o.cum;if(creditBytes-consumed>RAMWS_LIMITS.maxCreditWindowBytes){v2Error(p,'CREDIT_VIOLATION','credit exceeds window');return clearSession(s,'quota',1008);}while(s.outstanding.length&&s.outstanding[0].seq<=consumedSeq)s.outstanding.shift();s.consumedSeq=consumedSeq;s.consumedBytes=consumed;s.creditBytes=creditBytes;flush(s);return;
    }
    v2Error(p,'UNSUPPORTED','unsupported message');
  }
  function terminalInput(p,bytes) {
    const s=p.session;if(!s||!s.opened)return v2Error(p,'NOT_READY','session is not ready',true);const d=codec.decodeData(bytes,'client_to_server');if(d.seq!==s.inSeq+1)return v2Error(p,'BAD_MESSAGE','input sequence must be next');if(d.seq>=codec.U48_MAX||s.inputSizes.size>=RAMWS_LIMITS.maxOutstandingMessages||s.inputPendingBytes+d.payload.length>RAMWS_LIMITS.pendingInputBytes){v2Error(p,'LIMIT_EXCEEDED','input backlog capacity');return clearSession(s,'quota',1008);}
    const h=Buffer.alloc(4);h.writeUInt32BE(s.channel);const own=Buffer.from(bytes);if(!owner||!owner.ws.sendBinary([h,own])){v2Error(p,'NOT_READY','browser input queue unavailable');return clearSession(s,'worker_failure',1011);}s.inSeq=d.seq;s.inputPendingBytes+=d.payload.length;s.inputSizes.set(d.seq,d.payload.length);
  }
  function ownerText(p,msg) {
    if(!ownKeys(msg,['v','type','channel','sid','epoch','cols','rows','upto','code','reason','message','detail','executedSeq'])||msg.v!==1||!['owner.opened','owner.accepted','owner.executed','owner.exit','owner.error'].includes(msg.type)||!int(msg.channel,1,0xffffffff)||msg.epoch!==epoch||typeof msg.sid!=='string')throw new Error('invalid owner control');
    const s=sessions.get(msg.channel);if(!s)return;if(msg.sid!==s.sid)throw new Error('foreign owner session');
    const allowed={ 'owner.opened':['v','type','channel','sid','epoch','cols','rows'], 'owner.accepted':['v','type','channel','sid','epoch','upto'], 'owner.executed':['v','type','channel','sid','epoch','upto','code'], 'owner.exit':['v','type','channel','sid','epoch','code','reason','detail','executedSeq'], 'owner.error':['v','type','channel','sid','epoch','message'] };if(!ownKeys(msg,allowed[msg.type]))throw new Error('unknown owner field');
    if(msg.type==='owner.opened'){if(s.opened||!int(msg.cols,2,400)||!int(msg.rows,1,200))throw new Error('invalid owner open');s.opened=true;clearTimeout(s.openTimer);return sendJson(s.peer,{v:2,type:'session.opened',rid:s.rid,sid:s.sid,epoch,payload:{cols:msg.cols,rows:msg.rows}},true);}
    if(msg.type==='owner.error'){if(typeof msg.message!=='string'||msg.message.length>256)throw new Error('invalid owner error');v2Error(s.peer,'BAD_MESSAGE',msg.message);return clearSession(s,'worker_failure',1011,false,true);}
    if(msg.type==='owner.exit'){if(!int(msg.code,0,255)||!['closed','logout','shutdown','expired','quota','worker_failure'].includes(msg.reason)||(msg.executedSeq!==undefined&&msg.executedSeq!==0)||(msg.detail!==undefined&&(typeof msg.detail!=='string'||msg.detail.length>256)))throw new Error('invalid owner exit');return clearSession(s,msg.reason,msg.code===0?1000:1011,false,true,msg.code);}
    if(!s.opened||!int(msg.upto,0,s.inSeq))throw new Error('invalid owner acknowledgment');
    if(msg.type==='owner.accepted'){if(msg.upto<s.accepted)throw new Error('regressed owner acceptance');for(const [seq,n]of s.inputSizes)if(seq<=msg.upto){s.inputSizes.delete(seq);s.inputPendingBytes-=n;}s.accepted=msg.upto;}
    else{if(msg.upto<s.executed||msg.upto>s.accepted||!int(msg.code,0,255))throw new Error('invalid owner execution');s.executed=msg.upto;}
    sendJson(s.peer,{v:2,type:'input.ack',sid:s.sid,epoch,payload:{acceptedSeq:s.accepted,executedSeq:s.executed}},true);
  }
  function ownerOutput(p,bytes) {if(bytes.length<12)throw new Error('short owner binary');const ch=bytes.readUInt32BE(0);const s=sessions.get(ch);if(!s)return;const d=codec.decodeData(bytes.subarray(4),'server_to_client');if(!s.opened||d.seq!==s.receivedOutSeq+1||d.seq>=codec.U48_MAX)throw new Error('invalid owner output sequence');if(s.pending.length>=RAMWS_LIMITS.maxOutstandingMessages||s.pendingBytes+bytes.length-4>RAMWS_LIMITS.pendingOutputBytes){v2Error(s.peer,'LIMIT_EXCEEDED','output queue capacity');return clearSession(s,'quota',1008);}s.receivedOutSeq=d.seq;const own=Buffer.from(bytes.subarray(4));s.pending.push({bytes:own,seq:d.seq,payloadBytes:d.payload.length});s.pendingBytes+=own.length;flush(s);}
  function onText(p,bytes) {
    if(p.dead)return;p.lastActivity=Date.now();if(!consumeRate(p))return dropPeer(p,1008,'message rate');
    try{
      if(!p.authenticated){const m=strictParse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!ownKeys(m,['type','ticket'])||m.type!=='auth'||typeof m.ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(m.ticket))throw new Error('invalid authentication');const key=ticketHash(m.ticket),t=tickets.get(key);tickets.delete(key);if(!t||t.role!==p.role||t.origin!==p.origin||t.exp<=Date.now())throw new Error('invalid ticket');if(p.role==='owner'&&owner)throw new Error('owner already connected');p.authenticated=true;clearTimeout(p.authTimer);if(p.role==='owner'){owner=p;sendJson(p,{v:1,type:'owner.ready',epoch,limits:{...RAMWS_LIMITS,maxSessions}});}else{sendJson(p,{v:2,type:'hello',payload:{protocol:RAMWS_PROTOCOL,serverEpoch:epoch,profile:'LOCAL_VOLATILE',limits:{envelopeBytes:RAMWS_LIMITS.envelopeBytes,inputBytes:RAMWS_LIMITS.inputBytes,outputChunkBytes:RAMWS_LIMITS.outputChunkBytes,maxCreditWindowBytes:RAMWS_LIMITS.maxCreditWindowBytes,maxSessions},capabilities:{resume:false,browserPane:false,virtualCommands:true,fabric:false}}},true);p.openTimer=setTimeout(()=>dropPeer(p,1008,'session open timeout'),openTimeoutMs);p.openTimer.unref();}return;}
      if(p.role==='owner')ownerText(p,strictParse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));else sessionPeerMessage(p,codec.decode(bytes,'client_to_server').msg);
    }catch{if(!p.authenticated||p.role==='owner')dropPeer(p,1008,'invalid relay message');else{v2Error(p,'BAD_MESSAGE','message rejected');if(++p.strikes>20)dropPeer(p,1008,'rejected message limit');}}
  }
  function consumeRate(p){const now=Date.now();p.tokens=Math.min(600,p.tokens+(now-p.tokenAt)*.3);p.tokenAt=now;if(p.tokens<1)return false;p.tokens--;return true;}
  function onBinary(p,bytes){if(p.dead)return;p.lastActivity=Date.now();if(!p.authenticated)return dropPeer(p,1008,'authentication required');if(!consumeRate(p))return dropPeer(p,1008,'message rate');try{if(p.role==='owner')ownerOutput(p,bytes);else terminalInput(p,bytes);}catch{if(p.role==='owner')dropPeer(p,1008,'invalid owner binary');else{v2Error(p,'BAD_MESSAGE','input rejected');if(++p.strikes>20)dropPeer(p,1008,'rejected message limit');}}}
  function upgrade(req,socket,head) {
    const route=String(req.url||'');if(!route.startsWith('/ws/'))return;
    socket.on('error',()=>{});
    const reject=(status,reason)=>{refused++;rejectUpgrade(socket,status,reason);};
    if(!['/ws/xpu-owner','/ws/terminal'].includes(route))return reject(404,'websocket path');if(!admissible(req,true))return reject(403,'loopback origin');if(peers.size>=RAMWS_LIMITS.connections)return reject(503,'connection capacity');const up=checkUpgrade(req,RAMWS_PROTOCOL);if(!up.ok)return reject(up.status,up.reason);if(head?.length)return reject(400,'unexpected upgrade bytes');
    acceptUpgrade(socket,up.key,RAMWS_PROTOCOL);const ws=new WsConnection(socket,{maxMessageBytes:RAMWS_LIMITS.envelopeBytes,sendQueueBytes:RAMWS_LIMITS.sendQueueBytes,controlReserve:16384,assemblyMs:5000,closeWaitMs:1000});const p={ws,role:route==='/ws/xpu-owner'?'owner':'terminal',origin:req.headers.origin,authenticated:false,dead:false,session:null,rids:new Set(),ridList:[],tokens:600,tokenAt:Date.now(),strikes:0,lastActivity:Date.now(),ping:null};peers.add(p);p.authTimer=setTimeout(()=>dropPeer(p,1008,'authentication timeout'),authTimeoutMs);p.authTimer.unref();ws.on('text',b=>onText(p,b));ws.on('binary',b=>onBinary(p,b));ws.on('drain',()=>{if(p.session)flush(p.session);});ws.on('close',()=>{dropPeer(p,1006,'transport closed',false);peers.delete(p);});ws.on('pong',b=>{if(p.ping&&b.equals(p.ping.bytes))p.ping=null;});ws.on('transport-error',()=>{});
  }
  const timer=setInterval(()=>{sweepTickets();const now=Date.now();for(const p of [...peers]){if(now-p.lastActivity>idleMs){dropPeer(p,1000,'expired');continue;}if(p.ping&&now-p.ping.at>heartbeatWindowMs){dropPeer(p,1008,'heartbeat timeout');continue;}if(!p.ping&&(!p.lastPing||now-p.lastPing>=heartbeatMs)){const bytes=crypto.randomBytes(8);p.ping={bytes,at:now};p.lastPing=now;p.ws.ping(bytes);}}for(const s of [...sessions.values()])if(s.paused&&now-s.pausedAt>pauseMs){v2Error(s.peer,'LIMIT_EXCEEDED','output consumer timeout');clearSession(s,'quota',1008);}},Math.min(heartbeatMs,1000));timer.unref();
  server.on('upgrade',upgrade);
  function close(){if(closed)return;closed=true;clearInterval(timer);server.off('upgrade',upgrade);tickets.clear();rate.clear();for(const p of [...peers])dropPeer(p,1001,'shutdown');}
  return {handleHttp,status,close,epoch,limits:RAMWS_LIMITS};
}
