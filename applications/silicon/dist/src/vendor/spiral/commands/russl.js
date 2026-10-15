// SPDX-License-Identifier: GPL-3.0-only
import { fail } from './util.js';
import { russlOperation } from '../russl-service.js';
import { ordinal,indices,coordinate,addressDistance,SHAPE,STRIDES,AXES,FIELD_PATH } from '../russl-field.js';
import { decodeGrayTiff } from '../tiff-codec.js';
const number=text=>{if(typeof text!=='string'||!text.trim()||!Number.isFinite(Number(text)))throw new Error('finite numeric argument required');return Number(text);};
export default [{name:'russl',summary:'capture, inspect, edit and explicitly apply corpus-mapped TIFF pixel fields',usage:'russl info|capture|verify|hash|get c4 c5 c6 c7 c8|set c4 c5 c6 c7 c8 value|apply|import VFS.tif|inspect VFS.tif|index c4 c5 c6 c7 c8|inverse k|distance a b|layout',async run(ctx){
 try{
  if(Object.keys(ctx.flags).length)throw new Error('unsupported flag');
  const [sub='info',...args]=ctx.args;const arity=n=>{if(args.length!==n)throw new Error(`${sub} requires ${n} arguments`);};
  let result;
  if(sub==='layout'){arity(0);result={axes:AXES,shape:SHAPE,strides:STRIDES,sites:16384,formula:'k=((((c4*4+c5)*4+c6)*16+c7)*16+c8)',placement:'c4=real/imaginary/intensity/phase; HPU y=c5*16+c7, x=c6*16+c8',path:FIELD_PATH,scope:'scoped pixel adapter, not full RUSSL/MSSL execution or Zarr'};}
  else if(sub==='index'){arity(5);const site=args.map(number);result={ordinal:ordinal(site),indices:site,coordinates:site.map((v,j)=>coordinate(v,SHAPE[j]))};}
  else if(sub==='inverse'){arity(1);result={indices:indices(number(args[0]))};}
  else if(sub==='distance'){arity(2);result={distance:addressDistance(...args.map(number)),meaning:'optional ordinal 2-adic address metric; not Euclidean distance or sample-value valuation'};}
  else if(sub==='get'){arity(5);result=russlOperation(ctx,'get',{indices:args.map(number)});}
  else if(sub==='set'){arity(6);result=russlOperation(ctx,'edit',{indices:args.slice(0,5).map(number),value:number(args[5])});}
  else if(sub==='import'){arity(1);result=russlOperation(ctx,'import',{bytes:ctx.vfs.readFile(ctx.resolve(args[0]))});}
  else if(sub==='inspect'){arity(1);const image=decodeGrayTiff(ctx.vfs.readFile(ctx.resolve(args[0])));result={width:image.width,height:image.height,dtype:image.dtype,byteOrder:image.byteOrder,bigTiff:image.bigTiff,orientation:image.orientation,strips:image.stripCount,calibration:image.calibration,description:image.description,opaqueTags:image.opaqueTags.map(x=>({id:x.id,type:x.type,count:x.count})),scope:image.equivalence};}
  else if(['info','capture','verify','hash','apply'].includes(sub)){arity(0);result=await russlOperation(ctx,sub==='hash'?'receipt':sub==='verify'?'info':sub);if(sub==='verify'&&!result.present)throw new Error('no field TIFF to verify');}
  else throw new Error('unknown subcommand; run man russl');
  ctx.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
 }catch(error){return fail(ctx,'russl',error.message);}
}}];
