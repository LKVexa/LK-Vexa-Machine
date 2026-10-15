import { PROTOCOL, KIND_INPUT, KIND_OUTPUT, encodeData, decodeData } from '../vendor/vws/frame.js';
export class RamLink extends EventTarget {
  constructor({validation=false}={}) { super(); if(typeof validation!=='boolean')throw new TypeError('validation profile must be boolean');this.validation=validation;this.worker=null;this.epoch=null;this.ready=null;this.sockets=new Set();this.pending=new Map();this.sequence=0;this.generation=0; }
  event(type,detail) { this.dispatchEvent(new CustomEvent(type,{detail})); }
  start() {
    this.destroy('restarting'); const generation=++this.generation;
    const workerUrl=new URL('../vendor/ram-worker.js',import.meta.url);if(this.validation)workerUrl.search='?validation=semisili-v1';
    const worker=new Worker(workerUrl,{type:'module'});this.worker=worker;
    this.ready=new Promise((resolve,reject)=>{
      let settled=false;
      const settle=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);this.bootReject=null;error?reject(error):resolve(value);};
      this.bootReject=e=>settle(e);
      const timer=setTimeout(()=>{settle(new Error('worker boot timed out'));this.destroy('boot timeout');},15000);
      worker.onmessage=e=>{
        if(generation!==this.generation)return;const m=e.data;
        if(!m || typeof m!=='object')return;
        if(m.type==='ready') { if(settled)return; if(m.protocol!==PROTOCOL || typeof m.epoch!=='string'){settle(new Error('protocol mismatch'));this.destroy('protocol mismatch');return;}this.epoch=m.epoch;settle(null,m);this.event('ready',m); }
        else if(m.type==='error'){const error=new Error(m.message || 'worker failure');settle(error);this.destroy(error.message);this.event('fault',{message:error.message});}
        else if(m.type==='rpc'){const request=this.pending.get(m.id);if(request){clearTimeout(request.timer);this.pending.delete(m.id);m.error?request.reject(new Error(m.error)):request.resolve(m.result);}}
        else if(['holo','halt','browser'].includes(m.type)){if(m.type==='halt'){for(const s of [...this.sockets])s.close('server halted');this.epoch=null;}this.event(m.type,m.payload || m);}
      };
      worker.onerror=e=>{if(generation!==this.generation)return;const detail=typeof e?.message==='string'&&e.message?e.message.slice(0,400):'no browser error detail';const error=new Error(`worker execution failure: ${detail}`);settle(error);this.destroy(error.message);this.event('fault',{message:error.message});};
      worker.onmessageerror=()=>{if(generation!==this.generation)return;const error=new Error('worker message decode failure');settle(error);this.destroy(error.message);this.event('fault',{message:error.message});};
    });
    return this.ready;
  }
  async open({cols=100,rows=28,onData=()=>{},onClose=()=>{}}={}) {
    await this.ready;
    if(!this.worker || !this.epoch)throw new Error('server is not running');
    const channel=new MessageChannel(),port=channel.port1,epoch=this.epoch,generation=this.generation;
    let sid=null,closed=false,seq=0,receivedSeq=0,consumedBytes=0,pendingBytes=0,outputPaused=false;
    const decoder=new TextDecoder('utf-8',{fatal:true});const waits=new Map();const inputSizes=new Map(),acceptedWaits=new Map();
    let openReject;
    const send=(type,payload={},rid)=>{if(closed)throw new Error('terminal is closed');port.postMessage({v:3,epoch,sid,type,payload,rid});};
    const socket={
      get sid(){return sid;},
      write(text){if(closed || !sid)throw new Error('terminal is closed');if(typeof text!=='string' || !text || text.length>4098 || text.includes('\0'))throw new Error('input length or type limit');const bytes=new TextEncoder().encode(text);if(bytes.length>8192 || pendingBytes+bytes.length>16384)throw new Error('input backpressure; wait before sending more');const frame=encodeData(KIND_INPUT,++seq,bytes);inputSizes.set(seq,bytes.length);pendingBytes+=bytes.length;port.postMessage(frame,[frame.buffer]);},
      writeAccepted(text){if(typeof text!=='string'||!text||text.length>4098||text.includes('\0'))return Promise.reject(new Error('input length or type limit'));return socket.writeBytesAccepted(new TextEncoder().encode(text));},
      writeBytesAccepted(bytes){
        if(closed||!sid)return Promise.reject(new Error('terminal is closed'));
        if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>8192||Uint8Array.prototype.includes.call(bytes,0))return Promise.reject(new Error('input byte length or type limit'));
        if(pendingBytes+bytes.length>16384||acceptedWaits.size>=64)return Promise.reject(new Error('input backpressure; wait before sending more'));
        return new Promise((resolve,reject)=>{const next=seq+1,frame=encodeData(KIND_INPUT,next,bytes);const timer=setTimeout(()=>{acceptedWaits.delete(next);reject(new Error('worker input admission timed out; execution is uncertain'));socket.close('input admission timeout');},4000);
          acceptedWaits.set(next,{resolve,reject,timer});seq=next;inputSizes.set(next,bytes.length);pendingBytes+=bytes.length;
          try{port.postMessage(frame,[frame.buffer]);}catch(error){clearTimeout(timer);acceptedWaits.delete(next);socket.close('input delivery failed');reject(error);}
        });
      },
      pauseOutput(){outputPaused=true;},
      resumeOutput(){if(closed)return;outputPaused=false;send('flow.ack',{consumedBytes});},
      resize(cols,rows){send('terminal.resize',{cols,rows});}, signal(){send('terminal.signal',{signal:'SIGINT'});},
      status(){return new Promise((resolve,reject)=>{if(waits.size>=32){reject(new Error('too many pending status requests'));return;}if(closed){reject(new Error('terminal is closed'));return;}const rid=`s${++thisLink.sequence}`;const timer=setTimeout(()=>{waits.delete(rid);reject(new Error('status timeout'));},4000);waits.set(rid,{resolve,reject,timer});try{send('session.status',{},rid);}catch(error){clearTimeout(timer);waits.delete(rid);reject(error);}});},
      close(reason='client closed') {if(closed)return;try{send('session.close');}catch{}closed=true;clearTimeout(openTimer);port.onmessage=null;port.close();thisLink.sockets.delete(socket);for(const r of [...waits.values(),...acceptedWaits.values()]){clearTimeout(r.timer);r.reject(new Error(reason));}waits.clear();acceptedWaits.clear();inputSizes.clear();openReject?.(new Error(reason));openReject=null;try{onClose(reason);}catch(error){thisLink.event('fault',{message: String(error?.message || error).slice(0,512)});}}
    };
    const thisLink=this;this.sockets.add(socket);
    const opened=new Promise((resolve,reject)=>{openReject=reject;socket._resolve=resolve;});
    const openTimer=setTimeout(()=>socket.close('terminal open timeout'),5000);
    port.onmessageerror=()=>socket.close('message decode failure');
    port.onmessage=e=>{
      try{
        if(closed || generation!==this.generation)return;
        const m=e.data;
        if(m instanceof Uint8Array || m instanceof ArrayBuffer){const f=decodeData(m);if(!sid || f.kind!==KIND_OUTPUT || f.seq!==receivedSeq+1)throw new Error('invalid output sequence or kind');receivedSeq=f.seq;const text=decoder.decode(f.payload,{stream:true});onData(text);consumedBytes+=f.payload.length;if(!Number.isSafeInteger(consumedBytes))throw new Error('byte counter exhausted');if(!outputPaused)send('flow.ack',{consumedBytes});return;}
        if(!m || m.v!==3 || m.epoch!==epoch || (sid && m.sid!==sid))throw new Error('invalid terminal control envelope');
        if(m.type==='hello'){if(m.payload?.protocol!==PROTOCOL)throw new Error('protocol mismatch');send('session.open',{cols,rows});}
        else if(m.type==='session.opened'){if(sid || typeof m.sid!=='string')throw new Error('invalid open');sid=m.sid;clearTimeout(openTimer);openReject=null;socket._resolve(socket);delete socket._resolve;send('session.start');}
        else if(m.type==='input.ack'){const accepted=m.payload?.acceptedSeq;if(!Number.isSafeInteger(accepted) || accepted<1 || accepted>seq)throw new Error('invalid input acknowledgement');for(const [n,size] of inputSizes)if(n<=accepted){pendingBytes-=size;inputSizes.delete(n);}for(const [n,r] of acceptedWaits)if(n<=accepted){clearTimeout(r.timer);acceptedWaits.delete(n);r.resolve({acceptedSeq:n});}}
        else if(m.type==='session.status'){const r=waits.get(m.rid);if(r){clearTimeout(r.timer);waits.delete(m.rid);r.resolve(m.payload);}}
        else if(m.type==='session.exit')socket.close(m.payload?.reason || 'session ended');
        else if(m.type==='error')throw new Error(m.message || 'terminal protocol error');
      }catch(error){socket.close(error.message);this.event('fault',{message:error.message});}
    };
    port.start();try{this.worker.postMessage({type:'attach'},[channel.port2]);}catch(error){channel.port2.close();socket.close(error.message);}return opened;
  }
  rpc(op,options={}) {
    if(!this.worker)return Promise.reject(new Error('worker not available'));
    if(this.pending.size>=64)return Promise.reject(new Error('too many pending management requests'));
    if(!options || typeof options!=='object' || Array.isArray(options))return Promise.reject(new Error('invalid management options'));
    return new Promise((resolve,reject)=>{const id=`r${++this.sequence}`;const timer=setTimeout(()=>{this.pending.delete(id);if(op==='xpu'&&options.action==='run')this.worker?.postMessage({type:'rpc',id:`cancel-${id}`,op:'xpu-cancel'});reject(new Error(`${op} timed out`));},op==='delegate'?35000:15000);this.pending.set(id,{resolve,reject,timer});try{this.worker.postMessage({...options,type:'rpc',id,op});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
  }
  destroy(reason='client stopped') {
    const error=new Error(reason);this.bootReject?.(error);this.bootReject=null;for(const s of [...this.sockets])s.close(reason);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.worker?.terminate();this.worker=null;this.epoch=null;this.ready=null;this.generation++;
  }
}
