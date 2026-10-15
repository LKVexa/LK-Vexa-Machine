import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as m from '../src/lib/semisili-model.js';
const report={profile:'SEMISILI-MODEL-INDEPENDENT-ACCEPTANCE/1',status:'RUNNING',analyticSamples:0,stateRoundTrips:0,tiffRoundTrips:0,continuations:0,guardRejections:0};
const bits=new DataView(new ArrayBuffer(4));
function fword(value){bits.setFloat32(0,value,false);return bits.getUint32(0,false);}
function wordf(value){bits.setUint32(0,value,false);return bits.getFloat32(0,false);}
function clone(s){return {profile:s.profile,shape:[...s.shape],config:JSON.parse(JSON.stringify(s.config)),current:{...s.current,words:s.current.words.slice()},frames:s.frames.map(f=>({...f,words:f.words.slice()}))};}
function hash(data){return crypto.createHash('sha256').update(data).digest('hex');}
const re=new Float32Array(4096).fill(1),im=new Float32Array(4096);
const candidate=m.prepareModel({re,im});
let analytic=0;for(let i=0;i<4;i++)analytic+=.25*(-analytic+1.5*Math.max(-1,Math.min(1,analytic))+.5);
const rounded=Math.fround(analytic),amplitude=Math.fround(1+.5*rounded);
for(let i=0;i<4096;i++){
 const offset=i*5;assert.equal(candidate.state.current.words[offset],0);assert.equal(candidate.state.current.words[offset+1],fword(rounded));assert.equal(candidate.state.current.words[offset+2],fword(amplitude));assert.equal(candidate.state.current.words[offset+3],fword(amplitude));assert.equal(candidate.state.current.words[offset+4],fword(0));report.analyticSamples++;
}
assert.equal(candidate.state.current.simulationTime,1);assert.equal(candidate.state.current.sequence,1);assert.deepEqual(re,new Float32Array(4096).fill(1));
const saved=m.saveModel(candidate.state),decoded=m.loadModel(saved);assert.equal(m.saveModel(decoded),saved);report.stateRoundTrips++;
assert.deepEqual(m.modelField(decoded),{re:new Float32Array(4096).fill(amplitude),im:new Float32Array(4096)});
const tiff=m.exportModelTiff(candidate.state),imported=m.importModelTiff(tiff);assert.deepEqual(imported.current.words,candidate.state.current.words);assert.equal(imported.current.sequence,0);assert.equal(imported.current.simulationTime,0);report.tiffRoundTrips++;
// Config insertion order must not change mathematical validity or continuity.
const reordered=clone(candidate.state);reordered.config=Object.fromEntries(Object.entries(reordered.config).reverse());reordered.config.neuron=Object.fromEntries(Object.entries(reordered.config.neuron).reverse());m.validateModel(reordered);
let state=candidate.state;
for(let run=0;run<12;run++){
 const before=m.saveModel(state),next=m.prepareModel({re,im,prior:state,args:{source:'bank'}});
 assert.equal(m.saveModel(state),before);assert.equal(next.state.current.sequence,state.current.sequence+1);assert.equal(next.state.current.simulationTime,state.current.simulationTime+1);assert(next.state.frames.length<=8);
 assert.equal(m.saveModel(m.loadModel(next.text)),next.text);report.stateRoundTrips++;report.continuations++;state=next.state;
}
assert.equal(state.frames.length,8);
const cachedCurrent=clone(state);cachedCurrent.frames=[...cachedCurrent.frames.slice(1),{...cachedCurrent.current,words:cachedCurrent.current.words.slice()}];
const cachedNext=m.prepareModel({re,im,prior:cachedCurrent,args:{source:'bank'}}),normalNext=m.prepareModel({re,im,prior:state,args:{source:'bank'}});
assert.equal(cachedNext.text,normalNext.text);assert.equal(m.saveModel(m.loadModel(cachedNext.text)),cachedNext.text);report.stateRoundTrips++;report.cachedCurrentHistoryCases=1;
const reorderedBank=clone(state);reorderedBank.config=Object.fromEntries(Object.entries(reorderedBank.config).reverse());const continuity=m.prepareModel({re,im,prior:reorderedBank,args:{source:'bank'}});assert.equal(continuity.state.frames.length,8);
const change=m.prepareModel({re,im,prior:state,args:{source:'bank',operation:'mul',operand:2}});assert.equal(change.state.frames.length,0);assert.equal(change.state.current.sequence,state.current.sequence+1);
for(const ring of [{prime:2,precision:1},{prime:3,precision:5},{prime:5,precision:4},{prime:2,precision:16},{prime:65521,precision:1}]){
 const shape=m.configuration(ring);assert(Number.isSafeInteger(shape.prime**shape.neuron.level));const next=m.prepareModel({re,im,args:{...ring,operation:'complement'}});assert(next.state.current.words.every((word,i)=>i%5!==0||word===0));assert.equal(m.saveModel(m.loadModel(next.text)),next.text);report.stateRoundTrips++;
 const exported=m.exportModelTiff(next.state);assert.deepEqual(m.importModelTiff(exported).current.words,next.state.current.words);report.tiffRoundTrips++;
}
const mutations=[s=>s.frames=Array(9).fill(s.current),s=>s.current.sequence=NaN,s=>s.current.sequence=-1,s=>s.current.simulationTime=Infinity,s=>s.current.simulationTime=.1,s=>s.frames=[{...s.current,simulationTime:s.current.simulationTime-.25,words:s.current.words.slice()}],s=>s.current.words[0]=256,s=>s.current.words[1]=fword(5),s=>s.current.words[2]=fword(.1),s=>s.current.words[3]=fword(NaN),s=>s.current.words[4]=fword(1),s=>s.config.neuron.dt=.5,s=>s.config.gain=.75];
for(const mutate of mutations){const forged=clone(candidate.state);mutate(forged);assert.throws(()=>m.validateModel(forged));report.guardRejections++;assert.equal(m.saveModel(candidate.state),saved);}
const exhausted=clone(candidate.state);exhausted.current.sequence=Number.MAX_SAFE_INTEGER;assert.throws(()=>m.prepareModel({re,im,prior:exhausted,args:{source:'bank'}}));report.guardRejections++;
const exhaustedTime=clone(candidate.state);exhaustedTime.current.simulationTime=Number.MAX_SAFE_INTEGER/4;assert.throws(()=>m.prepareModel({re,im,prior:exhaustedTime,args:{source:'bank'}}));report.guardRejections++;
assert.throws(()=>m.prepareModel({re,im,prior:state,args:{source:'bank',prime:3,precision:5}}));report.guardRejections++;
report.status='PASS';report.finishedUTC=new Date().toISOString();report.sourceSHA256=hash(await fs.readFile(new URL('../src/lib/semisili-model.js',import.meta.url)));report.codecSHA256=hash(await fs.readFile(new URL('../src/lib/semisili-codec.js',import.meta.url)));report.limits=['Detached CPU preparation and canonical state/TIFF behavior only. Actual GPU confirmation, publication and browser persistence remain separate gates.'];
console.log(JSON.stringify(report));await fs.writeFile(new URL('../audit/SEMISILI_MODEL_RESULTS.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
