import test from 'node:test';
import assert from 'node:assert/strict';
import xpuCommands from '../src/vendor/spiral/commands/semisili.js';
import {SpiralKernel} from '../src/vendor/spiral/kernel.js';
import {Worker, MessageChannel} from 'node:worker_threads';
import {encodeData, decodeData, KIND_INPUT, KIND_OUTPUT} from '../src/vendor/vws/frame.js';

const command = xpuCommands[0], token = '349ad72d-6789-4e01-9a23-242bb1d70ed7';
const defaults = {prime:2,precision:8,operation:'add',operand:1,steps:4,source:'field',requireGpu:true};
function context(args=[], {flags={}, host, signal}={}) {
  const calls=[],output=[],errors=[];
  const bridge = host ?? {async xpuTerminal(action, options, forwardedSignal) {
    calls.push({action,options,signal:forwardedSignal});
    return action === 'run' ? {token,canApply:true,receipt:{status:'CPU_AND_GPU_CONFIRMED',publication:'PREVIEW',coverage:{cpu:['phase arithmetic','finite neuron update'],gpu:['finite ring arithmetic']}}}
      : action === 'apply' ? {saved:true,receipt:{publication:'COMMITTED'}} : {present:false};
  }};
  return {ctx:{args,flags,host:bridge,signal,stdout:{write:s=>output.push(s)},stderr:{write:s=>errors.push(s)}},calls,output,errors};
}

test('xpu info defaults to a read-only host query and forwards the AbortSignal', async()=>{
  const controller=new AbortController(), h=context([],{signal:controller.signal});
  assert.equal(await command.run(h.ctx),0);
  assert.deepEqual(h.calls,[{action:'info',options:{},signal:controller.signal}]);
  assert.deepEqual(JSON.parse(h.output.join('')),{present:false});
});
test('xpu help works without a host and describes explicit GPU coverage and preview saving',async()=>{
  const h=context(['help'],{host:{}});assert.equal(await command.run(h.ctx),0);
  const text=h.output.join('');assert.match(text,/GPU mode requires hardware confirmation of finite ring arithmetic/);
  assert.match(text,/detached preview/);assert.match(text,/explicitly save/);assert.equal(h.calls.length,0);
});
test('xpu run defaults to GPU requirement and never automatically saves its preview',async()=>{
  const h=context(['run']);assert.equal(await command.run(h.ctx),0);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'run');assert.deepEqual(h.calls[0].options,defaults);
  const result=JSON.parse(h.output.join(''));assert.equal(result.token,token);assert.equal(result.canApply,true);
  assert.equal(result.receipt.publication,'PREVIEW');assert.deepEqual(result.receipt.coverage.gpu,['finite ring arithmetic']);
});
test('xpu run forwards only supported numerical options and explicit CPU mode',async()=>{
  const h=context(['run','mul','3','3','5','32','cpu','bank']);assert.equal(await command.run(h.ctx),0);
  assert.deepEqual(h.calls[0].options,{prime:3,precision:5,operation:'mul',operand:3,steps:32,source:'bank',requireGpu:false});
  assert.equal('gain' in h.calls[0].options,false);assert.equal('neuron' in h.calls[0].options,false);
});
test('xpu finite ring and operand upper boundary is accepted without wrapping',async()=>{
  const h=context(['run','add','65535','2','16','1','gpu','field']);assert.equal(await command.run(h.ctx),0);
  assert.equal(h.calls[0].options.operand,65535);assert.equal(h.calls[0].options.precision,16);
});
test('xpu residue zero and decimal leading zeroes are parsed exactly',async()=>{
  const h=context(['run','negate','00','02','08','01','cpu']);assert.equal(await command.run(h.ctx),0);
  assert.equal(h.calls[0].options.operand,0);assert.equal(h.calls[0].options.steps,1);
});
const invalid = [
  ['info','extra'],['help','extra'],['save'],['save',token,'extra'],['save',''],['save','../state.json'],
  ['save','not-a-token'],['save',token+' '],['apply',token],['export'],['import','/tmp/a'],[''],
  ['run','pow'],['run','ADD'],['run','add',''],['run','add',' '],['run','add','1.0'],['run','add','1e2'],
  ['run','add','0xff'],['run','add','+1'],['run','add','-1'],['run','add','NaN'],['run','add','Infinity'],
  ['run','add','256'],['run','add','9007199254740992'],['run','add','00000000000000001'],
  ['run','add','1','4'],['run','add','1','1'],['run','add','1','65537','1'],
  ['run','add','1','2','0'],['run','add','1','2','17'],['run','add','1','3','11'],
  ['run','add','1','2','8','0'],['run','add','1','2','8','33'],['run','add','1','2','8','1','GPU'],
  ['run','add','1','2','8','1','cpu','disk'],['run','add','1','2','8','1','cpu','field','extra'],
];
test('xpu rejects malformed values, unsupported actions, and surplus operands before contacting host',async()=>{
  for(const args of invalid) {
    const h=context(args);assert.notEqual(await command.run(h.ctx),0,JSON.stringify(args));
    assert.equal(h.calls.length,0,JSON.stringify(args));assert.equal(h.output.length,0);assert.equal(h.errors.length,1);
  }
});
test('xpu rejects every supplied flag before contacting host',async()=>{
  for(const flags of [{force:true},{gpu:true},{operand:'1'},{help:true}]) {
    const h=context(['run'],{flags});assert.notEqual(await command.run(h.ctx),0);assert.equal(h.calls.length,0);
  }
});
test('GPU requirement unmet retains an explicit receipt and returns failure without an automatic save',async()=>{
  const calls=[],result={token,canApply:false,receipt:{status:'GPU_REQUIREMENT_UNMET',publication:'PREVIEW',coverage:{cpu:['phase arithmetic'],gpu:[]}}};
  const h=context(['run'],{host:{async xpuTerminal(action,args){calls.push({action,args});return result;}}});
  assert.equal(await command.run(h.ctx),1);assert.equal(calls.length,1);assert.equal(calls[0].action,'run');
  assert.deepEqual(JSON.parse(h.output.join('')),result);
});
test('xpu save is a distinct apply request containing only the reviewed token',async()=>{
  const h=context(['save',token]);assert.equal(await command.run(h.ctx),0);
  assert.deepEqual(h.calls,[{action:'apply',options:{token},signal:undefined}]);
  assert.equal(JSON.parse(h.output.join('')).receipt.publication,'COMMITTED');
});
test('XPU host failures and failed saves cannot print a success receipt or issue a second action',async()=>{
  for(const args of [['run'],['save',token]]) {
    let count=0;const h=context(args,{host:{async xpuTerminal(){count++;throw new Error('stale preview or GPU failed');}}});
    assert.equal(await command.run(h.ctx),1);assert.equal(count,1);assert.equal(h.output.length,0);assert.match(h.errors.join(''),/stale preview or GPU failed/);
  }
});
test('missing XPU host bridge is an explicit failure without fallback computation',async()=>{
  const h=context(['run'],{host:{}});assert.equal(await command.run(h.ctx),1);assert.match(h.errors.join(''),/bridge is unavailable/);
});
test('already aborted run or save is refused before the host is called',async()=>{
  for(const args of [['run'],['save',token]]) {
    const controller=new AbortController();controller.abort();const h=context(args,{signal:controller.signal});
    assert.equal(await command.run(h.ctx),1);assert.equal(h.calls.length,0);assert.equal(h.output.length,0);
  }
});
test('aborting an awaited preview suppresses its publication and forwards the same signal',async()=>{
  const controller=new AbortController();let forwarded;
  const h=context(['run'],{signal:controller.signal,host:{async xpuTerminal(action,args,signal){forwarded=signal;controller.abort();return {token,canApply:true};}}});
  assert.equal(await command.run(h.ctx),1);assert.equal(forwarded,controller.signal);assert.equal(h.output.length,0);
});
test('an accepted durable save remains reported after a late abort at the host commit boundary',async()=>{
  const controller=new AbortController();const h=context(['save',token],{signal:controller.signal,host:{async xpuTerminal(action,args,signal){assert.equal(signal,controller.signal);controller.abort();return {saved:true,receipt:{publication:'COMMITTED'}};}}});
  assert.equal(await command.run(h.ctx),0);assert.equal(JSON.parse(h.output.join('')).saved,true);
});

async function shell(line,host) {
  const kernel=new SpiralKernel({hostBridge:host});kernel.registry.install(xpuCommands);
  let output='';kernel.on('data',e=>{output+=e.chunk;});
  const {sessionId}=kernel.openSession({deferStart:true});
  try {return {code:await kernel._executeLine(kernel.sessions.get(sessionId),line),output};}
  finally {kernel.closeSession(sessionId);}
}
test('real terminal parser routes a CPU preview to the shared host bridge',async()=>{
  const calls=[];const result=await shell('xpu run complement 0 2 8 2 cpu field',{async xpuTerminal(action,args,signal){
    calls.push({action,args,signal});return {token,canApply:true,receipt:{status:'CPU_VALIDATED',publication:'PREVIEW',coverage:{gpu:[]}}};
  }});
  assert.equal(result.code,0);assert.equal(calls.length,1);assert.equal(calls[0].action,'run');assert.equal(calls[0].args.operation,'complement');
  assert.equal(calls[0].args.requireGpu,false);assert.equal(calls[0].signal instanceof AbortSignal,true);assert.match(result.output,/CPU_VALIDATED/);
});
test('real terminal parser preserves an empty quoted operand and refuses unsupported flags and extra tokens',async()=>{
  for(const line of ['xpu run add ""','xpu run --force','xpu info extra','xpu save '+token+' extra']) {
    let calls=0;const result=await shell(line,{async xpuTerminal(){calls++;return {};}});
    assert.notEqual(result.code,0,line);assert.equal(calls,0,line);
  }
});


const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function workerTerminal(t) {
  const worker=new Worker(new URL('./semisili-worker-adapter.mjs',import.meta.url),{workerData:{records:[],faults:{},gpuFixture:false}});
  const app=[],events=[],controls=[], records=[];let error=null, dead=false, request=0;
  worker.on('error',e=>{error=e;});worker.on('exit',()=>{dead=true;});
  worker.on('message',m=>{
    if(m.kind==='lock')worker.postMessage({kind:'lock-result',id:m.id,result:true});
    else if(m.kind==='app')app.push(m.data);
    else if(m.kind==='fixture-event')events.push(m.event);
    else if(m.kind==='fixture-control')controls.push(m.id);
    else if(m.kind==='commit')records.push(structuredClone(m.records));
  });
  async function until(predicate,label) {
    const start=Date.now();while(Date.now()-start<7000) {
      if(predicate())return;if(error)throw error;if(dead)throw new Error('worker exited before '+label);await delay(2);
    }throw new Error('worker terminal timeout: '+label);
  }
  t.after(()=>worker.terminate());
  await until(()=>app.some(m=>m.type==='ready'||m.type==='error'),'startup');
  const ready=app.find(m=>m.type==='ready'||m.type==='error');assert.equal(ready.type,'ready');
  const {port1,port2}=new MessageChannel(), messages=[];let sid=null,seq=0,consumed=0,text='';
  t.after(()=>port1.close());
  const control=(type,payload={},rid)=>port1.postMessage({v:3,epoch:ready.epoch,sid,type,payload,rid});
  port1.on('message',m=>{
    if(m instanceof Uint8Array||m instanceof ArrayBuffer) {
      const frame=decodeData(m);assert.equal(frame.kind,KIND_OUTPUT);text+=new TextDecoder().decode(frame.payload);consumed+=frame.payload.length;
      control('flow.ack',{consumedBytes:consumed});
    }else{
      messages.push(m);if(m.type==='hello')control('session.open',{cols:80,rows:24});
      else if(m.type==='session.opened'){sid=m.sid;control('session.start');}
    }
  });
  worker.postMessage({kind:'message',data:{type:'attach'},ports:[port2]},[port2]);
  await until(()=>sid!==null&&text.includes('›'),'terminal prompt');
  async function rpc(op,extra={}) {
    const id='xpu-terminal-'+(++request);worker.postMessage({kind:'message',data:{type:'rpc',id,op,...extra}});
    await until(()=>app.some(m=>m.type==='rpc'&&m.id===id),op);
    const reply=app.find(m=>m.type==='rpc'&&m.id===id);if(reply.error)throw new Error(reply.error);return reply.result;
  }
  async function fixture(operation) {
    const id='fixture-'+(++request);worker.postMessage({kind:'control',id,operation});await until(()=>controls.includes(id),operation);
  }
  async function idle() {
    for(let tries=0;tries<100;tries++) {
      const rid='status-'+(++request);control('session.status',{},rid);await until(()=>messages.some(m=>m.rid===rid),'terminal status');
      if(!messages.find(m=>m.rid===rid).payload.busy)return;await delay(5);
    }throw new Error('terminal command did not finish');
  }
  const begin=line=>{const start=text.length;port1.postMessage(encodeData(KIND_INPUT,++seq,new TextEncoder().encode(line+'\r')));return start;};
  async function command(line,needle) {const start=begin(line);await until(()=>text.slice(start).includes(needle),needle);await idle();return text.slice(start);}
  return {rpc,fixture,records,command,begin,idle,until,events,async signal(){control('terminal.signal',{signal:'SIGINT'});const rid='signal-ack-'+(++request);control('session.status',{},rid);await until(()=>messages.some(m=>m.rid===rid),'ordered SIGINT acknowledgement');},read:start=>text.slice(start)};
}

test('production worker terminal previews and explicitly saves the shared resident XPU bank (storage/lock fixtures)',async t=>{
  const h=await workerTerminal(t),before=JSON.stringify(h.records.at(-1)),field=await h.rpc('preview');
  const output=await h.command('xpu run add 1 2 8 1 cpu field','CPU_VALIDATED');assert.match(output,/PREVIEW/);
  const preview=await h.rpc('xpu',{action:'info'});assert.equal(preview.present,false);assert.equal(preview.draft.canApply,true);
  assert.equal(JSON.stringify(h.records.at(-1)),before);assert.deepEqual(await h.rpc('preview'),field);
  const saved=await h.command('xpu save '+preview.draft.token,'COMMITTED');assert.match(saved,/"saved": true/);
  const current=await h.rpc('xpu',{action:'info'});assert.equal(current.present,true);assert.equal(current.draft,null);
  assert.equal(current.savedReceipt.status,'CPU_VALIDATED');assert.equal(current.savedReceipt.historical,false);
  assert.notEqual(JSON.stringify(h.records.at(-1)),before);
  await h.command('xpu run add 1 2 8 1 cpu bank','CPU_VALIDATED');
  assert.equal((await h.rpc('xpu',{action:'info'})).draft.receipt.summary.source,'bank');
});
test('production worker terminal default GPU requirement never publishes when WebGPU is absent',async t=>{
  const h=await workerTerminal(t),before=JSON.stringify(h.records.at(-1)),field=await h.rpc('preview');
  const output=await h.command('xpu run','GPU_REQUIREMENT_UNMET');assert.match(output,/GPU_UNAVAILABLE/);
  const candidate=(await h.rpc('xpu',{action:'info'})).draft;assert.equal(candidate.canApply,false);
  await h.command('xpu save '+candidate.token,'required hardware GPU confirmation');
  assert.equal((await h.rpc('xpu',{action:'info'})).present,false);assert.equal(JSON.stringify(h.records.at(-1)),before);
  assert.deepEqual(await h.rpc('preview'),field);
});
test('production worker terminal SIGINT during validation discards its candidate and retains resident state',async t=>{
  const h=await workerTerminal(t),before=JSON.stringify(h.records.at(-1)),field=await h.rpc('preview');
  await h.fixture('gate-digest');const start=h.begin('xpu run add 1 2 8 1 cpu field');
  await h.until(()=>h.events.includes('digest-paused'),'paused candidate digest');await h.signal();
  await h.fixture('release-gates');await h.idle();
  assert.doesNotMatch(h.read(start),/CPU_VALIDATED|PREVIEW/);
  await h.command('echo $?','130');
  const state=await h.rpc('xpu',{action:'info'});assert.equal(state.present,false);assert.equal(state.draft,null);
  assert.equal(JSON.stringify(h.records.at(-1)),before);assert.deepEqual(await h.rpc('preview'),field);
});
