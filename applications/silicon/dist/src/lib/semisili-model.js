import { createRing, sampleIntensity, runPhaseBatch, neuronStep, coupleNeuronCarriers, decodeCarrier, packBitPlanes } from './semisili-core.js';
import { NEURON_PROFILE, encodeState, decodeState, encodePixel160Tiff, decodePixel160Tiff } from './semisili-codec.js';

export const STATE_PATH='/var/xpu/state.json';
export const RECEIPT_PATH='/var/xpu/receipt.json';
export const SHAPE=Object.freeze([4,4,4,8,8]);
const COUNT=4096, OPS=['add','sub','mul','negate','complement'];
const bits=new DataView(new ArrayBuffer(4));
function floatBits(x){bits.setFloat32(0,x,false);return bits.getUint32(0,false);}
function bitsFloat(x){bits.setUint32(0,x,false);return bits.getFloat32(0,false);}
function int(x,min,max,name){if(!Number.isSafeInteger(x)||x<min||x>max)throw new RangeError(`${name} out of range`);return x;}
function sameRecord(a,b) {
  if(!a||typeof a!=='object'||Array.isArray(a))return false;
  const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
  return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&(b[k]&&typeof b[k]==='object'?sameRecord(a[k],b[k]):a[k]===b[k]));
}
function addressLevel(prime) {
  let level=0,modulus=1;
  while(level<6&&Number.isSafeInteger(modulus*prime)){modulus*=prime;level++;}
  return level;
}
function sameSnapshot(a,b) {
  return a&&b&&a.sequence===b.sequence&&a.simulationTime===b.simulationTime&&
    a.words instanceof Uint32Array&&b.words instanceof Uint32Array&&a.words.length===COUNT*5&&b.words.length===COUNT*5&&
    a.words.every((word,i)=>word===b.words[i]);
}
export function configuration(args={}) {
  if(!args||typeof args!=='object'||Array.isArray(args))throw new TypeError('XPU options required');
  const keys=['prime','precision','operation','operand','steps','source','requireGpu'];
  if(Object.keys(args).some(k=>!keys.includes(k)))throw new Error('unsupported XPU option');
  const ring=createRing({prime:args.prime??2,precision:args.precision??8});
  const operation=args.operation??'add', source=args.source??'field';
  if(!OPS.includes(operation)||!['field','bank'].includes(source))throw new Error('unsupported XPU operation or source');
  if(args.requireGpu!==undefined&&typeof args.requireGpu!=='boolean')throw new TypeError('GPU requirement must be boolean');
  return Object.freeze({prime:ring.prime,precision:ring.precision,operation,
    operand:int(args.operand??1,0,ring.modulus-1,'operand'),steps:int(args.steps??4,1,32,'neuron steps'),source,
    requireGpu:args.requireGpu??true,gain:0.5,neuron:{prime:ring.prime,level:addressLevel(ring.prime),dt:0.25,leak:1,reaction:1.5,coupling:0.25,drive:0.5,bias:0,stateLimit:4}});
}
function checkConfig(c) {
  if(!c||typeof c!=='object'||Array.isArray(c))throw new Error('invalid neuron configuration');
  const actual=configuration(Object.fromEntries(['prime','precision','operation','operand','steps','source','requireGpu'].map(k=>[k,c[k]])));
  if(!sameRecord(c,actual))throw new Error('unsupported neuron configuration');
  return actual;
}
/** Validate the declared numerical profile, not just its exact u32 storage. */
export function validateModel(state) {
  if(!state||typeof state!=='object'||Array.isArray(state)||state.profile!==NEURON_PROFILE||JSON.stringify(state.shape)!==JSON.stringify(SHAPE))throw new Error('unsupported neuron field profile');
  if(!Array.isArray(state.frames)||state.frames.length>8||!state.current||typeof state.current!=='object')throw new Error('invalid bounded neuron history');
  const config=checkConfig(state.config),ring=createRing(config);
  let previousSequence=-1,previousTime=-1;
  const timeline=[...state.frames];
  if(timeline.at(-1)?.sequence===state.current.sequence) {
    if(!sameSnapshot(timeline.at(-1),state.current))throw new Error('current and cached history snapshot disagree');
    timeline.pop();
  }
  for(const frame of [...timeline,state.current]) {
    if(!frame||typeof frame!=='object'||Array.isArray(frame))throw new Error('invalid neuron frame');
    int(frame.sequence,0,Number.MAX_SAFE_INTEGER,'frame sequence');
    if(typeof frame.simulationTime!=='number'||!Number.isFinite(frame.simulationTime)||frame.simulationTime<0||!Number.isSafeInteger(frame.simulationTime/config.neuron.dt))throw new Error('invalid neuron simulation time');
    if(frame.sequence<=previousSequence||frame.simulationTime<=previousTime)throw new Error('nonmonotone neuron history');
    previousSequence=frame.sequence;previousTime=frame.simulationTime;
  }
  for(const frame of [state.current,...state.frames]) {
    if(!(frame.words instanceof Uint32Array)||frame.words.length!==COUNT*5)throw new Error('invalid neuron word shape');
    for(let i=0;i<COUNT;i++) {
      const offset=i*5,r=frame.words[offset],activation=bitsFloat(frame.words[offset+1]),amplitude=bitsFloat(frame.words[offset+2]);
      const real=bitsFloat(frame.words[offset+3]),imaginary=bitsFloat(frame.words[offset+4]);
      if(r>=ring.modulus||![activation,amplitude,real,imaginary].every(Number.isFinite)||Math.abs(activation)>4||amplitude<=0||amplitude>1.5)throw new Error('invalid neuron sample');
      const expected=Math.fround(1+config.gain*Math.max(-1,Math.min(1,activation)));
      if(amplitude!==expected||Math.abs(Math.hypot(real,imaginary)-amplitude)>2e-7)throw new Error('incoherent neuron amplitude');
      const read=decodeCarrier(real,imaginary,ring);
      if(read.value!==r)throw new Error('neuron phase/residue mismatch');
    }
  }
  return state;
}
export function loadModel(text){return validateModel(decodeState(text));}
export function saveModel(state){validateModel(state);return encodeState(state);}
export function importModelTiff(bytes, sequence=0) {
  const field=decodePixel160Tiff(bytes);
  return validateModel({profile:field.profile,shape:field.shape,config:field.config,current:{sequence,simulationTime:0,words:field.words},frames:[]});
}
export function exportModelTiff(state) {
  validateModel(state);return encodePixel160Tiff({profile:state.profile,shape:state.shape,config:state.config,words:state.current.words});
}
export function modelField(state) {
  validateModel(state);const re=new Float32Array(COUNT),im=new Float32Array(COUNT);
  for(let i=0;i<COUNT;i++){re[i]=bitsFloat(state.current.words[i*5+3]);im[i]=bitsFloat(state.current.words[i*5+4]);}
  return {re,im};
}
/** Detached candidate. GPU confirmation and durable publication happen in the worker. */
export function prepareModel({re,im,prior=null,args={}}) {
  const config=configuration(args),ring=createRing(config);
  if(!(re instanceof Float32Array)||!(im instanceof Float32Array)||re.length!==COUNT||im.length!==COUNT)throw new Error('XPU requires the 64 by 64 resident field');
  let a,input,activation=new Float64Array(COUNT),sequence=0,simulationTime=0,frames=[];
  if(config.source==='bank') {
    if(!prior)throw new Error('no saved neuron bank; sample the live field first');
    validateModel(prior);
    if(prior.config.prime!==ring.prime||prior.config.precision!==ring.precision)throw new Error('continuation requires the saved ring; select live field to change it');
    a=new Uint16Array(COUNT);input=new Float64Array(COUNT);
    for(let i=0;i<COUNT;i++){a[i]=prior.current.words[i*5];activation[i]=bitsFloat(prior.current.words[i*5+1]);input[i]=2*a[i]/(ring.modulus-1)-1;}
    sequence=prior.current.sequence;simulationTime=prior.current.simulationTime;
    // Parameter changes get a new history because each frame uses its state's declared configuration.
    if(sameRecord(prior.config,config)) {
      const history=[...prior.frames];
      if(history.at(-1)?.sequence===prior.current.sequence)history.pop();
      frames=[...history,prior.current].slice(-8).map(f=>({...f,words:new Uint32Array(f.words)}));
    }
  } else {const sample=sampleIntensity(re,im,ring);a=sample.values;input=sample.input;}
  const b=new Uint16Array(COUNT).fill(config.operand),phase=runPhaseBatch(a,b,{ring,operation:config.operation});
  for(let step=0;step<config.steps;step++){
    const nextTime=simulationTime+config.neuron.dt;
    if(!Number.isFinite(nextTime)||nextTime-simulationTime!==config.neuron.dt||!Number.isSafeInteger(nextTime/config.neuron.dt))throw new Error('neuron simulation time cannot advance exactly');
    activation=neuronStep(activation,input,config.neuron).values;simulationTime=nextTime;
  }
  // Float32 is the canonical persisted neuron precision; recouple after rounding it.
  const rounded=Float32Array.from(activation),coupled=coupleNeuronCarriers(phase.values,rounded,ring,{gain:config.gain});
  const words=new Uint32Array(COUNT*5);let margin=0.5;
  for(let i=0;i<COUNT;i++) {
    const real=Math.fround(coupled.carriers[i*2]),imaginary=Math.fround(coupled.carriers[i*2+1]),read=decodeCarrier(real,imaginary,ring);
    if(read.value!==phase.reference[i])throw new Error('Float32 readout does not match exact arithmetic');
    margin=Math.min(margin,read.margin);
    words.set([read.value,floatBits(rounded[i]),floatBits(1+config.gain*Math.max(-1,Math.min(1,rounded[i]))),floatBits(real),floatBits(imaginary)],i*5);
  }
  const state={profile:NEURON_PROFILE,shape:[...SHAPE],config,current:{sequence:int(sequence+1,1,Number.MAX_SAFE_INTEGER,'sequence'),simulationTime,words},frames};
  const text=saveModel(state),packed=packBitPlanes(a,ring);
  return {state,text,a:Uint32Array.from(a),b:Uint32Array.from(b),expected:Uint32Array.from(phase.reference),ring,
    summary:{samples:COUNT,ring:`Z/(${ring.prime}^${ring.precision})`,modulus:ring.modulus,operation:config.operation,source:config.source,
      inputBytes:COUNT*2,bitPlaneBytes:packed.words.byteLength,bulkBlocks:packed.blocks,canonicalCellBytes:20,canonicalFrameBytes:words.byteLength,
      neuronSteps:config.steps,simulationTime,historyFrames:frames.length,stateBytes:new TextEncoder().encode(text).length,
      cpu:{status:'PASS',comparisonElements:COUNT,phaseMinimumMargin:phase.minMargin,float32MinimumMargin:margin,arithmetic:'independent BigInt oracle',neuronModel:'finite congruence-ball Euler update',phaseModel:'numerical complex phasors'}}};
}
