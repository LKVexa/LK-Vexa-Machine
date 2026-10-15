import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmFiniteGpu,FINITE_GPU_SHADER} from '../src/lib/semisili-gpu.js';
import {gpuFixture} from './gpu-fixture.mjs';

const input=(overrides={})=>({a:Uint32Array.from([0,1,8,16]),b:Uint32Array.from([16,8,1,0]),
  expected:Uint32Array.from([16,9,9,16]),modulus:17,operation:'add',...overrides});
const invoke=(data,fixture,options={})=>confirmFiniteGpu(data,{gpu:fixture.gpu,secureContext:true,...options});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function disposed(fixture,result) {
  assert.equal(result.receipt.resources.buffersCreated,fixture.records.buffers.length);
  assert(fixture.records.buffers.every(buffer=>buffer.destroyCount===1),'each buffer must be disposed once');
  if(fixture.records.deviceCalls && fixture.records.buffers.length)assert.equal(fixture.records.deviceDestroyed,1);
  assert.equal(result.receipt.gpu.hardwareConfirmed,false,'fixtures must never certify hardware');
}

test('every finite operation agrees across canonical residues and uint32 boundaries',async t=>{
  for(const modulus of [2,3,9,16,257,65536])for(const operation of ['add','sub','mul','negate','complement'])await t.test(modulus+' '+operation,async()=>{
    const a=Uint32Array.from({length:256},(_,i)=>i%modulus);
    const b=Uint32Array.from(a,(_,i)=>(modulus-1-i%modulus));
    const m=BigInt(modulus);
    const expected=Uint32Array.from(a,(value,i)=>{
      const left=BigInt(value),right=BigInt(b[i]);
      const answer={add:left+right,sub:left-right,mul:left*right,negate:-left,complement:m-1n-left}[operation];
      return Number((answer%m+m)%m);
    });
    const fixture=gpuFixture(),result=await invoke({a,b,modulus,operation,expected},fixture);
    assert.equal(result.receipt.status,'FIXTURE_MATCH');assert.deepEqual(result.result,expected);
    assert.equal(result.receipt.comparison.elements,256);assert.equal(result.receipt.comparison.mismatches,0);
    assert.equal(result.receipt.gpu.apiConfirmed,false);disposed(fixture,result);
  });
});

test('highest uint32-safe product and negative residue use the expected finite semantics',async()=>{
  const cases=[['mul',[65535],[65535],[1]],['add',[65535],[65535],[65534]],['sub',[0],[65535],[1]],
    ['negate',[65535],undefined,[1]],['complement',[65535],undefined,[0]]];
  for(const [operation,left,right,want] of cases) {
    const fixture=gpuFixture();const result=await invoke({a:Uint32Array.from(left),b:right && Uint32Array.from(right),
      expected:Uint32Array.from(want),modulus:65536,operation},fixture);
    assert.deepEqual(result.result,Uint32Array.from(want));disposed(fixture,result);
  }
});

test('binary negation is identity while digit complement flips the bit',async()=>{
  for(const [operation,want] of [['negate',[0,1]],['complement',[1,0]]]) {
    const fixture=gpuFixture(), result=await invoke({a:Uint32Array.from([0,1]),expected:Uint32Array.from(want),modulus:2,operation},fixture);
    assert.deepEqual(result.result,Uint32Array.from(want));disposed(fixture,result);
  }
});

test('4096 samples and a partial final workgroup preserve every residue',async()=>{
  for(const length of [1,65,4096]) {
    const a=Uint32Array.from({length},(_,i)=>i%257), b=new Uint32Array(length).fill(256);
    const expected=Uint32Array.from(a,x=>(x+256)%257),fixture=gpuFixture();
    const result=await invoke({a,b,expected,modulus:257,operation:'add'},fixture);
    assert.deepEqual(result.result,expected);assert.equal(result.receipt.coverage.samples,length);disposed(fixture,result);
  }
});

test('invalid shape, residue, operation and arithmetic bounds never request a GPU',async()=>{
  const malformed=[input({a:new Uint8Array(4)}),input({expected:new Uint32Array(3)}),input({a:new Uint32Array(0),expected:new Uint32Array(0),b:new Uint32Array(0)}),
    input({a:new Uint32Array(4097),b:new Uint32Array(4097),expected:new Uint32Array(4097)}),input({a:Uint32Array.from([17,1,8,16])}),
    input({b:Uint32Array.from([16,17,1,0])}),input({expected:Uint32Array.from([16,9,17,16])}),input({operation:'execute-shader'}),
    input({modulus:65537}),input({modulus:1}),input({modulus:NaN}),input({b:undefined})];
  for(const data of malformed){const fixture=gpuFixture();await assert.rejects(invoke(data,fixture),/Uint32Array|length|residue|operation|modulus|requires b/);assert.equal(fixture.records.adapterCalls,0);}
});

test('invalid timeout and signal are rejected before hardware discovery',async()=>{
  for(const timeoutMs of [0,12001,NaN,.5]){const fixture=gpuFixture();await assert.rejects(invoke(input(),fixture,{timeoutMs}),/timeout/);assert.equal(fixture.records.adapterCalls,0);}
  const fixture=gpuFixture();await assert.rejects(invoke(input(),fixture,{signal:{aborted:false}}),/AbortSignal/);
});

test('unsupported API, insecure context, null adapter and request failures report no comparison',async()=>{
  const none=await confirmFiniteGpu(input(),{gpu:null,secureContext:true});assert.equal(none.receipt.status,'GPU_UNAVAILABLE');assert.equal(none.receipt.gpu.state,'NO_WEBGPU_API');assert.equal(none.result,null);
  const insecure=gpuFixture(), blocked=await invoke(input(),insecure,{secureContext:false});assert.equal(blocked.receipt.gpu.state,'INSECURE_CONTEXT');assert.equal(insecure.records.adapterCalls,0);
  for(const configuration of [{noAdapter:true},{adapterError:new Error('adapter denied')},{deviceError:new Error('device denied')}]) {
    const fixture=gpuFixture(configuration),result=await invoke(input(),fixture);
    assert.equal(result.result,null);assert.equal(result.receipt.comparison.status,'NOT_RUN');
    assert.match(result.receipt.status,/GPU_NO_ADAPTER|GPU_REQUEST_FAILED/);assert.equal(result.receipt.gpu.hardwareConfirmed,false);
  }
});

test('fallback and unknown adapter identity cannot become hardware proof',async()=>{
  for(const [configuration,want] of [[{fallback:true},true],[{unknownFallback:true},null],[{legacyFallback:false},false],[{infoThrows:true},null]]) {
    const fixture=gpuFixture(configuration),result=await invoke(input(),fixture,{fixture:false});
    assert.equal(result.receipt.status,'FIXTURE_MATCH');assert.equal(result.receipt.fixture,true);
    assert.equal(result.receipt.gpu.fallback,want);assert.equal(result.receipt.gpu.hardwareConfirmed,false);disposed(fixture,result);
  }
});

test('insufficient or unknown adapter limits fail before device creation',async()=>{
  for(const limits of [{maxBufferSize:8},{maxStorageBufferBindingSize:null},{maxComputeInvocationsPerWorkgroup:32}]) {
    const fixture=gpuFixture({limits}),result=await invoke(input(),fixture);
    assert.equal(result.receipt.status,'GPU_UNSUPPORTED_LIMITS');assert.equal(fixture.records.deviceCalls,0);assert.equal(result.result,null);
  }
});

test('shader, allocation, scoped OOM and uncaptured errors destroy every owned resource',async()=>{
  const cases=[
    [{shaderErrors:[{type:'error',message:'bad shader',lineNum:1,linePos:2}]},'GPU_SHADER_ERROR'],
    [{pipelineError:new Error('compile refused')},'GPU_SHADER_ERROR'],
    [{failBufferAt:3},'GPU_OUT_OF_MEMORY'],
    [{failBufferAt:2,allocationError:{name:'GPUValidationError',message:'allocation invalid'}},'GPU_VALIDATION_ERROR'],
    [{scopedErrors:[{name:'GPUOutOfMemoryError',message:'GPU OOM'},null]},'GPU_OUT_OF_MEMORY'],
    [{uncapturedError:{name:'GPUValidationError',message:'GPU event error'}},'GPU_VALIDATION_ERROR'],
  ];
  for(const [configuration,status] of cases){const fixture=gpuFixture(configuration),result=await invoke(input(),fixture);
    assert.equal(result.receipt.status,status);assert.equal(result.result,null);disposed(fixture,result);}
});

test('readback rejection, malformed range and submit failure never expose a result',async()=>{
  for(const [configuration,status] of [[{mapError:new Error('map refused')},'GPU_READBACK_ERROR'],[{badMappedRange:true},'GPU_READBACK_ERROR'],[{submitError:new Error('submit refused')},'GPU_EXECUTION_ERROR']]) {
    const fixture=gpuFixture(configuration),result=await invoke(input(),fixture);
    assert.equal(result.receipt.status,status);assert.equal(result.result,null);disposed(fixture,result);
  }
});

test('every mismatch is counted and diagnostics stay bounded',async()=>{
  const fixture=gpuFixture({corruptIndex:2}),result=await invoke(input(),fixture);
  assert.equal(result.receipt.status,'GPU_MISMATCH');assert.equal(result.result,null);
  assert.deepEqual(result.receipt.comparison,{status:'FAIL',elements:4,mismatches:1,firstMismatches:[{index:2,expected:9,actual:10}]});disposed(fixture,result);
  const many=gpuFixture(),result2=await invoke(input({a:new Uint32Array(64).fill(1),b:new Uint32Array(64).fill(1),expected:new Uint32Array(64)}),many);
  assert.equal(result2.receipt.comparison.mismatches,64);assert.equal(result2.receipt.comparison.firstMismatches.length,8);disposed(many,result2);
});

test('caller mutation while requestDevice waits does not change input, oracle or returned ownership',async()=>{
  const fixture=gpuFixture({deviceGate:true});const data=input({a:Uint32Array.from([3,5]),b:Uint32Array.from([4,6]),expected:Uint32Array.from([12,13]),operation:'mul'});
  const promise=invoke(data,fixture);await fixture.deviceRequested;
  data.a.fill(0);data.b.fill(0);data.expected.fill(0);fixture.releaseDevice();const result=await promise;
  assert.deepEqual(result.result,Uint32Array.from([12,13]));result.result[0]=99;
  const readback=fixture.records.buffers.find(b=>b.descriptor.label==='JA21 finite readback');
  assert.deepEqual(new Uint32Array(readback.data),Uint32Array.from([12,13]));assert.equal(Object.isFrozen(result.receipt),true);disposed(fixture,result);
});

test('device loss interrupts a pending map and releases resources',async()=>{
  const fixture=gpuFixture({loseDuringMap:true}),result=await invoke(input(),fixture);
  assert.equal(result.receipt.status,'GPU_DEVICE_LOST');assert.equal(result.result,null);disposed(fixture,result);
});

test('typed-array subclass copy hooks cannot alias or replace owned input',async()=>{
  class HostileArray extends Uint32Array { slice(){throw new Error('caller copy hook must not execute');} }
  const fixture=gpuFixture({deviceGate:true});
  const data=input({a:new HostileArray([3,5]),b:new HostileArray([4,6]),expected:new HostileArray([12,13]),operation:'mul'});
  const promise=invoke(data,fixture);await fixture.deviceRequested;
  data.a.fill(0);data.b.fill(0);data.expected.fill(0);fixture.releaseDevice();const result=await promise;
  assert.deepEqual(result.result,Uint32Array.from([12,13]));disposed(fixture,result);
});

test('already aborted and mid-map abort never publish late output',async()=>{
  const first=new AbortController();first.abort();const never=gpuFixture(),early=await invoke(input(),never,{signal:first.signal});
  assert.equal(early.receipt.status,'GPU_CANCELLED');assert.equal(never.records.adapterCalls,0);
  const controller=new AbortController(),fixture=gpuFixture({mapGate:true});
  const promise=invoke(input(),fixture,{signal:controller.signal});await fixture.mapStarted;controller.abort();const result=await promise;
  assert.equal(result.receipt.status,'GPU_CANCELLED');assert.equal(result.result,null);disposed(fixture,result);
  const snapshot=JSON.stringify(result.receipt);fixture.releaseMap();await tick();await tick();
  assert.equal(JSON.stringify(result.receipt),snapshot);assert(fixture.records.buffers.every(b=>!b.mapped));
});

test('timeout bounds discovery and destroys devices arriving after return',async()=>{
  const blocked=gpuFixture({neverAdapter:true}),timeout=await invoke(input(),blocked,{timeoutMs:50});
  assert.equal(timeout.receipt.status,'GPU_TIMEOUT');assert.equal(timeout.result,null);
  const fixture=gpuFixture({deviceGate:true}),promise=invoke(input(),fixture,{timeoutMs:50});await fixture.deviceRequested;
  const result=await promise;assert.equal(result.receipt.status,'GPU_TIMEOUT');assert.equal(result.receipt.resources.lateDeviceCleanupPending,true);
  const snapshot=JSON.stringify(result.receipt);fixture.releaseDevice();await tick();await tick();
  assert.equal(fixture.records.deviceDestroyed,1);assert.equal(fixture.records.buffers.length,0);assert.equal(JSON.stringify(result.receipt),snapshot);
});

test('cleanup failures and cancellation during cleanup suppress confirmation',async()=>{
  const fixture=gpuFixture({destroyBufferThrows:true}),result=await invoke(input(),fixture);
  assert.equal(result.receipt.status,'GPU_CLEANUP_ERROR');assert.equal(result.result,null);assert.equal(result.receipt.resources.cleanupErrors.length,1);
  const controller=new AbortController(),aborting=gpuFixture({abortOnDestroy:()=>controller.abort()});
  const cancelled=await invoke(input(),aborting,{signal:controller.signal});
  assert.equal(cancelled.receipt.status,'GPU_CANCELLED');assert.equal(cancelled.result,null);disposed(aborting,cancelled);
});

test('only the packaged literal shader is dispatched, regardless of extra input data',async()=>{
  const fixture=gpuFixture();const result=await invoke({...input(),shader:'arbitrary injected code'},fixture);
  assert.equal(fixture.records.shaderCode,FINITE_GPU_SHADER);assert(!fixture.records.shaderCode.includes('arbitrary injected code'));
  assert.equal(result.receipt.coverage.stage,'finite-arithmetic');assert.equal(result.receipt.timing.gpuTimestampMs,null);disposed(fixture,result);
});
