import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as c from '../src/lib/semisili-core.js';
const r={profile:'SEMISILI-CORE-INDEPENDENT-ACCEPTANCE/1',status:'RUNNING',phaseCases:0,bitPlaneSamples:0,valuationCases:0,ultrametricTriples:0,neuronSamples:0,guardRejections:0};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function oracle(a,b,m,op){let x=BigInt(a),y=BigInt(b),n=BigInt(m);let z=op==='add'?x+y:op==='sub'?x-y:op==='mul'?x*y:op==='negate'?-x:n-1n-x;return Number((z%n+n)%n);}
function batch(a,b,ring,op){const out=c.runPhaseBatch(a,b,{ring,operation:op});assert(out.verified);assert.equal(out.gpuStatus,'NOT_RUN');for(let i=0;i<a.length;i++){assert.equal(out.values[i],oracle(a[i],b?.[i]||0,ring.modulus,op));r.phaseCases++;}return out;}
const binary=c.createRing({prime:2,precision:1}),byte=c.createRing();
assert.deepEqual(batch([0,1],undefined,binary,'negate').values,new Uint16Array([0,1]));
assert.deepEqual(batch([0,1],undefined,binary,'complement').values,new Uint16Array([1,0]));
assert.equal(c.decodeCarrier(1,0,binary).value,0);assert.equal(c.decodeCarrier(-1,0,binary).value,1);
for(const op of ['add','sub','mul'])for(let first=0;first<65536;first+=4096){const a=Uint16Array.from({length:4096},(_,i)=>(first+i)>>>8),b=Uint16Array.from({length:4096},(_,i)=>(first+i)&255);batch(a,b,byte,op);}
for(const op of ['negate','complement'])batch(Uint16Array.from({length:256},(_,i)=>i),undefined,byte,op);
let seed=0x51a21;function rand(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
for(const ring of [binary,c.createRing({prime:3,precision:5}),c.createRing({prime:5,precision:4}),c.createRing({prime:2,precision:16})]){
 const a=Uint16Array.from({length:4096},(_,i)=>i<8?[0,1,ring.modulus-2,ring.modulus-1,0,ring.modulus-1,1,ring.modulus-2][i]:rand()%ring.modulus),b=Uint16Array.from({length:4096},()=>rand()%ring.modulus);
 for(const op of ['add','sub','mul','negate','complement'])batch(a,b,ring,op);
}
for(let x=0;x<65536;x++){const ring=c.createRing({prime:2,precision:16}),wave=c.encodeResidue(x,ring);assert.equal(c.decodeCarrier(wave.re,wave.im,ring).value,x);r.phaseCases++;}
for(const ring of [byte,c.createRing({prime:5,precision:4}),c.createRing({prime:2,precision:16})])for(const n of [1,31,32,33,63,64,65,4095,4096]){
 const input=Uint16Array.from({length:n},()=>rand()%ring.modulus),packed=c.packBitPlanes(input,ring);assert.deepEqual(c.unpackBitPlanes(packed),input);
 const expected=Array.from({length:packed.words.length},()=>0n);
 for(let bit=0;bit<ring.bitWidth;bit++)for(let i=0;i<n;i++)if(Math.floor(input[i]/2**bit)%2){const word=(bit*packed.blocks+Math.floor(i/64))*2+Math.floor((i%64)/32);expected[word]+=2n**BigInt(i%32);}
 assert.deepEqual([...packed.words],expected.map(Number));r.bitPlaneSamples+=n;
}
function vp(n,p){if(!n)return Infinity;let x=BigInt(n),q=BigInt(p),v=0;while(x%q===0n){x/=q;v++;}return v;}
for(const p of [2,3,5,7])for(let n=0;n<4096;n++){assert.equal(c.valuation(n,p),vp(n,p));r.valuationCases++;}
for(const p of [2,3,5])for(let a=0;a<32;a++)for(let b=0;b<32;b++)for(let d=0;d<32;d++){assert(c.pAdicDistance(a,d,{prime:p})<=Math.max(c.pAdicDistance(a,b,{prime:p}),c.pAdicDistance(b,d,{prime:p})));r.ultrametricTriples++;}
const addresses=c.canonicalAddresses(64),state=Float64Array.from({length:64},()=>rand()/2**32*8-4),input=Float64Array.from({length:64},()=>rand()/2**32*2-1),next=c.neuronStep(state,input,{addresses});
for(let i=0;i<64;i++){let sum=0,n=0;for(let j=0;j<64;j++)if(c.pAdicDistance(addresses[i],addresses[j])<=2**-6){sum+=state[j];n++;}const sigmoid=.5*(Math.abs(state[i]+1)-Math.abs(state[i]-1));const expected=state[i]+.25*(-state[i]+1.5*sigmoid+.25*(sum/n-state[i])+.5*input[i]);assert(Math.abs(next.values[i]-expected)<2e-12);r.neuronSamples++;}
let evolving=Float64Array.from({length:4096},()=>rand()/2**32*8-4),drive=Float64Array.from({length:4096},()=>rand()/2**32*2-1);
for(let step=0;step<64;step++){const out=c.neuronStep(evolving,drive);assert(out.values.every(x=>Number.isFinite(x)&&Math.abs(x)<=4));assert(out.bits.every((v,i)=>v+out.antiBits[i]===1));evolving=out.values;r.neuronSamples+=4096;}
assert.deepEqual(c.neuronStep([0],[0]).bits,new Uint8Array([0]));
const coupled=c.coupleNeuronCarriers([0,1,255],[-4,0,4],byte);for(let i=0;i<3;i++){const x=c.decodeCarrier(coupled.carriers[i*2],coupled.carriers[i*2+1],byte);assert.equal(x.value,[0,1,255][i]);assert(Math.abs(x.amplitude-[.5,1,1.5][i])<1e-12);}
const sampled=c.sampleIntensity([0,1,2],[0,0,0],byte);assert.deepEqual(sampled.values,new Uint16Array([0,64,255]));assert.deepEqual(sampled.bits,new Uint8Array([0,0,1]));
const fail=[()=>c.createRing({prime:4,precision:2}),()=>c.createRing({prime:2,precision:17}),()=>c.runPhaseBatch([256],[0]),()=>c.runPhaseBatch([0],[]),()=>c.runPhaseBatch([0],[0],{operation:false}),()=>c.runPhaseBatch(new Uint16Array(4097),new Uint16Array(4097)),()=>c.decodeCarrier(0,0,byte),()=>c.decodeCarrier(NaN,1,byte),()=>c.decodeCarrier(Math.cos(Math.PI/256),Math.sin(Math.PI/256),byte),()=>c.neuronStep([0],[0],{dt:1}),()=>c.neuronStep([5],[0]),()=>c.neuronStep([0],[2]),()=>c.coupleNeuronCarriers([0],[0],byte,{gain:1})];
for(const f of fail){assert.throws(f);r.guardRejections++;}
const original=new Uint16Array([1,2,3]),copy=original.slice();assert.throws(()=>c.runPhaseBatch(original,[1,2,999]));assert.deepEqual(original,copy);
r.status='PASS';r.runtime=process.version;r.finishedUTC=new Date().toISOString();r.sourceSHA256=hash(await fs.readFile(new URL('../src/lib/semisili-core.js',import.meta.url)));r.limits=['Numerical CPU phase model; GPU integer confirmation and browser acceptance are separate gates.','Finite ring and bounded hierarchical CNN; no physical quantum/optical hardware or trained accuracy claim.'];
console.log(JSON.stringify(r));
await fs.writeFile(new URL('../../literature/math/CORE_INDEPENDENT_RESULTS.json',import.meta.url),JSON.stringify(r,null,2)+'\n');
