/** Scoped adapter derived from RUSSL corpus 2.0.0 fixed_shape_layout / WP04 / WP23.
 * Not a RUSSL parser, MSSL evaluator, RUSS executable, physical penteract or Zarr.
 * See docs/RUSSL_PIXEL_PROFILE.md for the newly defined HPU-to-atlas placement.
 * SPDX-License-Identifier: GPL-3.0-only
 */
import { encodeGrayTiff, decodeGrayTiff } from './tiff-codec.js';
import { crc32 } from './state-codec.js';
export const SHAPE=Object.freeze([4,4,4,16,16]);
export const STRIDES=Object.freeze([4096,1024,256,16,1]);
export const AXES=Object.freeze(['c4','c5','c6','c7','c8']);
export const COMPONENTS=Object.freeze(['real','imaginary','intensity','phase']);
export const SITES=16384;
export const FIELD_PROFILE='JA21-RUSSL-HPU-ATLAS/1.0';
export const FIELD_PATH='/var/hpu/russl-field.tif';
export const FIELD_FILE_LIMIT=192*1024;
function index(v,n,label){if(!Number.isInteger(v)||v<0||v>=n)throw new Error(`${label} must be an integer in [0, ${n-1}]`);return v;}
export function ordinal(indices){if(!Array.isArray(indices)||indices.length!==5)throw new Error('five integer indices required');return indices.reduce((n,v,j)=>n+index(v,SHAPE[j],AXES[j])*STRIDES[j],0);}
export function indices(k){index(k,SITES,'ordinal');return STRIDES.map((s,j)=>Math.floor(k/s)%SHAPE[j]);}
export function coordinate(i,n){if(!Number.isSafeInteger(n)||n<1)throw new Error('invalid coordinate size');index(i,n,'coordinate');if(n===1)return {numerator:0,denominator:1};let a=2n*BigInt(i)-(BigInt(n)-1n),b=BigInt(n)-1n,x=a<0n?-a:a,y=b;while(y){[x,y]=[y,x%y];}return {numerator:Number(a/x),denominator:Number(b/x)};}
export function addressDistance(a,b){indices(a);indices(b);const d=Math.abs(a-b);if(!d)return {numerator:0,denominator:1};let v=0;let q=d;while(q%2===0){q/=2;v++;}return {numerator:1,denominator:2**v};}
export function hpuPixel(indicesValue){ordinal(indicesValue);const [component,ty,tx,y,x]=indicesValue;return {component:COMPONENTS[component],x:tx*16+x,y:ty*16+y,index:(ty*16+y)*64+tx*16+x};}
export function sampleBytes(samples){if(!(samples instanceof Float64Array)||samples.length!==SITES)throw new Error('field requires exactly 16,384 f64 samples');const out=new Uint8Array(SITES*8),v=new DataView(out.buffer);for(let i=0;i<SITES;i++){if(!Number.isFinite(samples[i]))throw new Error('field nonfinite sample');v.setFloat64(i*8,samples[i],true);}return out;}
export function stableJSON(value){
 let nodes=0;
 const visit=(item,depth)=>{
  if(depth>8)throw new Error('field metadata depth limit');
  if(++nodes>2048)throw new Error('field metadata node limit');
  if(item===null||typeof item==='boolean')return JSON.stringify(item);
  if(typeof item==='number'){if(!Number.isFinite(item))throw new Error('field metadata number must be finite');return JSON.stringify(item);}
  if(typeof item==='string'){if(item.length>32768)throw new Error('field metadata text limit');return JSON.stringify(item);}
  if(typeof item!=='object')throw new Error('field metadata requires JSON data');
  if(Array.isArray(item)){
   if(item.length>128)throw new Error('field metadata array limit');
   const parts=[];for(let i=0;i<item.length;i++){if(!Object.hasOwn(item,i))throw new Error('field metadata sparse array');parts.push(visit(item[i],depth+1));}return '['+parts.join(',')+']';
  }
  if(Object.getPrototypeOf(item)!==Object.prototype&&Object.getPrototypeOf(item)!==null)throw new Error('field metadata object must be plain JSON data');
  const keys=Object.keys(item).sort();if(keys.length>128)throw new Error('field metadata key limit');
  return '{'+keys.map(k=>JSON.stringify(k)+':'+visit(item[k],depth+1)).join(',')+'}';
 };
 const out=visit(value,0);if(out.length>32768)throw new Error('field metadata text limit');return out;
}
const sampleCRC=samples=>crc32(sampleBytes(samples)).toString(16).padStart(8,'0');
function calibration(c){if(!c||Object.keys(c).sort().join(',')!=='kind,pitchMeters,wavelengthMeters,zMeters'||c.kind!=='SIMULATED'||c.pitchMeters!==8e-6||c.wavelengthMeters!==532e-9||!Number.isFinite(c.zMeters))throw new Error('field simulated calibration profile mismatch');return {...c};}
function descriptor(samples,c){return {
 profile:FIELD_PROFILE,corpus:'RUSSL-CORPUS/2.0.0',axes:[...AXES],logicalShape:[...SHAPE],strides:[...STRIDES],order:'C; c8 fastest',dtype:'f64',
 placement:{raster:[128,128],rasterOrdinal:'k=y*128+x',c4:[...COMPONENTS],hpuPixel:'y=c5*16+c7; x=c6*16+c8',hpuShape:[64,64]},
 coordinates:'normalized rational coordinates; no physical units inferred',calibration:calibration(c),
 equivalence:{classification:'LOSSLESS',domain:'finite scalar sample bits, declared axes, simulated calibration; re/im f32 widen exactly to f64',phaseDerivative:'atan2(im,re); numerical cross-platform tolerance 16*EPSILON',notIncluded:'full HPU session, byte lanes, GIF spool, runtime or executable code'},
 integrity:{algorithm:'CRC32',sampleByteOrder:'little',sampleCRC32:sampleCRC(samples),authentication:false}};}
function close(a,b){return Object.is(a,b)||Math.abs(a-b)<=16*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b));}
export function validateField(field){
 if(!field||!(field.samples instanceof Float64Array)||field.samples.length!==SITES)throw new Error('field shape/dtype mismatch');calibration(field.calibration);
 const s=field.samples;for(let j=0;j<4096;j++){
  const re=s[j],im=s[j+4096];
  if(!Number.isFinite(re)||!Number.isFinite(im)||Math.abs(re)>1e12||Math.abs(im)>1e12||!Object.is(Math.fround(re),re)||!Object.is(Math.fround(im),im))throw new Error('real/imaginary sample must be bounded, exactly representable finite f32');
  const intensity=re*re+im*im,phase=Math.atan2(im,re);
  if(!Number.isFinite(s[j+8192])||s[j+8192]<0||!Number.isFinite(s[j+12288])||Math.abs(s[j+12288])>Math.PI||!close(s[j+8192],intensity)||!close(s[j+12288],phase))throw new Error('derived intensity/phase does not agree with real/imaginary samples');
 }
 return field;
}
export function captureHpu(hpu){
 if(hpu?.n!==64||!(hpu.re instanceof Float32Array)||!(hpu.im instanceof Float32Array)||hpu.re.length!==4096||hpu.im.length!==4096)throw new Error('capture requires a 64x64 complex f32 HPU');
 const samples=new Float64Array(SITES);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const pixel=y*64+x,j=ordinal([0,y>>4,x>>4,y&15,x&15]),re=hpu.re[pixel],im=hpu.im[pixel];
  samples[j]=re;samples[j+4096]=im;samples[j+8192]=re*re+im*im;samples[j+12288]=Math.atan2(im,re);
 }
 return validateField({samples,calibration:{kind:'SIMULATED',pitchMeters:hpu.pitch,wavelengthMeters:hpu.lambda,zMeters:hpu.z}});
}
export function encodeFieldTiff(field,options={}){
 validateField(field);const bytes=encodeGrayTiff(128,128,field.samples,{...options,description:descriptor(field.samples,field.calibration),resolution:null});
 if(bytes.length>FIELD_FILE_LIMIT)throw new Error('field TIFF file limit');return bytes;
}
export function decodeFieldTiff(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>FIELD_FILE_LIMIT)throw new Error('field TIFF input limit');
 const image=decodeGrayTiff(bytes);
 if(image.width!==128||image.height!==128||image.dtype!=='f64'||image.orientation!==1||image.opaqueTags.length||image.calibration.unit!==1||stableJSON(image.calibration.x)!=='[1,1]'||stableJSON(image.calibration.y)!=='[1,1]')throw new Error('TIFF is not the supported RUSSL HPU atlas profile');
 let metadata;try{metadata=JSON.parse(image.description);}catch{throw new Error('field TIFF requires its JSON ImageDescription');}
 if(!metadata||metadata.profile!==FIELD_PROFILE)throw new Error('unknown field profile or major version');
 const c=calibration(metadata.calibration),expected=descriptor(image.samples,c);
 if(stableJSON(metadata)!==stableJSON(expected))throw new Error('field metadata, mapping or sample checksum mismatch');
 const field=validateField({samples:image.samples,calibration:c});return {...field,image,metadata};
}
export function editFieldSite(field,site,value){
 validateField(field);const k=ordinal(site);if(site[0]>1)throw new Error('intensity/phase are derived: edit c4=0 (real) or c4=1 (imaginary)');
 if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12)throw new Error('edit needs finite value within +/-1e12');
 const effective=Math.fround(value);if(Math.abs(effective)>1e12)throw new Error('rounded edit exceeds HPU range');
 const samples=field.samples.slice(),j=k%4096;samples[k]=effective;
 samples[j+8192]=samples[j]*samples[j]+samples[j+4096]*samples[j+4096];samples[j+12288]=Math.atan2(samples[j+4096],samples[j]);
 return {field:validateField({samples,calibration:{...field.calibration}}),requested:value,effective,rounded:!Object.is(value,effective),site:[...site],ordinal:k};
}
export function fieldToComplex(field){validateField(field);const re=new Float32Array(4096),im=new Float32Array(4096);for(let j=0;j<4096;j++){const p=hpuPixel(indices(j)).index;re[p]=field.samples[j];im[p]=field.samples[j+4096];}return {re,im,z:field.calibration.zMeters};}
export function fieldInfo(field){validateField(field);const ranges=COMPONENTS.map((component,c)=>{const a=field.samples.subarray(c*4096,(c+1)*4096);let min=Infinity,max=-Infinity;for(const v of a){min=Math.min(min,v);max=Math.max(max,v);}return {component,min,max};});return {profile:FIELD_PROFILE,shape:[...SHAPE],axes:[...AXES],sites:SITES,dtype:'f64',payloadBytes:SITES*8,raster:[128,128],sampleCRC32:sampleCRC(field.samples),calibration:{...field.calibration},components:ranges};}
export async function fieldReceipt(bytes){
 const field=decodeFieldTiff(bytes),raw=sampleBytes(field.samples),meta=descriptor(field.samples,field.calibration);
 if(!globalThis.crypto?.subtle)throw new Error('SHA-256 requires a secure browser context');
 const hash=async u=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',u)),x=>x.toString(16).padStart(2,'0')).join('');
 const prefix=new TextEncoder().encode('JA21-RUSSL-LOGICAL/1\0'+stableJSON(meta)+'\0'),logical=new Uint8Array(prefix.length+raw.length);logical.set(prefix);logical.set(raw,prefix.length);
 return {...fieldInfo(field),fileSHA256:await hash(field.image.sourceBytes),sampleSHA256:await hash(raw),logicalSHA256:await hash(logical),logicalDomain:'JA21-RUSSL-LOGICAL/1 + NUL + sorted descriptor JSON + NUL + LE f64 samples',authentication:false,classification:'LOSSLESS',scope:'This adapter only. Not full RUSSL, RUSS or OME-NGFF conformance.'};
}
