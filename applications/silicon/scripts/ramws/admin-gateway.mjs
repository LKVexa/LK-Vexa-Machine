// Optional Windows administrator terminal. The fixed native bridge owns UAC and ConPTY.
// The broker never elevates Node, evaluates command text, or launches a host shell itself.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {strictParse}=require('./protocol/codec.cjs');
export const ADMIN_PROTOCOL='ja21.admin.v1';
export const ADMIN_LIMITS=Object.freeze({envelopeBytes:65536,delegateEnvelopeBytes:524288,inputBytes:8192,outputChunkBytes:16384,delegateOutputBytes:65536,queueBytes:1048576,pendingRequests:64,pendingDelegates:2});
const idOk=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,64}$/.test(v);
const sidOk=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(v);
const objectKeys=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const bytes=v=>Buffer.byteLength(v,'utf8');
const int=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
export function createAdminGateway({packageRoot,platform=process.platform,spawnBridge=spawn,delegateTimeoutMs=40000}={}) {
  const root=path.resolve(packageRoot||'.'),executable=path.join(root,'tools','JA21-Admin-Terminal.exe');
  const enabled=platform==='win32';
  let active=null;
  // Check the runtime seal again for each admission; a previous status result is not authority.
  function plainFile(file){
    for(let p=file;;){const st=fs.lstatSync(p);if(st.isSymbolicLink())throw new Error('Reparse path rejected');const next=path.dirname(p);if(next===p)break;p=next;}
  }
  function readBounded(file,limit){
    plainFile(file);let fd;
    try{fd=fs.openSync(file,'r');const st=fs.fstatSync(fd);if(!st.isFile()||!Number.isSafeInteger(st.size)||st.size<1||st.size>limit)throw new Error('Integrity file limit');
      const out=Buffer.alloc(st.size+1);let off=0,n;while(off<out.length&&(n=fs.readSync(fd,out,off,out.length-off,null))>0)off+=n;
      if(off!==st.size)throw new Error('Integrity file changed size');plainFile(file);return out.subarray(0,off);
    }finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  function available(){try{
    const sealPath=path.join(root,'engine','ja21','runtime.integrity.json'),seal=strictParse(new TextDecoder('utf-8',{fatal:true}).decode(readBounded(sealPath,8*1024*1024)));
    if(!seal||seal.format!=='vb-ja21-runtime-seal/4'||seal.version!=='9.8.7'||!Array.isArray(seal.files)||seal.files.length<1||seal.files.length>8192)return false;
    let entry=null;const paths=new Set();
    for(const item of seal.files){if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.path!=='string'||paths.has(item.path))return false;paths.add(item.path);if(item.path==='tools/JA21-Admin-Terminal.exe'){if(entry||!objectKeys(item,['path','bytes','sha256'])||!int(item.bytes,1,4*1024*1024)||typeof item.sha256!=='string'||!/^[0-9a-f]{64}$/.test(item.sha256))return false;entry=item;}}
    if(!entry)return false;const binary=readBounded(executable,4*1024*1024);
    return binary.length===entry.bytes&&createHash('sha256').update(binary).digest('hex')===entry.sha256;
  }catch{return false;}}
  function status(){return{enabled,available:enabled&&available(),active:!!active,protocol:ADMIN_PROTOCOL,backend:'fixed-native-UAC-ConPTY-bridge',fixture:spawnBridge!==spawn,automaticElevation:false,limits:ADMIN_LIMITS};}
  function attach({ws,onClosed=()=>{}}={}) {
    if(!enabled)throw new Error('Administrator terminal is available on Windows only');
    if(active)throw new Error('One administrator terminal may be connected at a time');
    if(!available())throw new Error('The packaged administrator terminal helper is unavailable or failed its integrity seal');
    const child=spawnBridge(executable,['--bridge','--root',root],{cwd:root,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const s={child,closed:false,sid:null,openPending:false,ids:new Set(),seen:new Set(),seenOrder:[],pending:new Map(),delegates:new Map(),line:Buffer.alloc(0),stderrBytes:0};active=s;
    function emit(event){if(s.closed)return false;const text=JSON.stringify(event);if(bytes(text)>ADMIN_LIMITS.envelopeBytes||!ws.sendText(text,{control:true})){finish('administrator output queue exceeded');return false;}return true;}
    function fail(id,message){emit({v:1,type:'error',...(id?{id}:{}),...(s.sid?{sid:s.sid}:{}),payload:{message:String(message).slice(0,256)}});}
    function finish(reason='closed'){if(s.closed)return;s.closed=true;if(active===s)active=null;for(const d of s.delegates.values())clearTimeout(d.timer);s.delegates.clear();s.pending.clear();s.ids.clear();s.line=Buffer.alloc(0);try{child.stdin.end();}catch{}try{child.kill();}catch{}onClosed(reason);}
    s.finish=finish;
    function send(record){if(s.closed)return false;const text=JSON.stringify(record)+'\n',size=bytes(text);const limit=record.op==='delegate-result'?ADMIN_LIMITS.delegateEnvelopeBytes+1:ADMIN_LIMITS.envelopeBytes+1;if(size>limit||child.stdin.destroyed||child.stdin.writableLength+size>ADMIN_LIMITS.queueBytes){fail(record.id,'administrator input queue exceeded');finish('administrator input queue exceeded');return false;}try{if(!s.seen.has(record.id)){s.seen.add(record.id);s.seenOrder.push(record.id);if(s.seenOrder.length>512)s.seen.delete(s.seenOrder.shift());}child.stdin.write(text);return true;}catch{finish('administrator bridge unavailable');return false;}}
    function event(raw){
      const text=new TextDecoder('utf-8',{fatal:true}).decode(raw),m=strictParse(text);
      if(!objectKeys(m,['v','type','id','sid','payload'])||m.v!==1||!['ready','opened','output','closed','error','delegate','ack'].includes(m.type)||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload)||(m.id!==undefined&&!idOk(m.id))||(m.sid!==undefined&&!sidOk(m.sid)))throw new Error('invalid native event');
      if(raw.length>ADMIN_LIMITS.envelopeBytes)throw new Error('native event too large');
      if(m.type==='ready'){if(!objectKeys(m.payload,['available','message'])||typeof m.payload.available!=='boolean')throw new Error('invalid ready event');}
      else if(m.type==='opened'){if(!s.openPending||!sidOk(m.sid)||!objectKeys(m.payload,['cols','rows','elevated'])||!int(m.payload.cols,2,400)||!int(m.payload.rows,1,200)||m.payload.elevated!==true)throw new Error('invalid elevated session');s.sid=m.sid;s.openPending=false;}
      else if(m.type==='output'){if(m.sid!==s.sid||!objectKeys(m.payload,['text'])||typeof m.payload.text!=='string'||bytes(m.payload.text)>ADMIN_LIMITS.outputChunkBytes)throw new Error('invalid native output');}
      else if(m.type==='delegate'){
        if(m.sid!==s.sid||!objectKeys(m.payload,['requestId','terminal','command'])||!idOk(m.payload.requestId)||m.id!==m.payload.requestId||!int(m.payload.terminal,1,2)||typeof m.payload.command!=='string'||m.payload.command.length>4096||bytes(m.payload.command)>8192||!m.payload.command.trim())throw new Error('invalid delegation request');
        if(s.delegates.size>=2||s.delegates.has(m.payload.requestId)||[...s.delegates.values()].some(d=>d.terminal===m.payload.terminal)){send({v:1,id:'bridge-'+randomBytes(16).toString('hex'),op:'delegate-result',sid:s.sid,payload:{requestId:m.payload.requestId,error:'delegation already active',outcome:'UNKNOWN'}});return;}
        const d={terminal:m.payload.terminal};d.timer=setTimeout(()=>{if(s.closed||!s.delegates.delete(m.payload.requestId))return;send({v:1,id:'bridge-'+randomBytes(16).toString('hex'),op:'delegate-result',sid:s.sid,payload:{requestId:m.payload.requestId,error:'delegation completion deadline',outcome:'UNKNOWN'}});},delegateTimeoutMs);d.timer.unref();s.delegates.set(m.payload.requestId,d);
      }else if(m.type==='ack'){if(m.sid!==s.sid||!s.seen.has(m.id)||!objectKeys(m.payload,['operation'])||!['input','resize','interrupt','delegate-result'].includes(m.payload.operation))throw new Error('invalid native admission acknowledgment');}
      else if(m.type==='error'){if(!objectKeys(m.payload,['message','code'])||typeof m.payload.message!=='string'||m.payload.message.length>256)throw new Error('invalid native error');if(m.id&&s.pending.get(m.id)==='open')s.openPending=false;}
      else if(m.type==='closed'){if(m.sid!==undefined&&s.sid&&m.sid!==s.sid)throw new Error('foreign closed session');if(!objectKeys(m.payload,['reason','code','elevated'])||(m.payload.reason!==undefined&&(typeof m.payload.reason!=='string'||m.payload.reason.length>256)))throw new Error('invalid closed event');}
      if(m.id&&m.type!=='delegate'){s.pending.delete(m.id);s.ids.delete(m.id);}emit(m);if(m.type==='closed')finish('closed');
    }
    child.stdout.on('data',chunk=>{if(s.closed)return;try{let off=0;while(off<chunk.length){const at=chunk.indexOf(10,off),end=at<0?chunk.length:at;if(s.line.length+end-off>ADMIN_LIMITS.envelopeBytes)throw new Error('native line exceeded');s.line=Buffer.concat([s.line,chunk.subarray(off,end)]);off=end+(at<0?0:1);if(at<0)break;const line=s.line;s.line=Buffer.alloc(0);if(line.length)event(line.at(-1)===13?line.subarray(0,-1):line);}}catch{fail(null,'administrator bridge event rejected');finish('invalid native bridge event');}});
    child.stderr.on('data',chunk=>{s.stderrBytes=Math.min(4096,s.stderrBytes+chunk.length);});
    child.stdin.on('error',()=>finish('administrator bridge input lost'));
    child.on('error',()=>{fail(null,'administrator bridge could not start');finish('administrator bridge unavailable');});
    child.on('exit',()=>{if(!s.closed){emit({v:1,type:'closed',...(s.sid?{sid:s.sid}:{}),payload:{reason:'bridge ended'}});finish('administrator bridge ended');}});
    function onText(raw){
      if(s.closed)return;
      try{if(raw.length>ADMIN_LIMITS.delegateEnvelopeBytes)throw new Error('administrator envelope exceeded');const m=strictParse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
        if(!objectKeys(m,['v','id','op','sid','payload'])||m.v!==1||!idOk(m.id)||!['open','input','resize','interrupt','close','delegate-result'].includes(m.op)||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload))throw new Error('invalid administrator command');
        const op=m.op;
        if(raw.length>ADMIN_LIMITS.envelopeBytes&&op!=='delegate-result')throw new Error('administrator envelope exceeded');
        if(s.seen.has(m.id))throw new Error('duplicate administrator request');if(s.pending.size>=ADMIN_LIMITS.pendingRequests&&op!=='delegate-result')throw new Error('administrator request capacity');
        if(op==='open'){if(s.sid||s.openPending||m.sid!==undefined||!objectKeys(m.payload,['cols','rows'])||!int(m.payload.cols,2,400)||!int(m.payload.rows,1,200))throw new Error('invalid administrator open');s.openPending=true;}
        else {if(!s.sid||m.sid!==s.sid)throw new Error('administrator session mismatch');
          if(op==='input'){if(!objectKeys(m.payload,['text'])||typeof m.payload.text!=='string'||!m.payload.text||bytes(m.payload.text)>8192)throw new Error('administrator input exceeds bounds');}
          else if(op==='resize'){if(!objectKeys(m.payload,['cols','rows'])||!int(m.payload.cols,2,400)||!int(m.payload.rows,1,200))throw new Error('invalid administrator geometry');}
          else if(op==='interrupt'||op==='close'){if(!objectKeys(m.payload,[]))throw new Error('invalid administrator control');}
          else{
            const r=m.payload;if(!objectKeys(r,['requestId','code','output','truncated','completion','error','outcome'])||!idOk(r.requestId)||!s.delegates.has(r.requestId))throw new Error('delegation request not active');
            if(r.completion==='COMPLETED'){if(!int(r.code,0,255)||typeof r.output!=='string'||bytes(r.output)>65536||typeof r.truncated!=='boolean'||r.error!==undefined||r.outcome!==undefined)throw new Error('invalid delegated completion');}
            else if(r.outcome==='UNKNOWN'){if(typeof r.error!=='string'||!r.error||r.error.length>256||r.output!==undefined||r.code!==undefined||r.completion!==undefined)throw new Error('invalid unknown delegation outcome');}
            else throw new Error('delegation requires actual completion or unknown outcome');const d=s.delegates.get(r.requestId);clearTimeout(d.timer);s.delegates.delete(r.requestId);
          }
        }
        // Input/resize/interrupt/result commands do not create reply waiters; native bridge acknowledgments are optional.
        s.seen.add(m.id);s.seenOrder.push(m.id);if(s.seenOrder.length>512)s.seen.delete(s.seenOrder.shift());if(op==='open'||op==='close'){s.ids.add(m.id);s.pending.set(m.id,op);}send({...m,op});
      }catch(e){fail(null,e.message);finish('invalid administrator command');}
    }
    return{onText,close:finish,onBinary:()=>{fail(null,'administrator terminal accepts JSON controls only');finish('invalid administrator binary');}};
  }
  function close(){active?.finish('shutdown');}
  return{enabled,status,attach,close};
}
