import { createHermitCodec, strictParse, utf8, writeDataHeaderRaw } from './hermit-codec.js';

export const OWNER_PROTOCOL='hermit.vws.v2';
export const LIMITS=Object.freeze({inputBytes:8192,outputBytes:16384,inputPendingBytes:16384,inputPendingMessages:256,outputQueueMessages:1024,queueBytes:524288,socketBytes:1048576,creditWindowBytes:65536,maxSessions:8,controlBytes:65536,openTimeoutMs:7000});
export const codec=createHermitCodec();
export function loopbackBase(base=globalThis.location?.origin){
  const u=new URL(base);
  if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('RAMWS requires an exact localhost origin');
  return u.origin;
}
export function wsUrl(base,path){if(!/^\/ws\/(terminal|xpu-owner)$/.test(path))throw new Error('invalid RAMWS endpoint');return base.replace(/^http/,'ws')+path;}
export function dataFrame(kind,seq,payload){
  if(!(payload instanceof Uint8Array)||payload.length<1||payload.length>(kind===1?LIMITS.inputBytes:LIMITS.outputBytes)||![1,2].includes(kind))throw new Error('invalid RAMWS data payload');
  const out=new Uint8Array(7+payload.length);writeDataHeaderRaw(out,kind,seq);out.set(payload,7);return out;
}
export function ownerFrame(channel,kind,seq,payload){
  checkChannel(channel);const data=dataFrame(kind,seq,payload),out=new Uint8Array(4+data.length);new DataView(out.buffer).setUint32(0,channel,false);out.set(data,4);return out;
}
export function checkChannel(channel){if(!Number.isInteger(channel)||channel<1||channel>0xffffffff)throw new Error('invalid owner channel');return channel;}
export function decodeOwnerFrame(value,direction){
  const bytes=value instanceof ArrayBuffer?new Uint8Array(value):value;
  if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>4+7+(direction==='client_to_server'?LIMITS.inputBytes:LIMITS.outputBytes))throw new Error('invalid owner data frame');
  const channel=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0,false);checkChannel(channel);
  return {channel,...codec.decodeData(bytes.subarray(4),direction)};
}
export function ownerControl(value){
  if(typeof value!=='string'||utf8(value).length>LIMITS.controlBytes)throw new Error('invalid owner control');
  const m=strictParse(value);
  if(!m||m.v!==1||typeof m.type!=='string'||!/^owner\.[a-z]+$/.test(m.type))throw new Error('invalid owner control envelope');
  const keys={
    'owner.ready':['v','type','epoch','limits'],
    'owner.open':['v','type','channel','sid','epoch','cols','rows'],
    'owner.resize':['v','type','channel','sid','epoch','cols','rows'],
    'owner.signal':['v','type','channel','sid','epoch','signal'],
    'owner.close':['v','type','channel','sid','epoch','reason'],
    'owner.pause':['v','type','channel','sid','epoch'],
    'owner.resume':['v','type','channel','sid','epoch']
  }[m.type];
  if(!keys||Object.keys(m).some(k=>!keys.includes(k)))throw new Error('unknown owner control field or type');
  const optional=m.type==='owner.ready'?['limits']:m.type==='owner.close'?['reason']:[];
  if(keys.some(k=>!optional.includes(k)&&!Object.hasOwn(m,k)))throw new Error('missing owner control field');
  if(m.type==='owner.close'&&m.reason!==undefined&&!['closed','quota','worker_failure','shutdown','expired'].includes(m.reason))throw new Error('invalid owner close reason');
  return m;
}
export function sendControl(ws,msg){
  const text=JSON.stringify(msg);if(utf8(text).length>LIMITS.controlBytes||ws.readyState!==1||ws.bufferedAmount+utf8(text).length>LIMITS.socketBytes)throw new Error('RAMWS socket backpressure');ws.send(text);
}
export function boundedReason(reason){let out='',n=0;for(const c of String(reason)){const size=utf8(c).length;if(n+size>123)break;out+=c;n+=size;}return out;}
export async function getTicket(base,role,{fetchImpl=globalThis.fetch,timeoutMs=LIMITS.openTimeoutMs}={}){
  if(!['owner','terminal'].includes(role))throw new Error('invalid RAMWS role');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetchImpl(base+'/ramws-ticket',{method:'POST',headers:{'Content-Type':'application/json','X-JA21-RAMWS':'1'},body:JSON.stringify({role}),credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(!r.ok)throw new Error(`RAMWS admission refused (HTTP ${r.status})`);
    const text=await r.text();if(utf8(text).length>4096)throw new Error('RAMWS ticket response too large');const m=strictParse(text);
    if(!m||typeof m.ticket!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(m.ticket))throw new Error('invalid RAMWS admission ticket');
    return m;
  }finally{clearTimeout(timer);}
}
export function splitInputText(text){
  if(typeof text!=='string'||!text||text.length>LIMITS.inputBytes||text.includes('\0'))throw new Error('input length or type limit');
  const parts=[];let current='',size=0;
  for(const c of text){const n=utf8(c).length;if(current.length+c.length>4098||size+n>LIMITS.inputBytes){parts.push(current);current='';size=0;}current+=c;size+=n;}
  if(current)parts.push(current);return parts;
}
