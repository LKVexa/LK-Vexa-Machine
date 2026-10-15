const enc=new TextEncoder();
export function validDelegatedCommand(command){return typeof command==='string'&&!!command.trim()&&command.length<=4096&&enc.encode(command).length<=8192&&!/[\x00-\x1f\x7f-\x9f]/.test(command);}
/** Completion comes from the shell after output and durable flush, never from a prompt or input ACK. */
export class XpuDelegation {
  constructor(kernel,{timeoutMs=30000,maxOutputBytes=65536}={}){
    this.kernel=kernel;this.pending=new Map();this.seen=new Set();this.timeoutMs=timeoutMs;this.maxOutputBytes=maxOutputBytes;
    kernel.on('data',e=>{const r=this.pending.get(e.sessionId);if(!r)return;const bytes=enc.encode(e.chunk);r.outputBytes+=bytes.length;let room=this.maxOutputBytes-r.capturedBytes;
      if(room<bytes.length)r.truncated=true;if(room<=0)return;
      let part='';for(const ch of e.chunk){const n=enc.encode(ch).length;if(n>room)break;part+=ch;room-=n;r.capturedBytes+=n;}r.output+=part;});
    kernel.on('command-complete',e=>this.finish(e.sessionId,null,{code:e.code,completion:'COMPLETED',persistence:e.persistence??'NOT_CONFIGURED'}));
    kernel.on('exit',e=>this.finish(e.sessionId,new Error('target terminal closed; command outcome is unknown')));
  }
  run(sid,command,requestId=crypto.randomUUID()){
    if(!validDelegatedCommand(command))return Promise.reject(new Error('delegate one command line, at most 4096 characters / 8192 UTF-8 bytes'));
    if(typeof requestId!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(requestId)||this.seen.has(requestId)||this.seen.size>=4096)return Promise.reject(new Error('delegation request was already used or epoch quota exhausted; nothing was replayed'));
    const s=this.kernel.sessions.get(sid);
    if(!s?.alive||!s.started)return Promise.reject(new Error('target terminal is unavailable'));
    if(this.pending.has(sid)||s.running||s.waiting||!s.pending||s.pending.done||s.pending.buf||s.pending.escBuf||s.typeahead||this.kernel.commandBarrier)return Promise.reject(new Error('target terminal must be idle with an empty input line'));
    this.seen.add(requestId);
    return new Promise((resolve,reject)=>{
      const r={resolve,reject,requestId,settled:false,output:'',outputBytes:0,capturedBytes:0,truncated:false,timer:null};this.pending.set(sid,r);s.delegation=r;
      r.timer=setTimeout(()=>{this.finish(sid,new Error('delegation timed out; command outcome is unknown; nothing was replayed'));this.kernel.closeSession(sid,'delegation timeout');},this.timeoutMs);
      try{s.pending.feed(command+'\r');}catch(error){this.finish(sid,error);}
    });
  }
  cancel(sid,requestId){const r=this.pending.get(sid);if(!r||r.requestId!==requestId||r.settled)return false;r.settled=true;this.kernel.signal(sid,'SIGINT');r.reject(new Error('delegation cancelled; command outcome is unknown; nothing was replayed'));return true;}
  finish(sid,error,result){const r=this.pending.get(sid);if(!r)return;this.pending.delete(sid);clearTimeout(r.timer);const s=this.kernel.sessions.get(sid);if(s?.delegation===r)s.delegation=null;
    if(r.settled)return;r.settled=true;if(error)r.reject(error);else r.resolve({...result,output:r.output,outputBytes:r.outputBytes,truncated:r.truncated});}
}
