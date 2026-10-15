import { strictParse, utf8 } from './ramws/hermit-codec.js';
import { boundedReason } from './ramws/ramws-wire.js';
const ID=/^[A-Za-z0-9_-]{1,64}$/;
function canonicalBase(base){const u=new URL(base);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.origin!==base)throw new Error('Administrator terminal requires the native console or its exact local WebSocket origin');return base;}
/** Explicit administrator capability, separate from the numerical worker and its network relay. */
export class AdminLink {
  constructor({nativeBridge=globalThis.chrome?.webview,base=globalThis.location?.origin,fetchImpl=globalThis.fetch,WebSocketImpl=globalThis.WebSocket,onDelegate=async()=>{throw new Error('XPU delegation unavailable');},openTimeoutMs=120000}={}){
    this.native=nativeBridge;this.base=base;this.fetch=fetchImpl;this.WS=WebSocketImpl;this.onDelegate=onDelegate;this.openTimeoutMs=openTimeoutMs;this.connection=null;this.active=null;this.serial=0;this.generation=0;
  }
  async open({cols=100,rows=28,onData=()=>{},onClose=()=>{}}={}){
    if(this.connection||this.active)throw new Error('one Administrator PowerShell terminal is allowed');
    if(!Number.isInteger(cols)||cols<2||cols>400||!Number.isInteger(rows)||rows<1||rows>200)throw new Error('invalid terminal geometry');
    const generation=++this.generation;
    let transport;
    if(this.native?.postMessage&&this.native?.addEventListener){
      transport={send:m=>this.native.postMessage(m),listen:fn=>{this.native.addEventListener('message',fn);return ()=>this.native.removeEventListener('message',fn);},close:()=>{}};
      transport.native=true;transport.ready=new Promise((resolve,reject)=>{transport.resolveReady=resolve;transport.rejectReady=reject;transport.readyTimer=setTimeout(()=>reject(new Error('native administrator bridge unavailable')),7000);});
    }else{
      const base=canonicalBase(this.base),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);let ticket;
      try{const response=await this.fetch(base+'/ramws-ticket',{method:'POST',headers:{'Content-Type':'application/json','X-JA21-RAMWS':'1'},body:'{"role":"admin"}',credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error(`Administrator admission refused (HTTP ${response.status})`);const text=await response.text();if(utf8(text).length>4096)throw new Error('admission response too large');ticket=strictParse(text).ticket;if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(ticket))throw new Error('invalid admission ticket');}finally{clearTimeout(timer);}
      if(generation!==this.generation)throw new Error('administrator connection cancelled');
      const ws=new this.WS(base.replace(/^http/,'ws')+'/ws/admin-terminal',['ja21.admin.v1']);
      transport={send:m=>{const text=JSON.stringify(m);if(ws.readyState!==1||ws.bufferedAmount+utf8(text).length>1048576)throw new Error('administrator connection backpressure');ws.send(text);},listen:fn=>{ws.onmessage=fn;return ()=>{ws.onmessage=null;};},close:()=>{ws.onopen=null;ws.onerror=null;ws.onclose=null;try{ws.close(1000,boundedReason('administrator terminal closed'));}catch{}}};
      transport.ready=new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('administrator connection timeout')),7000);ws.onopen=()=>{clearTimeout(t);try{ws.send(JSON.stringify({type:'auth',ticket}));resolve();}catch(e){reject(e);}};ws.onerror=()=>{clearTimeout(t);reject(new Error('administrator WebSocket failed'));};ws.onclose=()=>{clearTimeout(t);reject(new Error('administrator connection lost'));};});
      transport.onLost=fn=>{const error=ws.onerror,ended=ws.onclose;ws.onerror=e=>{error?.(e);fn('administrator connection failed');};ws.onclose=e=>{ended?.(e);fn('administrator connection lost; command outcomes may be unknown');};};
    }
    if(generation!==this.generation){transport.close();throw new Error('administrator connection cancelled');}
    this.connection=transport;
    let sid=null,bridgeEpoch=null,closed=false,opened=false,removeListener=()=>{},resolveOpen,rejectOpen,rateAt=Date.now(),rateCount=0,rateBytes=0;
    const delegates=new Map(),targets=new Set(),seenDelegates=new Set(),opening=new Promise((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;}),openId='admin-'+(++this.serial);
    const send=(op,payload={})=>{if(closed||generation!==this.generation||(!sid&&op!=='open'))throw new Error('administrator terminal is closed');
      if(Date.now()-rateAt>=1000){rateAt=Date.now();rateCount=0;rateBytes=0;}const m={v:1,id:'admin-'+(++this.serial),op,payload,...(sid?{sid}:{}),...(transport.native?{bridgeEpoch}:{})},size=utf8(JSON.stringify(m)).length;
      if(size>(op==='delegate-result'?524288:65536)||++rateCount>256||(op!=='delegate-result'&&(rateBytes+=size)>65536))throw new Error('administrator input rate or byte limit');transport.send(m);return m.id;};
    const close=(reason='administrator terminal closed')=>{if(closed)return;closed=true;for(const c of delegates.values())c.abort();delegates.clear();targets.clear();try{if(sid)transport.send({v:1,id:'admin-'+(++this.serial),sid,op:'close',payload:{},...(transport.native?{bridgeEpoch}:{})});else if(transport.native&&bridgeEpoch)transport.send({v:1,id:'cancel-'+(++this.serial),op:'cancel-open',payload:{requestId:openId},bridgeEpoch});}catch{}clearTimeout(openTimer);clearTimeout(transport.readyTimer);transport.rejectReady?.(new Error(reason));removeListener();transport.close();if(this.connection===transport){this.connection=null;this.active=null;}if(!opened)rejectOpen(new Error(reason));try{onClose(reason);}catch{}};
    const socket={kind:'admin',get sid(){return sid;},write:text=>{if(typeof text!=='string'||!text||text.includes('\0')||utf8(text).length>8192)throw new Error('administrator input limit');send('input',{text});},resize:(c,r)=>{if(!Number.isInteger(c)||c<2||c>400||!Number.isInteger(r)||r<1||r>200)throw new Error('invalid terminal geometry');send('resize',{cols:c,rows:r});},signal:()=>send('interrupt',{}),status:async()=>({admin:true,connection:closed?'closed':opened?'connected':'awaiting Windows elevation',elevated:opened,execution:'Windows PowerShell'}),close};
    this.active=socket;const openTimer=setTimeout(()=>close('Windows elevation did not complete; administrator terminal closed'),this.openTimeoutMs);
    removeListener=transport.listen(e=>{if(closed||generation!==this.generation)return;try{
      const raw=e.data;if(typeof raw==='string'&&utf8(raw).length>65536)throw new Error('administrator event too large');const m=typeof raw==='string'?strictParse(raw):raw;
      if(!m||m.v!==1||typeof m.type!=='string'||Object.keys(m).some(k=>!['v','type','id','sid','payload'].includes(k))||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload)||utf8(JSON.stringify(m)).length>65536)throw new Error('invalid administrator event');
      if(m.type==='ready'){if(transport.native){if(bridgeEpoch||typeof m.payload.bridgeEpoch!=='string'||!/^[A-Za-z0-9_-]{32,64}$/.test(m.payload.bridgeEpoch)||m.payload.available!==true)throw new Error('invalid native administrator handshake');bridgeEpoch=m.payload.bridgeEpoch;clearTimeout(transport.readyTimer);transport.resolveReady();}return;}
      if(m.type==='opened'){if(opened||m.id!==openId||typeof m.sid!=='string'||!ID.test(m.sid)||m.payload.elevated!==true)throw new Error('administrator elevation not confirmed');sid=m.sid;opened=true;clearTimeout(openTimer);resolveOpen(socket);return;}
      if(m.type==='error'){if(sid&&m.sid!==sid)throw new Error('stale administrator error');throw new Error(String(m.payload.message??m.payload.error??'Administrator terminal failed').slice(0,512));}
      if(!opened||m.sid!==sid)throw new Error('stale administrator session');
      if(m.type==='output'){if(typeof m.payload.text!=='string'||utf8(m.payload.text).length>16384)throw new Error('administrator output limit');onData(m.payload.text);return;}
      if(m.type==='closed'){close(String(m.payload.reason??'Administrator PowerShell ended'));return;}
      if(m.type==='ack')return;
      if(m.type==='delegate'){
        const p=m.payload,id=p.requestId;if(typeof id!=='string'||!ID.test(id)||m.id!==id||![1,2].includes(p.terminal)||typeof p.command!=='string'||p.command.length>4096||utf8(p.command).length>8192||/[\x00-\x1f\x7f-\x9f]/.test(p.command)||seenDelegates.has(id)||seenDelegates.size>=1024||delegates.size>=2||targets.has(p.terminal))throw new Error('invalid or repeated delegation');const controller=new AbortController();delegates.set(id,controller);targets.add(p.terminal);seenDelegates.add(id);
        Promise.resolve().then(()=>{if(controller.signal.aborted)throw new Error('delegation cancelled');return this.onDelegate({id,target:p.terminal,command:p.command,signal:controller.signal});}).then(r=>{if(typeof r.output!=='string'||utf8(r.output).length>65536||!Number.isInteger(r.code)||r.code<0||r.code>255||r.completion!=='COMPLETED')throw new Error('invalid delegation result');return {requestId:id,code:r.code,output:r.output,truncated:!!r.truncated,completion:r.completion};},error=>({requestId:id,error:String(error?.message??error).slice(0,256),outcome:'UNKNOWN'})).then(result=>{if(!closed&&generation===this.generation)send('delegate-result',result);}).catch(error=>close(error.message)).finally(()=>{delegates.delete(id);targets.delete(p.terminal);});return;
      }
      throw new Error('unsupported administrator event');
    }catch(error){close(error.message);}});
    transport.onLost?.(close);
    try{if(transport.native)transport.send({v:1,id:'hello-'+(++this.serial),op:'hello',payload:{}});await transport.ready;if(closed||generation!==this.generation)throw new Error('administrator connection cancelled');transport.send({v:1,id:openId,op:'open',payload:{cols,rows},...(transport.native?{bridgeEpoch}:{})});}catch(error){close(error.message);}
    return opening;
  }
  close(reason='administrator terminal stopped'){this.active?.close(reason);this.generation++;if(this.connection){this.connection.close();this.connection=null;}}
}
