// SPDX-License-Identifier: GPL-3.0-only
/** Bounded TIFF adapter, JA21 2.2.0. No eval, codec plug-ins, external URLs or
 * automatic colour/orientation conversion. Uncompressed, one grayscale IFD;
 * u8/u16/f32/f64, II/MM, classic/BigTIFF, one or several nonoverlapping strips.
 * This deliberately rejects other TIFF profiles rather than guessing semantics.
 */
export const TIFF_LIMITS = Object.freeze({bytes:4*1024*1024,pixels:262144,tags:128,metadata:65536,description:32768});
const SIZES = Object.freeze({1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,16:8,17:8,18:8});
const TYPES = Object.freeze({u8:{Ctor:Uint8Array,bits:8,format:1,get:'getUint8',set:'setUint8'},u16:{Ctor:Uint16Array,bits:16,format:1,get:'getUint16',set:'setUint16'},f32:{Ctor:Float32Array,bits:32,format:3,get:'getFloat32',set:'setFloat32'},f64:{Ctor:Float64Array,bits:64,format:3,get:'getFloat64',set:'setFloat64'}});
const int = (v,lo,hi,label) => {if(!Number.isSafeInteger(v)||v<lo||v>hi)throw new Error(`TIFF ${label} limit`);return v;};
const align=(n,a)=>Math.ceil(n/a)*a;
function geometry(w,h){int(w,1,4096,'width');int(h,1,4096,'height');int(w*h,1,TIFF_LIMITS.pixels,'sample count');}
function dtypeOf(samples){for(const [name,t] of Object.entries(TYPES))if(samples instanceof t.Ctor)return name;throw new Error('TIFF unsupported sample dtype');}
function finite(samples){for(const x of samples)if(!Number.isFinite(x))throw new Error('TIFF nonfinite sample unsupported');}
function ascii(value){
 let text=typeof value==='string'?value:JSON.stringify(value);
 if(typeof text!=='string')throw new Error('TIFF description must be text or JSON data');
 text=text.replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 if(text.includes('\0')||text.length>TIFF_LIMITS.description)throw new Error('TIFF description limit or embedded NUL');
 return new TextEncoder().encode(text+'\0');
}
function ratio(value){if(!Array.isArray(value)||value.length!==2)throw new Error('TIFF resolution rational required');int(value[0],1,0xffffffff,'resolution');int(value[1],1,0xffffffff,'resolution');return value;}
export function encodeGrayTiff(width,height,samples,options={}) {
 geometry(width,height);const dtype=dtypeOf(samples),t=TYPES[dtype];
 if(samples.length!==width*height)throw new Error('TIFF sample shape mismatch');finite(samples);
 if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('TIFF options required');
 const {byteOrder='II',bigTiff=false,description=null,resolution=null}=options;
 if(!['II','MM'].includes(byteOrder)||typeof bigTiff!=='boolean')throw new Error('TIFF byte order or format');
 const le=byteOrder==='II',offsetSize=bigTiff?8:4,header=bigTiff?16:8,entrySize=bigTiff?20:12,countSize=bigTiff?8:2;
 const pixelBytes=samples.length*t.bits/8;
 const res=resolution===null?{x:[1,1],y:[1,1],unit:1}:resolution;
 if(!res||!Number.isInteger(res.unit)||res.unit<1||res.unit>3)throw new Error('TIFF resolution unit');ratio(res.x);ratio(res.y);
 const make=(id,type,values)=>{const bytes=new Uint8Array(SIZES[type]*values.length),v=new DataView(bytes.buffer);values.forEach((x,i)=>{if(type===3)v.setUint16(i*2,x,le);else if(type===4)v.setUint32(i*4,x,le);else if(type===16)v.setBigUint64(i*8,BigInt(x),le);else if(type===5){v.setUint32(i*8,x[0],le);v.setUint32(i*8+4,x[1],le);}});return {id,type,count:values.length,bytes};};
 const tags=[make(256,4,[width]),make(257,4,[height]),make(258,3,[t.bits]),make(259,3,[1]),make(262,3,[1]),make(273,bigTiff?16:4,[0]),make(274,3,[1]),make(277,3,[1]),make(278,4,[height]),make(279,bigTiff?16:4,[pixelBytes]),make(282,5,[res.x]),make(283,5,[res.y]),make(284,3,[1]),make(296,3,[res.unit]),make(339,3,[t.format])];
 if(description!==null){const bytes=ascii(description);tags.push({id:270,type:2,count:bytes.length,bytes});}
 tags.sort((a,b)=>a.id-b.id);
 let end=header+countSize+entrySize*tags.length+offsetSize;
 for(const tag of tags)if(tag.bytes.length>offsetSize){end=align(end,bigTiff?8:2);tag.offset=end;end+=tag.bytes.length;}
 const strip=align(end,bigTiff?8:2),total=strip+pixelBytes;int(total,1,TIFF_LIMITS.bytes,'output size');
 const stripTag=tags.find(x=>x.id===273);stripTag.bytes=make(273,stripTag.type,[strip]).bytes;
 const out=new Uint8Array(total),v=new DataView(out.buffer);
 const offset=(p,n)=>bigTiff?v.setBigUint64(p,BigInt(n),le):v.setUint32(p,n,le);
 out[0]=out[1]=le?73:77;v.setUint16(2,bigTiff?43:42,le);
 if(bigTiff){v.setUint16(4,8,le);v.setUint16(6,0,le);offset(8,header);offset(header,tags.length);}else{offset(4,header);v.setUint16(header,tags.length,le);}
 let p=header+countSize;
 for(const tag of tags){v.setUint16(p,tag.id,le);v.setUint16(p+2,tag.type,le);offset(p+4,tag.count);const slot=p+(bigTiff?12:8);if(tag.offset!==undefined){offset(slot,tag.offset);out.set(tag.bytes,tag.offset);}else out.set(tag.bytes,slot);p+=entrySize;}
 offset(p,0);for(let i=0;i<samples.length;i++)v[t.set](strip+i*t.bits/8,samples[i],le);
 return out;
}
export function decodeGrayTiff(input) {
 if(!(input instanceof Uint8Array)||input.length<8||input.length>TIFF_LIMITS.bytes)throw new Error('TIFF input size/type limit');
 const bytes=new Uint8Array(input),v=new DataView(bytes.buffer),ranges=[];
 const range=(start,len,label)=>{int(start,0,bytes.length,'offset');int(len,1,bytes.length,'range');if(len>bytes.length-start)throw new Error('TIFF truncated '+label);ranges.push({start,end:start+len,label});};
 const bounds=(start,len)=>{if(!Number.isSafeInteger(start)||!Number.isSafeInteger(len)||start<0||len<0||start>bytes.length||len>bytes.length-start)throw new Error('TIFF offset/count outside file');};
 const le=bytes[0]===73&&bytes[1]===73;if(!le&&!(bytes[0]===77&&bytes[1]===77))throw new Error('TIFF byte order');
 const version=v.getUint16(2,le),big=version===43;if(version!==42&&!big)throw new Error('TIFF version unsupported');
 if(big&&(bytes.length<16||v.getUint16(4,le)!==8||v.getUint16(6,le)!==0))throw new Error('TIFF BigTIFF header');
 const header=big?16:8,entrySize=big?20:12,countSize=big?8:2,offsetSize=big?8:4;
 function uint(p,size){bounds(p,size);if(size===8){const n=v.getBigUint64(p,le);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('TIFF integer precision limit');return Number(n);}return size===2?v.getUint16(p,le):v.getUint32(p,le);}
 range(0,header,'header');const ifd=uint(big?8:4,offsetSize);if(ifd<header||ifd%(big?8:2))throw new Error('TIFF invalid IFD offset');
 const count=int(uint(ifd,countSize),1,TIFF_LIMITS.tags,'tag count');range(ifd,countSize+count*entrySize+offsetSize,'IFD');
 if(uint(ifd+countSize+count*entrySize,offsetSize)!==0)throw new Error('TIFF multipage/chained/cyclic IFD unsupported; explicit page mapping required');
 const tags=new Map();let metadataBytes=0;
 for(let i=0;i<count;i++){
  const p=ifd+countSize+i*entrySize,id=uint(p,2),type=uint(p+2,2),n=uint(p+4,offsetSize),size=SIZES[type];
  if(tags.has(id))throw new Error('TIFF duplicate tag');if(!size||(!big&&type>=16))throw new Error('TIFF unsupported tag type');
  int(n,1,TIFF_LIMITS.metadata,'tag count');const length=n*size;metadataBytes+=length;if(metadataBytes>TIFF_LIMITS.metadata)throw new Error('TIFF metadata budget');
  const slot=p+(big?12:8),at=length>offsetSize?uint(slot,offsetSize):slot;bounds(at,length);
  if(length>offsetSize){if(at%(big?8:2))throw new Error('TIFF misaligned tag data');range(at,length,`tag ${id}`);}
  tags.set(id,{id,type,count:n,at,length,raw:bytes.slice(at,at+length)});
 }
 function values(id,allowed=[3,4,16]){const q=tags.get(id);if(!q)throw new Error(`TIFF missing tag ${id}`);if(!allowed.includes(q.type))throw new Error(`TIFF tag ${id} type unsupported`);return Array.from({length:q.count},(_,i)=>uint(q.at+i*SIZES[q.type],SIZES[q.type]));}
 const scalar=(id,fallback,allowed=[3,4,16])=>{if(!tags.has(id)&&fallback!==undefined)return fallback;const x=values(id,allowed);if(x.length!==1)throw new Error('TIFF scalar tag count');return x[0];};
 const width=scalar(256),height=scalar(257);geometry(width,height);
 const bits=scalar(258,1,[3]),format=scalar(339,1,[3]);
 const dtype=Object.keys(TYPES).find(k=>TYPES[k].bits===bits&&TYPES[k].format===format);if(!dtype)throw new Error('TIFF unsupported sample dtype');
 if(scalar(259,1,[3])!==1)throw new Error('TIFF compression unsupported');
 if(scalar(262,undefined,[3])!==1||scalar(277,1,[3])!==1||scalar(284,1,[3])!==1)throw new Error('TIFF only scalar BlackIsZero grayscale is supported');
 if(scalar(266,1,[3])!==1||scalar(317,1,[3])!==1)throw new Error('TIFF fill order/predictor unsupported');
 const orientation=scalar(274,1,[3]);int(orientation,1,8,'orientation');
 for(const id of [254,255,280,281,290,291,300,301,318,319,320,321,322,323,324,325,330,338,340,341,343,344,345,346,347,512,513,514,529,530,531,532,700,32995,32996,32997,32998,33421,33422,34665,34675,34853,40965,50710,50711,50712,50713,50714,50715,50716,50717,50718,50719,50720])if(tags.has(id))throw new Error(`TIFF semantic metadata/tag ${id} unsupported; preserve original file`);
 const rows=int(scalar(278,0xffffffff),1,0xffffffff,'rows per strip'),stripCount=Math.ceil(height/rows);
 const offsets=values(273),counts=values(279);if(offsets.length!==stripCount||counts.length!==stripCount)throw new Error('TIFF strip count mismatch');
 let total=0;const rowBytes=width*bits/8;
 for(let s=0;s<stripCount;s++){const need=Math.min(rows,height-s*rows)*rowBytes;if(counts[s]!==need)throw new Error('TIFF strip byte count mismatch');range(offsets[s],need,`strip ${s}`);total+=need;}
 ranges.sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)if(ranges[i].start<ranges[i-1].end)throw new Error('TIFF overlapping header/directory/metadata/strips');
 function resolution(id){if(!tags.has(id))return null;const q=tags.get(id);if(q.type!==5||q.count!==1)throw new Error('TIFF resolution type');const x=[uint(q.at,4),uint(q.at+4,4)];if(x[1]===0)throw new Error('TIFF resolution denominator zero');return x;}
 const calibration={x:resolution(282),y:resolution(283),unit:scalar(296,2,[3])};int(calibration.unit,1,3,'resolution unit');
 let description=null;
 if(tags.has(270)){const q=tags.get(270);if(q.type!==2||q.length>TIFF_LIMITS.description+1||q.raw.at(-1)!==0||q.raw.subarray(0,-1).some(b=>b===0||b>127))throw new Error('TIFF invalid ASCII description');description=new TextDecoder('ascii').decode(q.raw.subarray(0,-1));}
 const t=TYPES[dtype],samples=new t.Ctor(width*height);let at=0;
 for(let s=0;s<stripCount;s++)for(let p=offsets[s];p<offsets[s]+counts[s];p+=bits/8)samples[at++]=v[t.get](p,le);finite(samples);
 const known=new Set([256,257,258,259,262,266,270,273,274,277,278,279,282,283,284,296,305,306,315,317,339]);
 const opaqueTags=[...tags.values()].filter(q=>!known.has(q.id)).map(q=>({id:q.id,type:q.type,count:q.count,raw:q.raw}));
 return {width,height,dtype,samples,orientation,byteOrder:le?'II':'MM',bigTiff:big,description,calibration,opaqueTags,sourceBytes:bytes,stripCount,totalSampleBytes:total,
  equivalence:'Decoded stored sample bits only; orientation is retained, never normalized. Keep sourceBytes for exact container recovery.'};
}
