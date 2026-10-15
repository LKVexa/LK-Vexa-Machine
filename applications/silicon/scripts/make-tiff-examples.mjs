// SPDX-License-Identifier: GPL-3.0-only
/** Rebuild examples from real simulator computations; no downloads. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Hpu } from '../src/vendor/spiral/hpu.js';
import { encodeGrayTiff } from '../src/vendor/spiral/tiff-codec.js';
import { captureHpu,encodeFieldTiff,fieldReceipt,SHAPE,STRIDES } from '../src/vendor/spiral/russl-field.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'examples/tiffs'),qa=path.join(root,'audit/russl-fixtures');
await fs.mkdir(out,{recursive:true});await fs.mkdir(qa,{recursive:true});
const hpu=new Hpu();hpu.pattern('vortex');hpu.bytes();const field=captureHpu(hpu);
for(const [name,options] of [['russl-field.tif',{}],['russl-field-bigtiff.tif',{bigTiff:true}],['russl-field-big-endian.tif',{byteOrder:'MM'}]]){
 const bytes=encodeFieldTiff(field,options);await fs.writeFile(path.join(out,name),bytes);await fs.writeFile(path.join(out,name+'.receipt.json'),JSON.stringify(await fieldReceipt(bytes),null,2)+'\n');
}
await fs.writeFile(path.join(out,'phase.tif'),hpu.tiff());
for(let i=1;i<=7;i++)await fs.writeFile(path.join(out,`processor-${i}.tif`),hpu.tiffPlane(i));
const oracle=Uint16Array.from({length:16384},(_,i)=>i);
await fs.writeFile(path.join(out,'ordinal-oracle.tif'),encodeGrayTiff(128,128,oracle,{description:{profile:'JA21-RUSSL-ADDRESS-ORACLE/1',logicalShape:SHAPE,strides:STRIDES,meaning:'each sample is its row-major ordinal, not an HPU field',classification:'LOSSLESS'}}));
// Independently readable byte/JSON oracles for tests; no expected value is inferred from decoding a TIFF.
const le64=new Uint8Array(field.samples.length*8),v=new DataView(le64.buffer);field.samples.forEach((x,i)=>v.setFloat64(i*8,x,true));await fs.writeFile(path.join(qa,'expected-field-f64le.bin'),le64);
await fs.writeFile(path.join(qa,'expected-phase.json'),JSON.stringify([...hpu.phaseBytes()]));
for(let i=0;i<6;i++)await fs.writeFile(path.join(qa,`expected-processor-${i+1}.json`),JSON.stringify([...hpu.byteLanes[i]].map(x=>x*257)));
await fs.writeFile(path.join(qa,'expected-processor-7.json'),JSON.stringify([...hpu.byteRoute].map(x=>x*257)));
const files=(await fs.readdir(out)).filter(x=>x!=='SHA256SUMS.txt').sort(),hashes=[];for(const name of files){const bytes=await fs.readFile(path.join(out,name));hashes.push(createHash('sha256').update(bytes).digest('hex')+'  '+name);}await fs.writeFile(path.join(out,'SHA256SUMS.txt'),hashes.join('\n')+'\n');
console.log('Generated 12 TIFF examples, including three sample-identical field containers.');
