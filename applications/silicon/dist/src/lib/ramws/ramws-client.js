import { codec, LIMITS, loopbackBase, wsUrl, dataFrame, getTicket, boundedReason } from './ramws-wire.js';
import { b64url, utf8 } from './hermit-codec.js';

function randomId(){const b=new Uint8Array(12);globalThis.crypto.getRandomValues(b);return b64url(b);}

/** A bounded hermit.vws.v2 terminal on the same localhost XPU owner. No input replay. */
export class RamWsClient {
  constructor({base,fetchImpl=globalThis.fetch,WebSocketImpl=globalThis.WebSocket,timeoutMs=LIMITS.openTimeoutMs}={}){
    this.base=loopbackBase(base);this.fetchImpl=fetchImpl;this.WebSocketImpl=WebSocketImpl;this.timeoutMs=timeoutMs;this.sockets=new Set();this.pendingOpens=0;this.generation=0;
  }
  async open({cols=100,rows=28,onData=()=>{},onClose=()=>{}}={}){
    if(!Number.isInteger(cols)||cols<2||cols>400||!Number.isInteger(rows)||rows<1||rows>200)throw new Error('invalid terminal geometry');
    if(this.sockets.size+this.pendingOpens>=LIMITS.maxSessions)throw new Error('RAMWS terminal limit reached');
    const generation=this.generation;this.pendingOpens++;let admission;
    try{admission=await getTicket(this.base,'terminal',{fetchImpl:this.fetchImpl,timeoutMs:this.timeoutMs});}finally{this.pendingOpens--;}
    if(generation!==this.generation)throw new Error('terminal admission cancelled');
    const ws=new this.WebSocketImpl(wsUrl(this.base,'/ws/terminal'),['hermit.vws.v2']);ws.binaryType='arraybuffer';
    let sid=null,epoch=null,helloEpoch=null,closed=false,opened=false,inSeq=0,lastOut=0,consumedSeq=0,acceptedSeq=0,executedSeq=0,pendingBytes=0,receivedBytes=0,consumedBytes=0,creditBytes=0,creditedAt=0,sinceCredit=0,queuedBytes=0,queuedCount=0,delivery=Promise.resolve();
    const inputSizes=new Map(),inputWaits=new Map(),decoder=new TextDecoder('utf-8',{fatal:true}),rid=randomId();
    let resolveOpen,rejectOpen;
    const opening=new Promise((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});
    const send=(m)=>{if(closed||ws.readyState!==1)throw new Error('terminal is closed');const text=codec.encode(m,'client_to_server');if(ws.bufferedAmount+utf8(text).length>LIMITS.socketBytes)throw new Error('RAMWS socket backpressure');ws.send(text);};
    const close=(reason='client closed',code=1000,notify=true)=>{
      if(closed)return;closed=true;clearTimeout(openTimer);this.sockets.delete(socket);
      for(const w of inputWaits.values()){clearTimeout(w.timer);w.reject(new Error(reason));}inputWaits.clear();inputSizes.clear();pendingBytes=0;
      if(!opened)rejectOpen(new Error(reason));
      if(notify&&opened&&ws.readyState===1){try{ws.send(codec.encode({v:2,type:'session.close',rid:randomId(),sid,epoch,payload:{reason:'user'}},'client_to_server'));}catch{}}
      try{ws.close(code,boundedReason(reason));}catch{}
      try{onClose(reason,{unknownInputs:Math.max(0,inSeq-executedSeq),acceptedSeq,executedSeq,replayedInputs:0});}catch{}
    };
    const credit=()=>{
      if(closed||!opened)return;creditBytes=consumedBytes+LIMITS.creditWindowBytes;creditedAt=consumedBytes;sinceCredit=0;
      send({v:2,type:'flow.credit',sid,epoch,payload:{consumedSeq,creditBytes}});
    };
    const write=(text,tracked)=>{
      if(closed||!opened)throw new Error('terminal is closed');
      if(typeof text!=='string'||!text||text.length>LIMITS.inputPendingBytes||text.includes('\0'))throw new Error('input length or type limit');
      if(tracked&&inputWaits.size>=64)throw new Error('too many pending input acknowledgements');
      const bytes=utf8(text);if(bytes.length>LIMITS.inputPendingBytes||pendingBytes+bytes.length>LIMITS.inputPendingBytes||ws.bufferedAmount+bytes.length+14>LIMITS.socketBytes)throw new Error('input backpressure; wait before sending more');
      if(inputSizes.size+Math.ceil(bytes.length/LIMITS.inputBytes)>LIMITS.inputPendingMessages)throw new Error('input message backpressure; wait before sending more');
      if(inSeq+Math.ceil(bytes.length/LIMITS.inputBytes)>codec.U48_MAX)throw new Error('input sequence exhausted');
      let target=0;
      for(let off=0;off<bytes.length;off+=LIMITS.inputBytes){const part=bytes.subarray(off,off+LIMITS.inputBytes),n=++inSeq;inputSizes.set(n,part.length);pendingBytes+=part.length;ws.send(dataFrame(1,n,part));target=n;}
      if(!tracked)return;
      return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{inputWaits.delete(target);close('input acknowledgement timeout',1011);reject(new Error('input acknowledgement timeout'));},4000);inputWaits.set(target,{resolve,reject,timer});});
    };
    const socket={
      get sid(){return sid;},write(text){return write(text,false);},writeAccepted(text){return write(text,true);},
      resize(c,r){if(!Number.isInteger(c)||c<2||c>400||!Number.isInteger(r)||r<1||r>200)throw new Error('invalid terminal geometry');send({v:2,type:'terminal.resize',rid:randomId(),sid,epoch,payload:{cols:c,rows:r}});cols=c;rows=r;},
      signal(){send({v:2,type:'terminal.signal',rid:randomId(),sid,epoch,payload:{signal:'SIGINT'}});},
      async status(){return {sid,epoch,cols,rows,remote:true,connection:closed?'closed':opened?'connected':'opening',protocol:'hermit.vws.v2',profile:'LOCAL_VOLATILE',pendingInputBytes:pendingBytes,acceptedSeq,executedSeq,executionAcknowledgement:'UNKNOWN',unknownInputs:Math.max(0,inSeq-executedSeq),queuedOutputBytes:queuedBytes,queuedOutputMessages:queuedCount,consumedSeq,replayedInputs:0};},
      close(reason){close(reason);}
    };
    this.sockets.add(socket);const openTimer=setTimeout(()=>close('terminal open timeout',1011),this.timeoutMs);
    const protocolError=(error)=>close(String(error?.message||error||'terminal protocol error'),1002,false);
    ws.onopen=()=>{try{ws.send(JSON.stringify({type:'auth',ticket:admission.ticket}));}catch(error){protocolError(error);}};
    ws.onerror=()=>close('WebSocket connection failed',1011,false);
    ws.onclose=e=>close(`connection ended (${e.code}); input outcomes may be unknown`,e.code===1000?1000:1011,false);
    ws.onmessage=e=>{
      if(closed)return;
      try{
        if(typeof e.data!=='string'){
          const d=codec.decodeData(new Uint8Array(e.data),'server_to_client');
          if(!opened||d.seq!==lastOut+1)throw new Error('invalid output sequence or open ordering');
          if(receivedBytes+d.payload.length>creditBytes||queuedBytes+d.payload.length>LIMITS.queueBytes||queuedCount>=LIMITS.outputQueueMessages)throw new Error('output credit or queue limit exceeded');
          lastOut=d.seq;receivedBytes+=d.payload.length;queuedBytes+=d.payload.length;queuedCount++;
          const payload=d.payload;
          delivery=delivery.then(async()=>{
            if(closed)return;const text=decoder.decode(payload,{stream:true});if(text)await onData(text);
            if(closed)return;queuedBytes-=payload.length;queuedCount--;consumedBytes+=payload.length;consumedSeq=d.seq;sinceCredit++;
            if(consumedBytes-creditedAt>=LIMITS.creditWindowBytes/4||creditBytes-consumedBytes<LIMITS.creditWindowBytes/2||sinceCredit>=128)credit();
          }).catch(protocolError);return;
        }
        const {msg:m}=codec.decode(e.data,'server_to_client');
        if(m.sid!==undefined&&m.type!=='session.opened'&&(!opened||m.sid!==sid||m.epoch!==epoch))throw new Error('stale session or epoch');
        switch(m.type){
          case 'hello':
            if(helloEpoch||m.payload.limits.inputBytes<LIMITS.inputBytes||m.payload.limits.outputChunkBytes<LIMITS.outputBytes||m.payload.limits.maxCreditWindowBytes<LIMITS.creditWindowBytes)throw new Error('invalid hello or limits');
            helloEpoch=m.payload.serverEpoch;creditBytes=LIMITS.creditWindowBytes;send({v:2,type:'session.open',rid,payload:{cols,rows,mode:'virtual',creditBytes}});break;
          case 'session.opened':
            if(opened||!helloEpoch||m.rid!==rid||m.epoch!==helloEpoch)throw new Error('invalid session open');
            sid=m.sid;epoch=m.epoch;opened=true;clearTimeout(openTimer);resolveOpen(socket);break;
          case 'input.ack':{
            const a=m.payload.acceptedSeq,x=m.payload.executedSeq;if(a<acceptedSeq||a>inSeq||x<executedSeq||x>a)throw new Error('invalid input acknowledgement');acceptedSeq=a;executedSeq=x;
            for(const [n,size] of inputSizes)if(n<=a){pendingBytes-=size;inputSizes.delete(n);}
            for(const [n,w] of inputWaits)if(n<=a){clearTimeout(w.timer);inputWaits.delete(n);w.resolve({acceptedSeq:a,executedSeq:x});}break;
          }
          case 'heartbeat.ping':send({v:2,type:'heartbeat.pong',rid:m.rid,payload:{nonce:m.payload.nonce}});break;
          case 'heartbeat.pong':case 'request.ack':break;
          case 'session.exit':close(m.payload.reason,1000,false);break;
          case 'session.reset':throw new Error('session reset; nothing was replayed');
          case 'service.draining':close('service draining',1001,false);break;
          case 'error':throw new Error(`${m.payload.code}: ${m.payload.message}`);
          default:throw new Error('unsupported server control');
        }
      }catch(error){protocolError(error);}
    };
    return opening;
  }
  close(reason='client stopped'){this.generation++;for(const s of [...this.sockets])s.close(reason);}
}
