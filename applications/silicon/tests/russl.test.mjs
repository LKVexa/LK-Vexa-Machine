// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {encodeGrayTiff,decodeGrayTiff,TIFF_LIMITS} from '../src/vendor/spiral/tiff-codec.js';
import {SHAPE,STRIDES,SITES,FIELD_PATH,ordinal,indices,coordinate,addressDistance,captureHpu,encodeFieldTiff,decodeFieldTiff,editFieldSite,fieldToComplex,fieldReceipt,sampleBytes,stableJSON} from '../src/vendor/spiral/russl-field.js';
import {russlOperation} from '../src/vendor/spiral/russl-service.js';
import {Hpu} from '../src/vendor/spiral/hpu.js';
import {VFS} from '../src/vendor/spiral/vfs.js';
import {Buffer as VBuffer} from '../src/vendor/spiral/buffer.js';
import {SpiralKernel} from '../src/vendor/spiral/kernel.js';
const load=async rel=>new Uint8Array(await fs.readFile(new URL(rel,import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
const leBytes=(samples)=>{const out=new Uint8Array(samples.byteLength),v=new DataView(out.buffer),methods={Uint8Array:'setUint8',Uint16Array:'setUint16',Float32Array:'setFloat32',Float64Array:'setFloat64'};samples.forEach((x,i)=>v[methods[samples.constructor.name]](i*samples.BYTES_PER_ELEMENT,x,true));return out;};
function entry(bytes,id){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const le=bytes[0]===73,big=v.getUint16(2,le)===43,ifd=big?Number(v.getBigUint64(8,le)):v.getUint32(4,le),count=big?Number(v.getBigUint64(ifd,le)):v.getUint16(ifd,le),size=big?20:12;for(let i=0;i<count;i++){const p=ifd+(big?8:2)+i*size;if(v.getUint16(p,le)===id)return {v,p,slot:p+(big?12:8),le,big,ifd,count};}throw new Error('missing test tag');}
const fresh=()=>encodeGrayTiff(4,3,Uint16Array.from({length:12},(_,i)=>i),{description:{test:'safe metadata'}});
function mutate(fn){const b=fresh();fn(b);return b;}
function ctx(){const vfs=new VFS();vfs.mkdir('/var/hpu',{recursive:true});return {vfs,host:{hpu:new Hpu()}};}

test('RUSSL: all 16,384 authoritative corpus vectors agree with port, inverse and bit packing',async()=>{
 const data=await load('../corpus/russl-2.0.0/tests/vectors/field/fixed_shape_index_vectors.jsonl');assert.equal(hash(data),'79050f2300a3e4413cf4bb6ab9ee182fc8e1e92578e66abeac4e640d3e7ec0e0');
 const rows=new TextDecoder().decode(data).trim().split('\n').map(JSON.parse);assert.equal(rows.length,SITES);
 const seen=new Set();for(const row of rows){const site=row.indices;assert.equal(ordinal(site),row.ordinal);assert.deepEqual(indices(row.ordinal),site);assert.equal((site[0]<<12)|(site[1]<<10)|(site[2]<<8)|(site[3]<<4)|site[4],row.ordinal);seen.add(ordinal(site));}assert.equal(seen.size,16384);
});
test('RUSSL: index domains reject booleans, fractions, strings, NaNs, oversize and negatives',()=>{
 for(const v of [true,false,'1',1.1,-1,4,NaN,Infinity,null,undefined])assert.throws(()=>ordinal([v,0,0,0,0]));
 for(const v of [true,'1',1.1,-1,16384,NaN,Infinity,null])assert.throws(()=>indices(v));assert.throws(()=>ordinal([0,0]));
});
test('RUSSL: exact rational normalized coordinates include anchors and endpoints',()=>{assert.deepEqual(coordinate(0,1),{numerator:0,denominator:1});assert.deepEqual(coordinate(1,4),{numerator:-1,denominator:3});assert.deepEqual(coordinate(8,16),{numerator:1,denominator:15});for(const n of SHAPE){assert.equal(coordinate(0,n).numerator,-1);assert.equal(coordinate(n-1,n).numerator,1);}});
test('RUSSL: optional address ultrametric has distinct documented semantics',()=>{assert.deepEqual(addressDistance(2,2),{numerator:0,denominator:1});assert.deepEqual(addressDistance(0,4096),{numerator:1,denominator:4096});assert.deepEqual(addressDistance(0,1),{numerator:1,denominator:1});const d=(a,b)=>{const r=addressDistance(a,b);return r.numerator/r.denominator;};for(let i=0;i<1000;i++){const a=i*13%16384,b=i*271%16384,c=i*761%16384;assert(d(a,c)<=Math.max(d(a,b),d(b,c)));}});
for(const Ctor of [Uint8Array,Uint16Array,Float32Array,Float64Array])for(const bigTiff of [false,true])for(const byteOrder of ['II','MM'])test(`TIFF: ${Ctor.name} ${bigTiff?'BigTIFF':'classic'} ${byteOrder} exact sample bits`,()=>{
 const s=Ctor.from([0,1,2,3,255,16]);if(Ctor.name.startsWith('Float')){s[0]=-0;s[1]=Math.PI;s[2]=-Math.PI;s[3]=1e-20;}
 const out=decodeGrayTiff(encodeGrayTiff(3,2,s,{byteOrder,bigTiff,description:{scope:'test'}}));assert.deepEqual(leBytes(out.samples),leBytes(s));assert.equal(out.byteOrder,byteOrder);assert.equal(out.bigTiff,bigTiff);assert.equal(out.orientation,1);assert.equal(out.calibration.unit,1);
});
const independent=JSON.parse(new TextDecoder().decode(await load('./fixtures/independent-tiff/manifest.json')));
for(const f of independent.files)test(`TIFF: independently written ${f.file}`,async()=>{const b=await load('./fixtures/independent-tiff/'+f.file);assert.equal(hash(b),f.sha256);const d=decodeGrayTiff(b);assert.equal(d.width,f.width);assert.equal(d.height,f.height);assert.equal(d.dtype,f.dtype);assert.equal(d.bigTiff,f.bigTiff);assert.equal(d.byteOrder,f.byteOrder);assert.equal(d.stripCount,2);assert.deepEqual(leBytes(d.samples),await load('./fixtures/independent-tiff/'+f.expected));});
test('TIFF: raw orientation is retained rather than silently normalized',async()=>{const d=decodeGrayTiff(await load('./fixtures/independent-tiff/orientation-6.tif'));assert.equal(d.orientation,6);assert.deepEqual([...d.samples],[...Array(15).keys()]);});
test('TIFF: strict BigTIFF alignment rejects external misaligned extra-value blocks',async()=>{const b=await load('./fixtures/independent-tiff/unaligned-bigtiff.tif');assert.throws(()=>decodeGrayTiff(b),/misaligned/);});
// Each mutation isolates a distinct closed-profile rejection.
const negatives=[
 ['bad byte order',b=>b[0]=0],['unknown TIFF version',b=>new DataView(b.buffer).setUint16(2,99,true)],
 ['IFD outside input',b=>new DataView(b.buffer).setUint32(4,0xfffffff0,true)],
 ['oversized tag count',b=>new DataView(b.buffer).setUint16(8,65535,true)],
 ['duplicate tag',b=>new DataView(b.buffer).setUint16(22,256,true)],
 ['unknown tag type',b=>{const e=entry(b,256);e.v.setUint16(e.p+2,99,true);}],
 ['multipage/cyclic chain',b=>{const e=entry(b,256);e.v.setUint32(e.ifd+2+e.count*12,8,true);}],
 ['compression',b=>{const e=entry(b,259);e.v.setUint16(e.slot,5,true);}],
 ['palette interpretation',b=>{const e=entry(b,262);e.v.setUint16(e.slot,3,true);}],
 ['RGB sample count',b=>{const e=entry(b,277);e.v.setUint16(e.slot,3,true);}],
 ['signed sample format',b=>{const e=entry(b,339);e.v.setUint16(e.slot,2,true);}],
 ['zero rows per strip',b=>{const e=entry(b,278);e.v.setUint32(e.slot,0,true);}],
 ['planar channels',b=>{const e=entry(b,284);e.v.setUint16(e.slot,2,true);}],
 ['orientation outside domain',b=>{const e=entry(b,274);e.v.setUint16(e.slot,9,true);}],
 ['dimension resource exhaustion',b=>{const e=entry(b,256);e.v.setUint32(e.slot,0xffffffff,true);}],
 ['strip aliases IFD',b=>{const e=entry(b,273);e.v.setUint32(e.slot,8,true);}],
 ['strip past EOF',b=>{const e=entry(b,273);e.v.setUint32(e.slot,b.length-1,true);}],
 ['strip length mismatch',b=>{const e=entry(b,279);e.v.setUint32(e.slot,25,true);}],
 ['embedded NUL description',b=>{const e=entry(b,270);b[e.v.getUint32(e.slot,true)+1]=0;}],
 ['missing description terminator',b=>{const e=entry(b,270),offset=e.v.getUint32(e.slot,true),n=e.v.getUint32(e.p+4,true);b[offset+n-1]=65;}],
 ['metadata claims huge count',b=>{const e=entry(b,270);e.v.setUint32(e.p+4,0x7fffffff,true);}],
 ['unsupported ICC profile',b=>{const e=entry(b,270);e.v.setUint16(e.p,34675,true);}],
 ['resolution denominator zero',b=>{const e=entry(b,282);e.v.setUint32(e.v.getUint32(e.slot,true)+4,0,true);}]
];
for(const [name,fn] of negatives)test('TIFF rejects '+name,()=>assert.throws(()=>decodeGrayTiff(mutate(fn))));
test('TIFF: forged BigTIFF offset size, reserved word and uint64 precision fail closed',()=>{for(const fn of [v=>v.setUint16(4,4,true),v=>v.setUint16(6,1,true),v=>v.setBigUint64(8,2n**63n,true)]){const b=encodeGrayTiff(1,1,new Uint8Array([2]),{bigTiff:true});fn(new DataView(b.buffer));assert.throws(()=>decodeGrayTiff(b));}});
test('TIFF: truncated buffers, excessive files and incompatible sample shapes are rejected',()=>{for(const b of [new Uint8Array(),fresh().subarray(0,24),new Uint8Array(TIFF_LIMITS.bytes+1)])assert.throws(()=>decodeGrayTiff(b));assert.throws(()=>encodeGrayTiff(2,2,new Float64Array(3)));assert.throws(()=>encodeGrayTiff(2,2,new Int32Array(4)));assert.throws(()=>encodeGrayTiff(1,1,new Float64Array([NaN])));assert.throws(()=>encodeGrayTiff(1,1,new Float64Array([Infinity])));});
test('TIFF: decoder rejects nonfinite float payload before exposing samples',()=>{const b=encodeGrayTiff(1,1,new Float64Array([0])),e=entry(b,273);e.v.setFloat64(e.v.getUint32(e.slot,true),NaN,true);assert.throws(()=>decodeGrayTiff(b),/nonfinite/);});
test('TIFF: decoded samples and retained original bytes cannot alias caller storage',()=>{const b=fresh(),d=decodeGrayTiff(b),before=d.sourceBytes.slice();b.fill(0);assert.deepEqual(d.sourceBytes,before);assert.equal(d.samples[3],3);});
test('TIFF: executable-looking metadata is opaque text, never run',()=>{globalThis.__tiffExecuted=false;const code='globalThis.__tiffExecuted=true';assert.equal(decodeGrayTiff(encodeGrayTiff(1,1,new Uint8Array([1]),{description:code})).description,code);assert.equal(globalThis.__tiffExecuted,false);delete globalThis.__tiffExecuted;});
test('RUSSL: all 4,096 complex pixels map exactly, not nearest-neighbour upsampling',()=>{const h=new Hpu();for(let i=0;i<4096;i++){h.re[i]=Math.fround((i-2000)/100);h.im[i]=Math.fround((2000-i)/77);}h.re[0]=-0;h.im[1]=-0;const f=captureHpu(h),c=fieldToComplex(f);assert.deepEqual(leBytes(c.re),leBytes(h.re));assert.deepEqual(leBytes(c.im),leBytes(h.im));for(let y=0;y<64;y++)for(let x=0;x<64;x++){const k=ordinal([0,y>>4,x>>4,y&15,x&15]),p=y*64+x;assert(Object.is(f.samples[k],h.re[p]));assert(Object.is(f.samples[k+4096],h.im[p]));assert.equal(f.samples[k+8192],h.re[p]**2+h.im[p]**2);assert(Object.is(f.samples[k+12288],Math.atan2(h.im[p],h.re[p])));}});
test('RUSSL: capture/serialize/decode is read-only with exact f64 sample bits',()=>{const h=new Hpu();h.bytes();h.spool();const before=h.save();const f=captureHpu(h),b=encodeFieldTiff(f),r=decodeFieldTiff(b);assert.deepEqual(sampleBytes(r.samples),sampleBytes(f.samples));assert.deepEqual(h.save(),before);});
test('RUSSL: file, scalar and logical identities are separated across container variants',async()=>{const f=captureHpu(new Hpu()),a=await fieldReceipt(encodeFieldTiff(f)),b=await fieldReceipt(encodeFieldTiff(f,{byteOrder:'MM',bigTiff:true}));assert.notEqual(a.fileSHA256,b.fileSHA256);assert.equal(a.sampleSHA256,b.sampleSHA256);assert.equal(a.logicalSHA256,b.logicalSHA256);assert.equal(a.sampleSHA256,hash(sampleBytes(f.samples)));assert.equal(a.authentication,false);});
test('RUSSL: checksum mutation is rejected even if the modified sample is finite',()=>{const b=encodeFieldTiff(captureHpu(new Hpu())),e=entry(b,273);b[e.v.getUint32(e.slot,true)]^=1;assert.throws(()=>decodeFieldTiff(b),/checksum/);});
test('RUSSL: mismatched shape, unsupported version and invented metadata cannot silently import',()=>{for(const key of ['shape','profile','injected']){const f=captureHpu(new Hpu()),d=JSON.parse(decodeGrayTiff(encodeFieldTiff(f)).description);if(key==='shape')d.shape=[16,16,4,4,4];else if(key==='profile')d.profile='JA21-RUSSL-HPU-ATLAS/999';else d.injected='eval()';assert.throws(()=>decodeFieldTiff(encodeGrayTiff(128,128,f.samples,{description:d})));}});
test('RUSSL: non-atlas TIFF cannot be treated as an executable or live field',()=>assert.throws(()=>decodeFieldTiff(new Hpu().tiff())));
test('RUSSL: edits are detached, report f32 rounding and recompute both derived slots',()=>{const f=captureHpu(new Hpu()),before=f.samples.slice(),result=editFieldSite(f,[0,0,0,0,0],0.1);assert.equal(result.rounded,true);assert.equal(result.effective,Math.fround(0.1));assert.deepEqual(f.samples,before);assert.equal(result.field.samples[8192],Math.fround(0.1)**2);decodeFieldTiff(encodeFieldTiff(result.field));});
test('RUSSL: direct edits to derived slots and excessive values are rejected',()=>{const f=captureHpu(new Hpu());for(const site of [[2,0,0,0,0],[3,0,0,0,0]])assert.throws(()=>editFieldSite(f,site,1));for(const v of [NaN,Infinity,1e13,'1',true])assert.throws(()=>editFieldSite(f,[0,0,0,0,0],v));});
test('RUSSL: tampered derived data is rejected even when re-encoding recalculates checksums',()=>{const f=captureHpu(new Hpu());f.samples[8192]+=1;assert.throws(()=>encodeFieldTiff(f),/derived/);});
test('RUSSL: negative zero round trips exactly through field TIFF and HPU conversion',()=>{const h=new Hpu();h.re[0]=-0;h.im[0]=-0;const b=encodeFieldTiff(captureHpu(h)),f=decodeFieldTiff(b),r=fieldToComplex(f);assert(Object.is(r.re[0],-0));assert(Object.is(r.im[0],-0));});
test('RUSSL: bounded canonical metadata rejects deep nesting',()=>{let x=0;for(let i=0;i<20;i++)x={x};assert.throws(()=>stableJSON(x),/depth/);});
test('RUSSL service: failed import and stale edits preserve original TIFF and HPU',()=>{const c=ctx(),info=russlOperation(c,'capture'),before=c.vfs.readFile(FIELD_PATH),state=c.host.hpu.save();assert.throws(()=>russlOperation(c,'import',{bytes:new Uint8Array([1])}));assert.throws(()=>russlOperation(c,'edit',{indices:[0,0,0,0,0],value:1,expected:'wrong'}),/changed/);assert.equal(hash(c.vfs.readFile(FIELD_PATH)),hash(before));assert.deepEqual(c.host.hpu.save(),state);assert.equal(russlOperation(c,'info').revision,info.revision);});
test('RUSSL service: edit stays staged; explicit apply resets derived state and persists valid HPU2',()=>{const c=ctx();c.host.hpu.bytes();c.host.hpu.spool();russlOperation(c,'capture');const before=c.host.hpu.save();russlOperation(c,'edit',{indices:[0,0,0,0,0],value:0.5});assert.deepEqual(c.host.hpu.save(),before);russlOperation(c,'apply');assert.equal(c.host.hpu.re[0],0.5);assert.equal(c.host.hpu.frames.length,0);assert.equal(c.host.hpu.byteLanes,null);assert.equal(c.host.hpu.recorded,'');assert(new Hpu().load(c.vfs.readFile('/var/hpu/field.bin')));});
test('RUSSL service: quota failures cannot partially replace a TIFF or live field',()=>{const c=ctx();russlOperation(c,'capture');const staged=c.vfs.readFile(FIELD_PATH),before=c.host.hpu.save();c.vfs.maxBytes=c.vfs.usedBytes;assert.throws(()=>russlOperation(c,'apply'));assert.deepEqual(c.host.hpu.save(),before);assert.equal(hash(c.vfs.readFile(FIELD_PATH)),hash(staged));});
test('RUSSL service: publication failure rolls back HPU and persisted field',()=>{const c=ctx();russlOperation(c,'capture');russlOperation(c,'edit',{indices:[0,0,0,0,0],value:2});const before=c.host.hpu.save();c.host.hpuTouch=()=>{throw new Error('publish failed');};assert.throws(()=>russlOperation(c,'apply'),/publish/);assert.deepEqual(c.host.hpu.save(),before);assert(!c.vfs.exists('/var/hpu/field.bin'));});
test('RUSSL migration: real baseline 2.1.1 HPU2 load stays valid and byte-for-byte unchanged by export',async()=>{const old=await load('./fixtures/HPU2-from-2.1.1.bin'),h=new Hpu();assert(h.load(old));assert.equal(h.byteStages.length,7);const before=h.save();assert.deepEqual(before,old);decodeFieldTiff(encodeFieldTiff(captureHpu(h)));assert.deepEqual(h.save(),old);});
test('RUSSL: shell exposes layout, captures, edits and applies without host paths',async()=>{const hpu=new Hpu(),k=new SpiralKernel({hostBridge:{hpu}}),s=k.sessions.get(k.openSession({deferStart:true}).sessionId);let output='';k.on('data',e=>output+=e.chunk);for(const line of ['russl layout','russl capture','russl verify','russl set 0 0 0 0 0 0.5','russl get 0 0 0 0 0','russl apply'])assert.equal(await k._executeLine(s,line),0);assert.equal(hpu.re[0],0.5);assert.match(output,/16384/);assert.match(output,/0.5/);assert.notEqual(await k._executeLine(s,'russl set 3 0 0 0 0 4'),0);assert.notEqual(await k._executeLine(s,'russl capture --force'),0);k.closeSession(s.id);});

test('rational coordinates keep exact arithmetic at safe-integer domain boundary',()=>{const n=Number.MAX_SAFE_INTEGER;assert.deepEqual(coordinate(n-2,n),{numerator:4503599627370494,denominator:4503599627370495});});
