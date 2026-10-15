import {RamWsClient} from './lib/ramws/ramws-client.js';
import {loopbackBase} from './lib/ramws/ramws-wire.js';
import {Screen} from './vendor/vt/screen.js';
import {Parser} from './vendor/vt/parser.js';
import {CanvasRenderer} from './vendor/vt/renderer-canvas.js';
import {accessibility} from './vendor/vt/accessibility.js';

// This page owns only its display and terminal connection. The main console owns the worker.
const $=id=>document.getElementById(id), canvas=$('terminal-canvas');
const terminalAccess=accessibility({status:$('terminal-announcement'),screen:$('transcript')});
let screen=new Screen(100,28),parser=new Parser(screen),renderer=new CanvasRenderer(canvas,screen,{fontSize:13});
let client=null,socket=null,openingAbort=null,connecting=false,generation=0,base=null;
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
function fault(error){notice(error?.message||String(error));}
function controls(label){
  const connected=!!socket;$('connection').textContent=label??(connected?'Connected':connecting?'Connecting':'Disconnected');
  $('connect').disabled=!base||connected||connecting;$('disconnect').disabled=!connected&&!connecting;
  $('command').disabled=!connected;$('run').disabled=!connected;$('interrupt').disabled=!connected;
  for(const button of document.querySelectorAll('[data-command]'))button.disabled=!connected;
  terminalAccess.announce($('connection').textContent);
}
function render(){renderer.render();terminalAccess.mirror(screen);}
function fit(){
  const box=$('terminal-container');
  const width=Math.min(400*renderer.cellW,Math.max(2*renderer.cellW,box.clientWidth-16));
  const height=Math.min(200*renderer.cellH,Math.max(renderer.cellH,box.clientHeight-16));
  const size=renderer.fit(width,height),cols=Math.max(2,Math.min(400,size.cols)),rows=Math.max(1,Math.min(200,size.rows));
  if(screen.cols!==cols||screen.rows!==rows){screen.resize(cols,rows);try{socket?.resize(cols,rows);}catch(error){fault(error);}}
  if(socket)$('session-status').textContent='Connected · '+cols+' × '+rows+' · same XPU as the main console';
  render();
}
new ResizeObserver(fit).observe($('terminal-container'));
function resetDisplay(){screen=new Screen(100,28);parser=new Parser(screen);renderer=new CanvasRenderer(canvas,screen,{fontSize:13});fit();}
function fetchForOpening(abortSignal){
  return (url,options={})=>{
    const combined=new AbortController(),signals=[abortSignal,options.signal].filter(Boolean),listeners=[];
    for(const signal of signals){const abort=()=>combined.abort();if(signal.aborted)abort();else{signal.addEventListener('abort',abort,{once:true});listeners.push([signal,abort]);}}
    return fetch(url,{...options,signal:combined.signal}).finally(()=>{for(const [signal,abort] of listeners)signal.removeEventListener('abort',abort);});
  };
}
async function connect(){
  if(connecting||socket||!base)return;
  const current=++generation,controller=new AbortController();openingAbort=controller;connecting=true;notice('');controls();resetDisplay();
  const selected=new RamWsClient({base,fetchImpl:fetchForOpening(controller.signal)});client=selected;
  try{
    const opened=await selected.open({cols:screen.cols,rows:screen.rows,
      onData:text=>{if(current!==generation)return;parser.write(text);renderer.scrollToBottom();render();},
      onClose:(reason)=>{
        if(current!==generation)return;socket=null;client=null;connecting=false;openingAbort=null;controls();
        $('session-status').textContent='Connection ended · input outcomes may be unknown';
        notice(reason+'. Sent commands may have completed. Check the main console before sending them again. Nothing was replayed.');
      }});
    if(current!==generation){opened.close('connection cancelled');return;}
    socket=opened;connecting=false;openingAbort=null;controls();fit();$('command').focus();
  }catch(error){
    if(current!==generation)return;selected.close('connection failed');socket=null;client=null;connecting=false;openingAbort=null;controls('Unavailable');
    $('session-status').textContent='No connection. Keep the main console running and enable its WebSocket bridge.';fault(error);
  }
}
function disconnect(quiet=false){
  const hadConnection=!!socket||connecting;++generation;openingAbort?.abort();openingAbort=null;
  const closing=client;socket=null;client=null;connecting=false;closing?.close('user disconnected');controls();
  $('session-status').textContent='Disconnected · reconnect explicitly';
  if(!quiet&&hadConnection)notice('Disconnected. Sent commands may have completed. Check the main console before sending them again. Nothing was replayed.');
}
function sendCommand(line){
  if(!socket)throw new Error('connect to a running main console first');
  if(typeof line!=='string'||!line.trim()||line.length>4096||/[\x00-\x1f\x7f-\x9f]/.test(line))throw new Error('enter one command line, up to 4096 characters, without terminal controls');
  const current=generation,pending=socket.writeAccepted('\x15'+line+'\r');
  // Input acceptance is not execution confirmation. Never resend automatically after a lost connection.
  pending.catch(error=>{if(current===generation)notice((error?.message||String(error))+'. Input outcomes may be unknown. Check the main console. Nothing was replayed.');});
}
function interrupt(){try{if(!socket)throw new Error('no connected terminal');socket.signal();}catch(error){fault(error);}}
$('connect').addEventListener('click',()=>connect());$('disconnect').addEventListener('click',()=>disconnect());
$('command-form').addEventListener('submit',event=>{
  event.preventDefault();const input=$('command');if(!input.value.trim())return;
  try{sendCommand(input.value);input.value='';notice('');}catch(error){fault(error);}
});
$('interrupt').addEventListener('click',interrupt);
$('command').addEventListener('keydown',event=>{if(event.ctrlKey&&event.key.toLowerCase()==='c'){event.preventDefault();interrupt();}});
for(const button of document.querySelectorAll('[data-command]'))button.addEventListener('click',()=>{try{sendCommand(button.dataset.command);notice('');}catch(error){fault(error);}});
canvas.addEventListener('keydown',event=>{
  if(!socket||event.altKey||event.metaKey)return;let data='';
  if(event.ctrlKey){
    const key=event.key.toLowerCase();if(key==='c'){event.preventDefault();interrupt();return;}if(key==='v')return;
    if(event.key.length===1){const code=event.key.toUpperCase().charCodeAt(0);if(code>=64&&code<=95)data=String.fromCharCode(code-64);}
  }else{
    const keys={Enter:'\r',Backspace:'\x7f',Tab:'\t',ArrowUp:'\x1b[A',ArrowDown:'\x1b[B',ArrowRight:'\x1b[C',ArrowLeft:'\x1b[D',Home:'\x1b[H',End:'\x1b[F',Delete:'\x1b[3~',Escape:'\x1b'};
    data=keys[event.key]||([...event.key].length===1&&!/[\x00-\x1f\x7f-\x9f]/.test(event.key)?event.key:'');
  }
  if(data){event.preventDefault();try{socket.write(data);}catch(error){fault(error);}}
});
function pasteLine(raw){
  if(typeof raw!=='string'||raw.length>4096)throw new Error('paste limit: 4096 characters');
  return raw.replace(/[\r\n]+/g,' ').replace(/[\x00-\x1f\x7f-\x9f]/g,'');
}
canvas.addEventListener('paste',event=>{
  event.preventDefault();try{
    if(!socket)throw new Error('connect before pasting');const line=pasteLine(event.clipboardData?.getData('text/plain')||'');
    if(line)socket.write(line);notice('Pasted as one editable line. Press Enter to execute.');
  }catch(error){fault(error);}
});
$('command').addEventListener('paste',event=>{
  event.preventDefault();try{
    const input=$('command'),line=pasteLine(event.clipboardData?.getData('text/plain')||'');
    const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
    if(input.value.length-(end-start)+line.length>4096)throw new Error('command limit: 4096 characters');
    input.setRangeText(line,start,end,'end');notice('Pasted as one editable line. Press Run to execute.');
  }catch(error){fault(error);}
});
canvas.addEventListener('wheel',event=>{event.preventDefault();renderer.scrollBy(Math.sign(event.deltaY)*3);render();},{passive:false});
globalThis.addEventListener('pagehide',()=>disconnect(true));
try{base=loopbackBase(location.origin);if(location.protocol!=='http:')throw new Error('Open this terminal through the optional localhost WebSocket server.');}
catch(error){base=null;notice('This page needs the optional localhost WebSocket server. '+(error?.message||String(error)));}
controls();fit();
