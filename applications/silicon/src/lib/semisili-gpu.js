/**
 * Exact finite-residue confirmation on a separately dispatched WebGPU kernel.
 * Phase evolution, hologram readout and RAM neurons remain CPU operations.
 * Test overrides are always marked fixtures and can never confirm hardware.
 */
const OPERATIONS = Object.freeze({add:0,sub:1,mul:2,negate:3,complement:4});
const LIMIT_NAMES = Object.freeze([
  'maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupSizeX',
  'maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupsPerDimension',
  'maxStorageBuffersPerShaderStage','maxUniformBuffersPerShaderStage',
]);
const USAGE = Object.freeze({MAP_READ:1,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128});
const MAX_SAMPLES=4096, DEFAULT_TIMEOUT_MS=8000, MAX_TIMEOUT_MS=12000;
let sequence=0;

export const FINITE_GPU_SHADER = [
  'struct Parameters { modulus: u32, operation: u32, count: u32, padding: u32, }',
  '@group(0) @binding(0) var<storage, read> a: array<u32>;',
  '@group(0) @binding(1) var<storage, read> b: array<u32>;',
  '@group(0) @binding(2) var<storage, read_write> output: array<u32>;',
  '@group(0) @binding(3) var<uniform> parameters: Parameters;',
  '@compute @workgroup_size(64)',
  'fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {',
  '  let i = invocation.x;',
  '  if (i >= parameters.count) { return; }',
  '  let m = parameters.modulus;',
  '  let left = a[i];',
  '  let right = b[i];',
  '  switch parameters.operation {',
  '    case 0u: { output[i] = (left + right) % m; }',
  '    case 1u: { output[i] = (left + m - right) % m; }',
  '    case 2u: { output[i] = (left * right) % m; }',
  '    case 3u: {',
  '      if (left == 0u) { output[i] = 0u; }',
  '      else { output[i] = m - left; }',
  '    }',
  '    case 4u: { output[i] = m - 1u - left; }',
  '    default: { output[i] = 0u; }',
  '  }',
  '}',
].join('\n');

class GpuFault extends Error {
  constructor(code,message,details) { super(message);this.name='GpuFault';this.code=code;this.details=details; }
}
const fault=(code,message,details)=>new GpuFault(code,message,details);
const text=value=>String(value ?? '').slice(0,512);
const now=()=>globalThis.performance?.now?.() ?? Date.now();
function freeze(value) {
  if(value && typeof value==='object') {
    for(const item of Object.values(value))freeze(item);
    Object.freeze(value);
  }
  return value;
}
function checkedInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input))throw new TypeError('finite GPU input must be an object');
  const {a,b,modulus,operation,expected}=input;
  if(!Number.isSafeInteger(modulus) || modulus<2 || modulus>65536)throw new RangeError('modulus must be an integer in 2..65536');
  if(!Object.hasOwn(OPERATIONS,operation))throw new RangeError('unsupported finite operation');
  if(!(a instanceof Uint32Array) || !(expected instanceof Uint32Array))throw new TypeError('a and expected must be Uint32Array');
  if(a.length<1 || a.length>MAX_SAMPLES || expected.length!==a.length)throw new RangeError('finite vector length must be 1..4096 with matching expected length');
  const unary=operation==='negate' || operation==='complement';
  if(b===undefined && !unary)throw new TypeError('binary operation requires b');
  if(b!==undefined && (!(b instanceof Uint32Array) || b.length!==a.length))throw new TypeError('b must be a matching Uint32Array');
  const owned={a:new Uint32Array(a),b:b===undefined?new Uint32Array(a.length):new Uint32Array(b),expected:new Uint32Array(expected),modulus,operation};
  for(const [name,array] of Object.entries(owned))if(array instanceof Uint32Array) {
    for(let i=0;i<array.length;i++)if(array[i]>=modulus)throw new RangeError(name+' contains a noncanonical residue at '+i);
  }
  return owned;
}
function classify(error,stage) {
  if(error instanceof GpuFault)return error;
  const name=String(error?.name || '')+' '+String(error?.constructor?.name || '');
  if(name.includes('OutOfMemory'))return fault('GPU_OUT_OF_MEMORY',text(error?.message || name));
  if(name.includes('Validation'))return fault(stage==='shader'?'GPU_SHADER_ERROR':'GPU_VALIDATION_ERROR',text(error?.message || name));
  const code=stage==='adapter' || stage==='device'?'GPU_REQUEST_FAILED':
    stage==='shader'?'GPU_SHADER_ERROR':stage==='readback'?'GPU_READBACK_ERROR':'GPU_EXECUTION_ERROR';
  return fault(code,text(error?.message || error || 'GPU operation failed'));
}
function adapterInfo(adapter) {
  let info;try{info=adapter.info;}catch{info=null;}
  let fallback=null;
  try {
    if(typeof info?.isFallbackAdapter==='boolean')fallback=info.isFallbackAdapter;
    else if(typeof adapter.isFallbackAdapter==='boolean')fallback=adapter.isFallbackAdapter;
  }catch{fallback=null;}
  const metadata={};
  for(const name of ['vendor','architecture','device','description']) {
    try { metadata[name]=typeof info?.[name]==='string'?text(info[name]):''; }catch{metadata[name]='';}
  }
  return {fallback,metadata};
}
function checkLimits(adapter,bytes,count) {
  const requirements={maxBufferSize:Math.max(bytes,16),maxStorageBufferBindingSize:bytes,
    maxComputeWorkgroupSizeX:64,maxComputeInvocationsPerWorkgroup:64,
    maxComputeWorkgroupsPerDimension:Math.ceil(count/64),maxStorageBuffersPerShaderStage:3,maxUniformBuffersPerShaderStage:1};
  const snapshot={};
  for(const key of LIMIT_NAMES) {
    const value=adapter.limits?.[key];
    snapshot[key]=Number.isSafeInteger(value)?value:null;
    if(snapshot[key]===null || snapshot[key]<requirements[key])throw fault('GPU_UNSUPPORTED_LIMITS','GPU limit is insufficient or unknown: '+key,
      {limit:key,required:requirements[key],available:snapshot[key]});
  }
  return snapshot;
}
function cleanup(context) {
  context.closed=true;
  for(const buffer of context.buffers) {
    if(context.mapped.has(buffer)) {
      try{buffer.unmap();}catch(error){context.cleanupErrors.push(text(error));}
      context.mapped.delete(buffer);
    }
    context.destroyAttempts++;
    try{buffer.destroy();context.destroyed++;}catch(error){context.cleanupErrors.push(text(error));}
  }
  if(context.device) {
    try{context.device.removeEventListener?.('uncapturederror',context.onGpuError);}catch(error){context.cleanupErrors.push(text(error));}
    while(context.scopes>0) {
      context.scopes--;
      try{Promise.resolve(context.device.popErrorScope()).catch(()=>{});}catch(error){context.cleanupErrors.push(text(error));}
    }
    try{context.device.destroy();context.deviceDestroyed=true;}catch(error){context.cleanupErrors.push(text(error));}
  }
}
async function execute(context,input,gpu,receipt) {
  const check=()=>context.check();
  context.stage='adapter';
  const adapter=await gpu.requestAdapter({powerPreference:'low-power',forceFallbackAdapter:false});
  check();
  if(!adapter)throw fault('GPU_NO_ADAPTER','WebGPU did not return an adapter');
  const info=adapterInfo(adapter);
  receipt.gpu.fallback=info.fallback;receipt.gpu.adapter=info.metadata;
  receipt.gpu.limits=checkLimits(adapter,input.a.byteLength,input.a.length);
  receipt.gpu.features=[];
  try{receipt.gpu.features=[...adapter.features].filter(x=>typeof x==='string').slice(0,64);}catch{}
  context.stage='device';context.pendingDevice=true;
  let device;
  try{device=await adapter.requestDevice();}finally{context.pendingDevice=false;}
  // A device delivered after cancellation/timeout is immediately disposed.
  if(context.closed || context.stopped) {
    try{device?.destroy();}catch{}
    check();
  }
  if(!device)throw fault('GPU_REQUEST_FAILED','WebGPU returned no device');
  context.device=device;
  context.onGpuError=event=>context.stop(classify(event?.error,'execution'));
  device.addEventListener?.('uncapturederror',context.onGpuError);
  if(!device.lost || typeof device.lost.then!=='function')throw fault('GPU_REQUEST_FAILED','GPU device loss notification is unavailable');
  device.lost.then(info=>{
    if(!context.closed)context.stop(fault('GPU_DEVICE_LOST',text(info?.message || 'GPU device was lost'),{reason:text(info?.reason)}));
  },error=>{if(!context.closed)context.stop(classify(error,'device'));});
  check();
  context.stage='allocation';
  device.pushErrorScope('validation');context.scopes++;
  device.pushErrorScope('out-of-memory');context.scopes++;
  const make=descriptor=>{check();const buffer=device.createBuffer(descriptor);context.buffers.push(buffer);return buffer;};
  const bytes=input.a.byteLength;
  const a=make({label:'JA21 finite a',size:bytes,usage:USAGE.STORAGE|USAGE.COPY_DST});
  const b=make({label:'JA21 finite b',size:bytes,usage:USAGE.STORAGE|USAGE.COPY_DST});
  const output=make({label:'JA21 finite output',size:bytes,usage:USAGE.STORAGE|USAGE.COPY_SRC});
  const parameters=make({label:'JA21 finite parameters',size:16,usage:USAGE.UNIFORM|USAGE.COPY_DST});
  const readback=make({label:'JA21 finite readback',size:bytes,usage:USAGE.MAP_READ|USAGE.COPY_DST});
  device.queue.writeBuffer(a,0,input.a);
  device.queue.writeBuffer(b,0,input.b);
  device.queue.writeBuffer(parameters,0,new Uint32Array([input.modulus,OPERATIONS[input.operation],input.a.length,0]));
  context.stage='shader';
  const shader=device.createShaderModule({label:'JA21 finite confirmation',code:FINITE_GPU_SHADER});
  if(typeof shader.getCompilationInfo==='function') {
    const compilation=await shader.getCompilationInfo();check();
    const errors=(compilation?.messages || []).filter(m=>m.type==='error').slice(0,8).map(m=>({
      message:text(m.message),line:Number.isSafeInteger(m.lineNum)?m.lineNum:null,
      position:Number.isSafeInteger(m.linePos)?m.linePos:null}));
    if(errors.length)throw fault('GPU_SHADER_ERROR','Finite shader compilation failed',{messages:errors});
  }
  const descriptor={label:'JA21 finite confirmation',layout:'auto',compute:{module:shader,entryPoint:'main'}};
  const pipeline=typeof device.createComputePipelineAsync==='function'?await device.createComputePipelineAsync(descriptor):device.createComputePipeline(descriptor);
  check();
  const bindings=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:a}},{binding:1,resource:{buffer:b}},
    {binding:2,resource:{buffer:output}},{binding:3,resource:{buffer:parameters}},
  ]});
  context.stage='submit';
  const commands=device.createCommandEncoder({label:'JA21 finite confirmation'});
  const pass=commands.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bindings);
  pass.dispatchWorkgroups(Math.ceil(input.a.length/64));pass.end();
  commands.copyBufferToBuffer(output,0,readback,0,bytes);
  check();
  const submitAt=now();
  device.queue.submit([commands.finish()]);context.submitted=true;
  context.stage='readback';
  await readback.mapAsync(1,0,bytes);
  if(context.closed || context.stopped) { try{readback.unmap();}catch{} check(); }
  context.mapped.add(readback);check();
  const mapped=readback.getMappedRange(0,bytes);
  if(!(mapped instanceof ArrayBuffer) || mapped.byteLength!==bytes)throw fault('GPU_READBACK_ERROR','GPU returned a malformed readback range');
  const result=new Uint32Array(new Uint32Array(mapped));
  context.readbackCompleted=true;receipt.timing.submitToReadbackMs=now()-submitAt;
  readback.unmap();context.mapped.delete(readback);
  context.stage='scope-validation';
  const scopeErrors=[];
  while(context.scopes>0) {
    context.scopes--;
    const error=await device.popErrorScope();check();
    if(error)scopeErrors.push(classify(error,'execution'));
  }
  if(scopeErrors.length)throw scopeErrors.find(e=>e.code==='GPU_OUT_OF_MEMORY') || scopeErrors[0];
  context.stage='comparison';
  let mismatches=0;const first=[];
  for(let i=0;i<result.length;i++)if(result[i]!==input.expected[i]) {
    mismatches++;if(first.length<8)first.push({index:i,expected:input.expected[i],actual:result[i]});
  }
  receipt.comparison={status:mismatches?'FAIL':'PASS',elements:result.length,mismatches,firstMismatches:first};
  check();
  if(mismatches)throw fault('GPU_MISMATCH','GPU arithmetic does not match the canonical CPU readout',{mismatches});
  return result;
}

/**
 * options.gpu / options.secureContext are explicit test injection points.
 * Supplying either, or useOverrides/fixture, always suppresses hardware proof.
 * Every device/buffer belongs to this invocation and is disposed on exit.
 */
export async function confirmFiniteGpu(input,options={}) {
  const data=checkedInput(input);
  if(!options || typeof options!=='object' || Array.isArray(options))throw new TypeError('GPU options must be an object');
  const timeoutMs=options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if(!Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>MAX_TIMEOUT_MS)throw new RangeError('GPU timeout must be an integer in 1..12000 ms');
  const signal=options.signal;
  if(signal && (typeof signal.aborted!=='boolean' || typeof signal.addEventListener!=='function' || typeof signal.removeEventListener!=='function'))throw new TypeError('GPU signal must be an AbortSignal');
  const fixture=Object.hasOwn(options,'gpu') || Object.hasOwn(options,'secureContext') || options.useOverrides===true || options.fixture===true;
  const gpu=Object.hasOwn(options,'gpu')?options.gpu:globalThis.navigator?.gpu;
  const secure=Object.hasOwn(options,'secureContext')?options.secureContext===true:globalThis.isSecureContext===true;
  const start=now(),deadline=start+timeoutMs;
  const receipt={schema:'JA21-FINITE-GPU-CONFIRMATION/1',
    runId:globalThis.crypto?.randomUUID?.() || 'gpu-'+Date.now()+'-'+(++sequence),
    status:'NOT_RUN',fixture,coverage:{stage:'finite-arithmetic',operation:data.operation,modulus:data.modulus,
      samples:data.a.length,dtype:'uint32 canonical residues',workgroupSize:64},
    gpu:{state:'NOT_RUN',fallback:null,adapter:null,limits:null,features:[],apiConfirmed:false,hardwareConfirmed:false},
    comparison:{status:'NOT_RUN',elements:0,mismatches:null,firstMismatches:[]},
    timing:{wallMs:0,submitToReadbackMs:null,gpuTimestampMs:null},
    resources:{buffersCreated:0,bufferDestroyAttempts:0,buffersDestroyed:0,deviceDestroyed:false,
      lateDeviceCleanupPending:false,cleanupErrors:[]},error:null};
  const finish=(result=null)=>{receipt.timing.wallMs=now()-start;return {receipt:freeze(receipt),result};};
  if(signal?.aborted) {
    receipt.status='GPU_CANCELLED';receipt.gpu.state='CANCELLED';receipt.error={code:'GPU_CANCELLED',message:'GPU confirmation was cancelled before startup',stage:'startup'};return finish();
  }
  if(!gpu || typeof gpu.requestAdapter!=='function') {
    receipt.status='GPU_UNAVAILABLE';receipt.gpu.state='NO_WEBGPU_API';return finish();
  }
  if(!secure) {
    receipt.status='GPU_UNAVAILABLE';receipt.gpu.state='INSECURE_CONTEXT';return finish();
  }
  let interrupt;
  const interrupted=new Promise(resolve=>{interrupt=resolve;});
  const context={stage:'startup',device:null,buffers:[],mapped:new Set(),scopes:0,closed:false,stopped:null,
    submitted:false,readbackCompleted:false,pendingDevice:false,cleanupErrors:[],destroyed:0,destroyAttempts:0,deviceDestroyed:false,
    stop(error){if(!this.closed && !this.stopped){this.stopped=error;interrupt({error});}},
    check(){
      if(this.stopped)throw this.stopped;
      if(this.closed)throw fault('GPU_CANCELLED','GPU invocation is closed');
      if(signal?.aborted)throw fault('GPU_CANCELLED','GPU confirmation was cancelled');
      if(now()>=deadline)throw fault('GPU_TIMEOUT','GPU confirmation deadline expired');
    }};
  const onAbort=()=>context.stop(fault('GPU_CANCELLED','GPU confirmation was cancelled'));
  signal?.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>context.stop(fault('GPU_TIMEOUT','GPU confirmation deadline expired')),timeoutMs);
  let result=null,problem=null;
  try {
    context.check();
    const work=execute(context,data,gpu,receipt).then(value=>({value}),error=>({error:classify(error,context.stage)}));
    const completed=await Promise.race([work,interrupted]);
    if(completed.error)throw completed.error;
    context.check();result=completed.value;
  }catch(error){problem=classify(error,context.stage);}
  finally {
    clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
    const pendingDevice=context.pendingDevice;cleanup(context);
    receipt.resources={buffersCreated:context.buffers.length,bufferDestroyAttempts:context.destroyAttempts,
      buffersDestroyed:context.destroyed,deviceDestroyed:context.deviceDestroyed,lateDeviceCleanupPending:pendingDevice,
      cleanupErrors:[...context.cleanupErrors]};
  }
  if(context.cleanupErrors.length && !problem)problem=fault('GPU_CLEANUP_ERROR','GPU resources could not all be disposed');
  if(!problem && signal?.aborted)problem=fault('GPU_CANCELLED','GPU confirmation was cancelled before return');
  if(!problem && now()>=deadline)problem=fault('GPU_TIMEOUT','GPU confirmation deadline expired before return');
  if(problem) {
    receipt.status=problem.code;receipt.gpu.state=problem.code;
    receipt.error={code:problem.code,message:text(problem.message),stage:context.stage,
      ...(problem.details?{details:problem.details}:{})};
    return finish();
  }
  receipt.gpu.apiConfirmed=!fixture;
  receipt.gpu.hardwareConfirmed=!fixture && receipt.gpu.fallback===false && context.submitted && context.readbackCompleted;
  receipt.status=fixture?'FIXTURE_MATCH':receipt.gpu.hardwareConfirmed?'GPU_CONFIRMED':
    receipt.gpu.fallback===true?'GPU_FALLBACK_MATCH':'GPU_MATCH_ADAPTER_UNKNOWN';
  receipt.gpu.state=receipt.status;
  return finish(result);
}
