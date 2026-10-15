// SPDX-License-Identifier: GPL-3.0-only
/** The staged TIFF is VFS data. Only an explicit apply changes the live HPU. */
import { Hpu } from './hpu.js';
import { Buffer } from './buffer.js';
import { crc32 } from './state-codec.js';
import { captureHpu,encodeFieldTiff,decodeFieldTiff,editFieldSite,fieldToComplex,fieldInfo,fieldReceipt,ordinal,indices,coordinate,hpuPixel,FIELD_PATH,SHAPE } from './russl-field.js';
const fingerprint=b=>crc32(b).toString(16).padStart(8,'0');
function read(vfs){const bytes=vfs.readFile(FIELD_PATH);if(!(bytes instanceof Uint8Array))throw new Error('capture or import a field TIFF first');return {bytes,field:decodeFieldTiff(bytes)};}
function guard(vfs,expected){if(expected===undefined)return;if(typeof expected!=='string')throw new Error('invalid revision check');const current=vfs.exists(FIELD_PATH)?fingerprint(vfs.readFile(FIELD_PATH)):'absent';if(current!==expected)throw new Error('staged TIFF changed; refresh before retrying');}
function put(vfs,bytes){decodeFieldTiff(bytes);vfs.mkdir('/var/hpu',{recursive:true});vfs.writeFile(FIELD_PATH,Buffer.from(bytes));}
export function russlOperation({vfs,host},op,args={}) {
 if(!vfs||!host?.hpu)throw new Error('RUSSL adapter needs the virtual HPU host');
 if(op==='info'){
  if(!vfs.exists(FIELD_PATH))return {present:false,path:FIELD_PATH,revision:'absent',message:'Capture the live HPU or import a supported field TIFF.'};
  const {bytes,field}=read(vfs);return {present:true,path:FIELD_PATH,revision:fingerprint(bytes),fileBytes:bytes.length,...fieldInfo(field)};
 }
 if(op==='get'){
  const {field}=read(vfs),k=ordinal(args.indices);const value=field.samples[k];return {indices:indices(k),ordinal:k,raster:{x:k%128,y:Math.floor(k/128)},hpu:hpuPixel(args.indices),coordinates:args.indices.map((i,j)=>coordinate(i,SHAPE[j])),value,negativeZero:Object.is(value,-0)};
 }
 if(op==='receipt'){const {bytes}=read(vfs);return fieldReceipt(bytes);}
 if(op==='capture'){guard(vfs,args.expected);put(vfs,encodeFieldTiff(captureHpu(host.hpu)));return russlOperation({vfs,host},'info');}
 if(op==='import'){guard(vfs,args.expected);put(vfs,args.bytes);return {...russlOperation({vfs,host},'info'),message:'Validated field TIFF staged; live HPU unchanged.'};}
 if(op==='edit'){
  guard(vfs,args.expected);const {field}=read(vfs),edit=editFieldSite(field,args.indices,args.value);put(vfs,encodeFieldTiff(edit.field));
  return {...russlOperation({vfs,host},'info'),edit:{requested:edit.requested,effective:edit.effective,rounded:edit.rounded,ordinal:edit.ordinal},message:'Staged TIFF edited; live HPU unchanged.'};
 }
 if(op==='apply'){
  guard(vfs,args.expected);const {field}=read(vfs),complex=fieldToComplex(field),next=new Hpu();
  next.re=complex.re;next.im=complex.im;next.z=complex.z;next.op='RUSSL field apply';
  // Fresh HPU resets all derived caches, recordings, lanes, counters and spool.
  const bytes=next.save(),before={...host.hpu},oldFile=vfs.exists('/var/hpu/field.bin')?vfs.readFile('/var/hpu/field.bin'):null;
  // VFS checks quota before replacement, before mutating the live object.
  vfs.writeFile('/var/hpu/field.bin',Buffer.from(bytes));
  try{Object.assign(host.hpu,next);host.hpuTouch?.();}
  catch(error){Object.assign(host.hpu,before);if(oldFile===null)vfs.remove('/var/hpu/field.bin');else vfs.writeFile('/var/hpu/field.bin',oldFile);throw error;}
  return {applied:true,message:'Complex field applied. Derived caches, recordings, byte lanes, counters and GIF spool reset.',...russlOperation({vfs,host},'info')};
 }
 throw new Error('unsupported RUSSL adapter operation');
}
