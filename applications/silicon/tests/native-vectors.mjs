// Optional native QA; no .NET dependency is added to the browser runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {BYTE_STAGES} from '../src/vendor/spiral/byte-tables.js';
import {Hpu} from '../src/vendor/spiral/hpu.js';

const output=path.resolve(process.argv[2]||'audit/native-vectors');
await fs.mkdir(output,{recursive:true});
let seed=0x210221;
const random=Uint8Array.from({length:4096},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
const vectors={
 enumerated:Uint8Array.from({length:4096},(_,i)=>i&255),
 reversed:Uint8Array.from({length:4096},(_,i)=>255-(i&255)),
 random,
 zero:new Uint8Array(4096),
 maximum:new Uint8Array(4096).fill(255),
};
for(const [name,input] of Object.entries(vectors)){
 const lanes=BYTE_STAGES.map(stage=>Uint8Array.from(input,b=>stage.table[b]));
 const route=Uint8Array.from(input,b=>{
  const changes=BYTE_STAGES.map(stage=>Math.abs(stage.table[b]-b));
  return changes.indexOf(Math.max(...changes))+1;
 });
 const chip=Uint8Array.from(input,(_,i)=>lanes[route[i]-1][i]);
 const h=new Hpu();h.re.fill(1);h.im.fill(0);
 // Feed raw bytes at the sample boundary; exercise the actual JavaScript lanes/export.
 h.sample=()=>{h.gifRam=input.slice();};h.bytes();
 lanes.forEach((lane,i)=>assert.deepEqual(h.byteLanes[i],lane));
 assert.deepEqual(h.byteRoute,route);
 await fs.writeFile(path.join(output,`${name}-input.bin`),input);
 await fs.writeFile(path.join(output,`${name}-route.bin`),route);
 await fs.writeFile(path.join(output,`${name}-chip.bin`),chip);
 for(let s=0;s<6;s++)await fs.writeFile(path.join(output,`${name}-lane-${s+1}.bin`),lanes[s]);
 for(let s=1;s<=7;s++)await fs.writeFile(path.join(output,`${name}-js-processor-${s}.tif`),h.tiffPlane(s));
}
await fs.writeFile(path.join(output,'vectors.json'),JSON.stringify(Object.keys(vectors),null,2)+'\n');
await fs.copyFile(new URL('../src/vendor/spiral/ChipHarness.cs',import.meta.url),path.join(output,'ChipHarness.cs'));
console.log(`Generated ${Object.keys(vectors).length} native C#/JS vectors with all 256 byte inputs.`);
