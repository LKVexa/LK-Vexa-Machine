import { LIMITS, OWNER_PROTOCOL, loopbackBase, wsUrl, getTicket, ownerFrame, decodeOwnerFrame, ownerControl, sendControl, boundedReason, checkChannel } from './ramws-wire.js';
import { utf8 } from './hermit-codec.js';

/** Bridges the gateway to the existing browser RamLink; never constructs another kernel. */
export class RamWsOwner {
  constructor(link,{base,fetchImpl=globalThis.fetch,WebSocketImpl=globalThis.WebSocket,timeoutMs=LIMITS.openTimeoutMs,onState=()=>{}}={}){
    if(!link||typeof link.open!=='function')throw new TypeError('RAMWS requires the active XPU RamLink');
    this.link=link;this.base=loopbackBase(base);this.fetchImpl=fetchImpl;this.WebSocketImpl=WebSocketImpl;this.timeoutMs=timeoutMs;this.onState=onState;this.ws=null;this.epoch=null;this.sessions=new Map();this.generation=0;this.active=false;this.lastChannel=0;
  }
  async start(){return this.connect();}
  async connect(){
    this.close('owner reconnecting');const generation=++this.generation;
    await this.link.ready;if(generation!==this.generation)throw new Error('owner connection cancelled');if(!this.link.epoch)throw new Error('XPU worker is not ready');
    const ticket=await getTicket(this.base,'owner',{fetchImpl:this.fetchImpl,timeoutMs:this.timeoutMs});
    if(generation!==this.generation)throw new Error('owner connection cancelled');
    const ws=this.ws=new this.WebSocketImpl(wsUrl(this.base,'/ws/xpu-owner'),[OWNER_PROTOCOL]);ws.binaryType='arraybuffer';
    return new Promise((resolve,reject)=>{
      let settled=false;
      const timer=this.connectionTimer=setTimeout(()=>fail(new Error('owner open timeout')),this.timeoutMs);this.connectionReject=reject;
      const fail=error=>{if(!settled){settled=true;clearTimeout(timer);this.connectionReject=null;reject(error);}if(generation===this.generation)this.close(error.message);};
      ws.onopen=()=>{try{sendControl(ws,{type:'auth',ticket:ticket.ticket});}catch(error){fail(error);}};
      ws.onerror=()=>fail(new Error('owner WebSocket failed'));
      ws.onclose=()=>fail(new Error('owner connection lost; terminal outcomes may be unknown'));
      ws.onmessage=e=>{
        if(generation!==this.generation)return;
        try{
          if(typeof e.data!=='string'){
            if(!this.active)throw new Error('owner input before ready');const d=decodeOwnerFrame(e.data,'client_to_server'),rec=this.sessions.get(d.channel);
            if(!rec||!rec.opened||d.seq!==rec.inSeq+1)throw new Error('invalid owner input sequence');
            if(rec.inputBytes+d.payload.length>131072||rec.inputCount>=256)throw new Error('owner input queue exceeded');
            rec.inSeq=d.seq;rec.inputBytes+=d.payload.length;rec.inputCount++;
            const payload=d.payload;
            rec.inputChain=rec.inputChain.then(async()=>{
              if(rec.closed||generation!==this.generation)return;
              await rec.socket.writeBytesAccepted(payload);
              if(rec.closed||generation!==this.generation)return;
              rec.inputBytes-=payload.length;rec.inputCount--;rec.acceptedSeq=d.seq;
              this.send({v:1,type:'owner.accepted',channel:rec.channel,sid:rec.sid,epoch:this.epoch,upto:d.seq});
            }).catch(error=>this.end(rec,error.message,70));return;
          }
          const m=ownerControl(e.data);
          if(m.type==='owner.ready'){
            if(this.active||typeof m.epoch!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(m.epoch))throw new Error('invalid owner ready');
            this.epoch=m.epoch;this.active=true;settled=true;clearTimeout(timer);this.connectionReject=null;try{this.onState({state:'connected',epoch:this.epoch});}catch{}resolve(this.status());return;
          }
          if(!this.active||m.epoch!==this.epoch)throw new Error('stale owner epoch');
          if(m.type==='owner.open'){this.openSession(m,generation).catch(error=>fail(error));return;}
          checkChannel(m.channel);const rec=this.sessions.get(m.channel);
          if(!rec||m.sid!==rec.sid)throw new Error('unknown owner session');
          switch(m.type){
            case 'owner.resize':if(!Number.isInteger(m.cols)||m.cols<2||m.cols>400||!Number.isInteger(m.rows)||m.rows<1||m.rows>200)throw new Error('invalid resize');rec.socket?.resize(m.cols,m.rows);break;
            case 'owner.signal':if(m.signal!=='SIGINT')throw new Error('invalid signal');rec.socket?.signal();break;
            case 'owner.close':this.end(rec,'closed',0,false);break;
            case 'owner.pause':rec.paused=true;rec.socket?.pauseOutput();break;
            case 'owner.resume':rec.paused=false;this.pump(rec);rec.socket?.resumeOutput();break;
            default:throw new Error('unsupported owner control');
          }
        }catch(error){fail(error);}
      };
    });
  }
  send(msg){if(!this.ws||!this.active)throw new Error('owner is closed');sendControl(this.ws,msg);}
  async openSession(m,generation){
    checkChannel(m.channel);
    if(m.channel<=this.lastChannel||this.sessions.size>=LIMITS.maxSessions||typeof m.sid!=='string'||!/^[A-Za-z0-9_-]{22,64}$/.test(m.sid)||!Number.isInteger(m.cols)||m.cols<2||m.cols>400||!Number.isInteger(m.rows)||m.rows<1||m.rows>200)throw new Error('invalid owner session open');
    this.lastChannel=m.channel;
    const rec={channel:m.channel,sid:m.sid,opened:false,closed:false,paused:false,socket:null,inSeq:0,outSeq:0,acceptedSeq:0,inputBytes:0,inputCount:0,inputChain:Promise.resolve(),queue:[],queueBytes:0};this.sessions.set(rec.channel,rec);
    try{
      const socket=await this.link.open({cols:m.cols,rows:m.rows,onData:text=>this.output(rec,text),onClose:reason=>this.end(rec,reason,0)});
      if(rec.closed||generation!==this.generation){socket.close('stale owner session');return;}
      if(typeof socket.writeBytesAccepted!=='function'||typeof socket.pauseOutput!=='function'||typeof socket.resumeOutput!=='function'){socket.close('RAMWS worker acknowledgement or credit support missing');throw new Error('RAMWS requires worker acknowledgement and output pause support');}
      rec.socket=socket;rec.opened=true;this.send({v:1,type:'owner.opened',channel:rec.channel,sid:rec.sid,epoch:this.epoch,cols:m.cols,rows:m.rows});this.pump(rec);
    }catch(error){this.end(rec,error.message,70);}
  }
  output(rec,text){
    if(rec.closed)return;
    try{
      if(typeof text!=='string')throw new Error('invalid worker output');const bytes=utf8(text);
      if(rec.queueBytes+bytes.length>LIMITS.queueBytes||rec.queue.length+Math.ceil(bytes.length/LIMITS.outputBytes)>LIMITS.outputQueueMessages)throw new Error('owner output queue exceeded');
      for(let off=0;off<bytes.length;off+=LIMITS.outputBytes){const part=bytes.slice(off,off+LIMITS.outputBytes);rec.queue.push(part);rec.queueBytes+=part.length;}
      this.pump(rec);
    }catch(error){this.end(rec,error.message,70);}
  }
  pump(rec){
    if(rec.closed||rec.paused||!rec.opened||!this.active||!this.ws)return;
    try{
      while(rec.queue.length){const bytes=rec.queue[0];if(this.ws.bufferedAmount+bytes.length+11>LIMITS.socketBytes){rec.paused=true;rec.socket?.pauseOutput();this.end(rec,'owner socket backpressure',70);return;}if(rec.outSeq>=281474976710655)throw new Error('owner output sequence exhausted');this.ws.send(ownerFrame(rec.channel,2,++rec.outSeq,bytes));rec.queue.shift();rec.queueBytes-=bytes.length;}
    }catch(error){this.end(rec,error.message,70);}
  }
  end(rec,reason='closed',code=0,notify=true){
    if(!rec||rec.closed)return;rec.closed=true;this.sessions.delete(rec.channel);rec.queue.length=0;rec.queueBytes=0;
    try{rec.socket?.close(reason);}catch{}
    if(notify&&this.active){try{this.send({v:1,type:'owner.exit',channel:rec.channel,sid:rec.sid,epoch:this.epoch,code,reason:code?'worker_failure':'closed',detail:String(reason).slice(0,256),executedSeq:0});}catch{}}
  }
  status(){return {state:this.active?'connected':'closed',epoch:this.epoch,sessions:this.sessions.size,profile:'LOCAL_VOLATILE',executor:'existing JA21 browser XPU worker',executionAcknowledgement:'UNKNOWN',replayedInputs:0};}
  close(reason='owner stopped'){
    this.generation++;clearTimeout(this.connectionTimer);this.connectionReject?.(new Error(reason));this.connectionReject=null;this.active=false;for(const rec of [...this.sessions.values()])this.end(rec,reason,70,false);this.sessions.clear();this.epoch=null;this.lastChannel=0;
    const ws=this.ws;this.ws=null;if(ws){ws.onopen=null;ws.onmessage=null;ws.onerror=null;ws.onclose=null;try{ws.close(1000,boundedReason(reason));}catch{}}
    try{this.onState({state:'closed',reason});}catch{}
  }
}
