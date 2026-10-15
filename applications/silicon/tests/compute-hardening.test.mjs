import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Hpu,kerrCoherent,wignerGrid,energy} from '../src/vendor/spiral/hpu.js';
import {decodeState,encodeState} from '../src/vendor/spiral/state-codec.js';
import {BYTE_STAGES} from '../src/vendor/spiral/byte-tables.js';
import {HARNESS_SOURCE} from '../src/vendor/spiral/chip-harness.js';
import {encodeGrayTiff,decodeGrayTiff} from '../src/vendor/spiral/tiff-codec.js';
import {captureHpu,encodeFieldTiff,decodeFieldTiff,stableJSON} from '../src/vendor/spiral/russl-field.js';
import hpuCommands from '../src/vendor/spiral/commands/hpu.js';
import {VFS} from '../src/vendor/spiral/vfs.js';
import {Buffer as VBuffer} from '../src/vendor/spiral/buffer.js';

test('phase retrieval seeds a nonzero target where resident phase is undefined',()=>{
 const h=new Hpu();h.clear();const target=new Float32Array(4096).fill(.5);h._swapAmp(target);
 assert.deepEqual(h.re,target);assert.equal(energy(h.re,h.im),1024);
 assert(h.im.every(v=>v===0));
 const before=h.save();assert.throws(()=>h._swapAmp(new Float32Array(3)));assert.deepEqual(h.save(),before);
});

test('invalid lens and gate arguments preserve field and byte caches',()=>{
 const h=new Hpu();h.bytes();const before=h.save();
 for(const value of [0,NaN,Infinity,'0.01',true]){assert.throws(()=>h.lens(value));assert.deepEqual(h.save(),before);}
 for(const value of [null,true,'1',undefined,2]){assert.throws(()=>h.gate('and',value,1));assert.deepEqual(h.save(),before);}
 assert.throws(()=>h.record('typo'));assert.deepEqual(h.save(),before);
 assert.equal(h.replay(),null);assert.deepEqual(h.save(),before);
});

test('Wigner rendering rejects nonfinite coefficients and excessive work before allocation',()=>{
 const cs=kerrCoherent(0,0,0);const w=wignerGrid(cs,1,.1);assert(Math.abs(w[0]-1/Math.PI)<1e-6);
 for(const grid of [0,1.5,65,Infinity,'40'])assert.throws(()=>wignerGrid(cs,grid,3.6));
 for(const span of [0,-1,9,Infinity,'3.6'])assert.throws(()=>wignerGrid(cs,40,span));
 for(const state of [[],Array(12).fill({re:0,im:0}),[{re:NaN,im:0}],[{re:1,im:Infinity}]])assert.throws(()=>wignerGrid(state,40,3.6));
});

test('all byte-sized OAM values round trip and shifts preserve modulo/remainder semantics',()=>{
 const h=new Hpu();for(let value=0;value<256;value++)assert.equal(h.oam(value).value,value);
 for(const value of [0,1,2,3,85,128,173,255])for(let steps=1;steps<=7;steps++){
  h.oam(value);let r=h.shift(1,steps);assert.equal(r.value,(value<<steps)&255);assert.equal(r.overflow,value>>>(8-steps)?1:0);
  h.oam(value);r=h.shift(-1,steps);assert.equal(r.value,value>>>steps);assert.equal(r.rem,value&((1<<steps)-1));
 }
});

test('OAM input rejects coercion and invalid shifts without discarding byte caches',()=>{
 const h=new Hpu();h.oam(173);h.bytes();const before=h.save();
 for(const value of [-1,256,2**32,1.5,true,'1',NaN]){assert.throws(()=>h.oam(value));assert.deepEqual(h.save(),before);}
 for(const args of [[0,1],[1,0],[1,8],[-1,1.5],[true,1],[1,'1']]){assert.throws(()=>h.shift(...args));assert.deepEqual(h.save(),before);}
});

test('rightmost OAM well cannot read x=64 as x=0 in the following row',()=>{
 const h=new Hpu();h.clear();h.re[33*64]=2;const r=h._readOam();assert.equal(r.value,128);
});

test('byte tables and metadata cannot be mutated after module initialization',()=>{
 assert.throws(()=>{BYTE_STAGES[0].table[0]=0;},TypeError);
 assert.throws(()=>{BYTE_STAGES[0].unique=1;},TypeError);
 assert.throws(()=>{BYTE_STAGES.pop();},TypeError);
});

test('embedded C# reference is exactly the distributed source',async()=>{
 const source=await fs.readFile(new URL('../src/vendor/spiral/ChipHarness.cs',import.meta.url),'utf8');
 assert.equal(source.replace(/\r\n/g,'\n'),HARNESS_SOURCE.replace(/\r\n/g,'\n'));
});

test('forged HPU counters, recorded-object pairs and semantic metadata fail atomically',()=>{
 const h=new Hpu();h.record('twin');const before=h.save();
 for(const mutate of [s=>s.objectIm=null,s=>s.recorded='',s=>s.cycles=-1,s=>s.cycles=.5,s=>s.logical1=4097,s=>s.oamValue=1,s=>s.margin=2,s=>s.bloch=[1,1,1],s=>s.wignerN=39]){
  const s=decodeState(before);mutate(s);assert.equal(h.load(encodeState(s)),false);assert.deepEqual(h.save(),before);
 }
});

test('byte ledger claims must be reproduced from their sampled lanes',()=>{
 const h=new Hpu();h.bytes();const before=h.save();
 for(const mutate of [s=>s.byteStages[0].changed=(s.byteStages[0].changed+1)%4097,s=>s.byteStages[0].unique=25,s=>s.byteStages[0].equivalent=false,s=>s.byteStages[0].cpuCycles=1,s=>s.byteStages[2].same='',s=>s.byteStages[6].proof='invented']){
  const s=decodeState(before);mutate(s);assert.equal(h.load(encodeState(s)),false);assert.deepEqual(h.save(),before);
 }
 for(const value of [0,8,'1',1.5,NaN])assert.throws(()=>h.tiffPlane(value));
});

test('high-amplitude valid fields preserve sampled intensity through HPU2 save/load',()=>{
 const h=new Hpu();h.re.fill(Math.fround(1e12));h.im.fill(Math.fround(1e12));h.sample();
 assert(h.ramI[0]>1e12&&h.ramI[0]<=Math.fround(2e24));const bytes=h.save(),copy=new Hpu();assert(copy.load(bytes));assert.deepEqual(copy.save(),bytes);
 const s=decodeState(bytes);s.re[0]=Math.fround(2e12);assert.equal(copy.load(encodeState(s)),false);
 s.re[0]=0;s.ramI[0]=Math.fround(3e24);assert.equal(copy.load(encodeState(s)),false);
});

test('canonical field metadata rejects unsupported values, sparse arrays and nonfinite aliases',()=>{
 assert.equal(stableJSON({b:[1,true,null],a:'x'}),'{"a":"x","b":[1,true,null]}');
 for(const value of [undefined,NaN,Infinity,()=>{},1n,Symbol('x'),new Date(),{a:undefined},{a:NaN},Array(2)])assert.throws(()=>stableJSON(value));
 const cycle={};cycle.self=cycle;assert.throws(()=>stableJSON(cycle),/depth/);
 assert.throws(()=>stableJSON(Array(128).fill(Array(128).fill(0))),/node/);
});

test('derived field slots reject negative intensity and phase beyond its physical range',()=>{
 let f=captureHpu(new Hpu());f.samples[8192]=-Number.EPSILON;assert.throws(()=>encodeFieldTiff(f),/derived/);
 const h=new Hpu();h.re[0]=-1;h.im[0]=0;f=captureHpu(h);f.samples[12288]=Math.PI+Number.EPSILON*2;assert.throws(()=>encodeFieldTiff(f),/derived/);
 assert.equal(decodeFieldTiff(encodeFieldTiff(captureHpu(h))).samples[12288],Math.PI);
});

test('TIFF rejects unsupported tone curves, volumes, legacy sample semantics and raw-DNG transforms',()=>{
 for(const id of [301,343,32995,32996,32997,32998,33421,33422,50712,50714,50717,50718,50719,50720]){
  const bytes=encodeGrayTiff(1,1,new Uint8Array([1]),{description:'opaque'}),v=new DataView(bytes.buffer);const count=v.getUint16(8,true);
  for(let i=0;i<count;i++){const p=10+i*12;if(v.getUint16(p,true)===270){v.setUint16(p,id,true);break;}}
  assert.throws(()=>decodeGrayTiff(bytes),/semantic metadata/);
 }
});

test('model step limits saturate without uint32 wrapping and reject invalid work requests atomically',()=>{
 let h=new Hpu();assert.equal(h.cycle(2**32+1).cycles,8);
 h=new Hpu();assert.equal(h.diffuse(2**32+1).cycles,16);
 h=new Hpu();assert.equal(h.kuramoto(2**32+1).steps,12);
 h=new Hpu();h.bytes();const before=h.save();
 for(const method of ['cycle','diffuse','kuramoto'])for(const count of [NaN,Infinity,.5,'1',true]){assert.throws(()=>h[method](count));assert.deepEqual(h.save(),before);}
 assert.throws(()=>h.gerchberg('typo',4),/target/);assert.deepEqual(h.save(),before);
 assert.throws(()=>h.gerchberg('spots',1.5),/integer/);assert.deepEqual(h.save(),before);
});

function commandContext(hpu=new Hpu()){
 const vfs=new VFS();vfs.mkdir('/var/hpu',{recursive:true});let output='';
 return {ctx:{args:[],host:{hpu},vfs,resolve:path=>path,stdout:{write:s=>output+=s},stderr:{write:s=>output+=s}},output:()=>output};
}

test('HPU shell rolls back a valid high-amplitude field whose byte phase exceeds model bounds',async()=>{
 const h=new Hpu();h.re.fill(Math.fround(1e12));h.im.fill(Math.fround(1e12));
 const {ctx,output}=commandContext(h);ctx.args=['bytes'];let publications=0;ctx.host.hpuTouch=()=>publications++;
 const state=h.save(),snapshot=ctx.vfs.exportSnapshot();assert.equal(await hpuCommands[0].run(ctx),1);
 assert.deepEqual(h.save(),state);assert.deepEqual(ctx.vfs.exportSnapshot(),snapshot);assert.equal(publications,0);
 assert.match(output(),/invalid complex field value/);assert.doesNotMatch(output(),/processor-1\.tif/);
});

test('HPU shell quota failure leaves no partial byte planes and preserves every derived cache',async()=>{
 const {ctx,output}=commandContext();ctx.host.hpu.record('twin');ctx.host.hpu.frame();ctx.args=['bytes'];
 const state=ctx.host.hpu.save(),snapshot=ctx.vfs.exportSnapshot();ctx.vfs.maxBytes=ctx.vfs.usedBytes+20000;
 assert.equal(await hpuCommands[0].run(ctx),1);assert.deepEqual(ctx.host.hpu.save(),state);assert.deepEqual(ctx.vfs.exportSnapshot(),snapshot);
 assert.doesNotMatch(output(),/BYTES/);
});

test('HPU shell publication failure restores original HPU and persisted file before reporting success',async()=>{
 const {ctx,output}=commandContext();ctx.host.hpu.bytes();ctx.args=['pattern','vortex'];
 ctx.vfs.writeFile('/var/hpu/field.bin',VBuffer.from(ctx.host.hpu.save()));const state=ctx.host.hpu.save(),snapshot=ctx.vfs.exportSnapshot();
 ctx.host.hpuTouch=()=>{ctx.vfs.writeFile('/var/hpu/field.bin',VBuffer.from(ctx.host.hpu.save()));ctx.host.hpu.extra='unexpected';throw new Error('publication failed');};
 assert.equal(await hpuCommands[0].run(ctx),1);assert.deepEqual(ctx.host.hpu.save(),state);assert.deepEqual(ctx.vfs.exportSnapshot(),snapshot);
 assert.match(output(),/publication failed/);assert.doesNotMatch(output(),/phase mask set/);
});
