import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL, fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = String.raw`D:\Codex\2026-10-13\pl\work\blank-console-arm64\project\JA21-Silicon-Console\applications\silicon`;
const modulePath = name => path.join(root, 'src/vendor/spiral', name);
const {Hpu, energy} = await import(pathToFileURL(modulePath('hpu.js')));
const {BYTE_STAGES} = await import(pathToFileURL(modulePath('byte-tables.js')));
const {encodeState, decodeState} = await import(pathToFileURL(modulePath('state-codec.js')));
const {decodeGrayTiff} = await import(pathToFileURL(modulePath('tiff-codec.js')));
const oracle = JSON.parse(await fs.readFile(path.join(here, 'oracle.json'), 'utf8'));
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const started = new Date().toISOString();
const result = {profile:'JA21-IDEAPAD-INDEPENDENT-BACKTEST/1', startedUTC:started, status:'RUNNING',
  software:{console:'1.2.0',engine:'2.2.2',runtime:process.version,platform:process.platform,architecture:process.arch},
  productionRoot:root, sourceHashes:{}, oracle, counts:{}, cases:[], findings:[], failures:[],
  limits:['Runs the actual production JavaScript computation with native Node on the current laptop. It does not initialize the WebView2 UI or exercise real IndexedDB browser persistence.',
    'The preserved baseline-derived Boolean polynomial checks regression equivalence. It does not validate an independent scientific specification of arbitrary lookup lane 1.',
    'Raw RAM tests replace the HPU sample method temporarily at its input boundary. Separate field cases exercise the unmodified production sample path.',
    'Model output and operation counters are not measured transistor count, processor clocks, physical energy, quantum computation or evidence of fabricated JA21 silicon.']};
for (const name of ['hpu.js','byte-tables.js','state-codec.js','tiff-codec.js']) result.sourceHashes[name] = digest(await fs.readFile(modulePath(name)));
for (const key of ['exhaustiveLaneComparisons','exhaustiveSelectorComparisons','rawRAMDatasets','rawLaneByteComparisons','rawSelectorByteComparisons','fieldDatasets','fieldSampleByteComparisons','fieldLaneByteComparisons','fieldSelectorByteComparisons','stateRoundTrips','malformedStateRejections','rejectionStateUnchangedChecks','tiffPixelsDecoded','tiffsForIndependentReader','oamRoundTrips','oamShiftCases','gateTruthCases','analyticPropagationCases','propagationReversibilityCases','resetCases','deterministicReplayCases']) result.counts[key]=0;
const expected = Array.from({length:6},(_,lane) => Uint8Array.from({length:256},(_,b) => {
  let out=0;
  for(let bit=0;bit<8;bit++) {
    let y=0;
    for(const mask of oracle.polynomials[lane][bit]) if((b&mask)===mask) y^=1;
    out |= y<<bit;
  }
  return out;
}));
// Independent arithmetic identities and farthest-selector threshold oracle.
for(let b=0;b<256;b++) {
  assert.equal(expected[1][b], (255-2*b)&255);
  assert.equal(expected[3][b],255); assert.equal(expected[4][b],0);
  for(let lane=0;lane<6;lane++) {assert.equal(BYTE_STAGES[lane].table[b],expected[lane][b]); result.counts.exhaustiveLaneComparisons++;}
  const sorted = expected.map((table,i)=>({route:i+1,value:table[b],distance:Math.abs(table[b]-b)})).sort((a,c)=>c.distance-a.distance||a.route-c.route);
  assert.equal(sorted[0].value,b<128?255:0);
  result.counts.exhaustiveSelectorComparisons++;
}
const winning = Uint8Array.from({length:256},(_,b) => {
  const items=expected.map((t,i)=>({route:i+1,d:Math.abs(t[b]-b)})).sort((a,c)=>c.d-a.d||a.route-c.route);
  return items[0].route;
});
const routeHistogram=Array(7).fill(0); for(const r of winning)routeHistogram[r]++;
result.findings.push({claim:'Selector output is a one-bit intensity threshold for every possible input byte.',
  independentExpression:'selected(b) = 255 when b < 128, otherwise 0',
  routeHistogramAll256:routeHistogram.slice(1),neverSelectedRoutes:[3,6],verifiedAllInputs:true});
function rng(seed) {let x=seed>>>0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};}
const rawCases = [
  ['all-zero',new Uint8Array(4096)],['all-255',new Uint8Array(4096).fill(255)],
  ['all-127',new Uint8Array(4096).fill(127)],['all-128',new Uint8Array(4096).fill(128)],
  ['ascending',Uint8Array.from({length:4096},(_,i)=>i%256)],
  ['descending',Uint8Array.from({length:4096},(_,i)=>255-i%256)],
  ['checkerboard-extremes',Uint8Array.from({length:4096},(_,i)=>((i%64+Math.floor(i/64))%2)*255)],
  ['impulse',Uint8Array.from({length:4096},(_,i)=>i===2079?255:0)],
  ['boundaries',Uint8Array.from({length:4096},(_,i)=>[0,1,126,127,128,129,254,255][i%8])],
];
for(let seed=1;seed<=64;seed++){const r=rng(0x1dea5100+seed);rawCases.push([`seeded-${seed}`,Uint8Array.from({length:4096},()=>r()&255)]);}
await fs.mkdir(path.join(here,'tiffs'),{recursive:true});
const tiffManifest=[];
function lanesAndRoute(h,input,kind){
  for(let lane=0;lane<6;lane++)for(let i=0;i<4096;i++) {assert.equal(h.byteLanes[lane][i],expected[lane][input[i]]);result.counts[kind+'LaneByteComparisons']++;}
  for(let i=0;i<4096;i++) {
    assert.equal(h.byteRoute[i],winning[input[i]]);
    assert.equal(h.byteLanes[h.byteRoute[i]-1][i],input[i]<128?255:0);
    result.counts[kind+'SelectorByteComparisons']++;
  }
  const owners=Array(6).fill(0);for(const r of h.byteRoute)owners[r-1]++;
  assert.deepEqual(h.byteStages.slice(0,6).map(s=>s.owned),owners);
  assert(h.byteStages.every(s=>s.equivalent===true));
}
async function stateRoundTrip(h,label) {
  const saved=h.save(), fresh=new Hpu(); assert.equal(fresh.load(saved),true);
  assert.deepEqual(fresh.save(),saved);result.counts.stateRoundTrips++;
  const stateDigest=digest(saved);
  assert.equal(digest(h.save()),stateDigest);
  result.cases.push({kind:'state',name:label,bytes:saved.length,sha256:stateDigest});
  return {saved,fresh};
}
for(let index=0;index<rawCases.length;index++) {
  const [name,input]=rawCases[index],h=new Hpu();h.re.fill(1);h.im.fill(0);
  h.sample=()=>{h.gifRam=input.slice();}; h.bytes();delete h.sample;
  lanesAndRoute(h,input,'raw');result.counts.rawRAMDatasets++;
  await stateRoundTrip(h,'raw-'+name);
  if(index<9) {
    for(let plane=1;plane<=7;plane++) {
      const tiff=h.tiffPlane(plane),decoded=decodeGrayTiff(tiff),pixels=decoded.samples;
      for(let i=0;i<4096;i++)assert.equal(pixels[i],257*(plane===7?winning[input[i]]:expected[plane-1][input[i]]));
      result.counts.tiffPixelsDecoded+=4096;
      const filename=`${name}-processor-${plane}.tif`, expectedFile=`${name}-processor-${plane}.u16le`;
      const samples=new Uint8Array(8192),view=new DataView(samples.buffer);
      for(let i=0;i<4096;i++)view.setUint16(i*2,257*(plane===7?winning[input[i]]:expected[plane-1][input[i]]),true);
      await fs.writeFile(path.join(here,'tiffs',filename),tiff);await fs.writeFile(path.join(here,'tiffs',expectedFile),samples);
      tiffManifest.push({filename,expectedFile,width:64,height:64,pixels:4096,sha256:digest(tiff),expectedSHA256:digest(samples)});
      result.counts.tiffsForIndependentReader++;
    }
  }
}
// Full complex field -> actual production intensity sampling -> lanes -> selector -> phase.
const fieldCases=[['zero',h=>h.clear()],['flat',h=>{h.re.fill(1);h.im.fill(0);}],
  ['tiny-floor',h=>{h.re.fill(1e-7);h.im.fill(0);}],['single-impulse',h=>{h.clear();h.re[2079]=1;}],
  ...['aperture','grating','vortex','twin'].map(n=>[n,h=>h.pattern(n)])];
for(let seed=1;seed<=32;seed++)fieldCases.push([`complex-seed-${seed}`,h=>{const r=rng(0x510000+seed);for(let i=0;i<4096;i++){h.re[i]=((r()/4294967296)-.5)*4;h.im[i]=((r()/4294967296)-.5)*4;}}]);
for(const [name,prepare] of fieldCases) {
  const h=new Hpu();prepare(h);
  const re0=h.re.slice(),im0=h.im.slice();
  const intensities=Array.from(re0,(r,i)=>Math.fround(r*r+im0[i]*im0[i]));
  const largest=Math.max(1e-12,...intensities);
  const sample=Uint8Array.from(intensities,i=>Math.min(255,Math.max(0,Math.round(i/largest*255))));
  h.bytes();
  for(let i=0;i<4096;i++){assert.equal(h.gifRam[i],sample[i]);result.counts.fieldSampleByteComparisons++;}
  lanesAndRoute(h,sample,'field');result.counts.fieldDatasets++;
  for(let i=0;i<4096;i++){
    const originalAmp=Math.hypot(re0[i],im0[i]),after=Math.hypot(h.re[i],h.im[i]);
    assert(Math.abs(after-originalAmp)<=3e-7*Math.max(1,originalAmp));
    if(originalAmp>=1e-6){assert(Math.abs(h.im[i])<=1e-12);assert(h.re[i]<=0);}
  }
  await stateRoundTrip(h,'field-'+name);
  h.clear();assert(h.re.every(v=>v===0)&&h.im.every(v=>v===0));assert.equal(h.byteLanes,null);assert.equal(h.byteRoute,null);result.counts.resetCases++;
}
// Truncated/corrupted inputs and coherent-but-forged state must preserve all resident state.
const victim=new Hpu();victim.pattern('vortex');victim.bytes();victim.spool();const valid=victim.save();
const malformed=[new Uint8Array(),valid.slice(0,11),valid.slice(0,100),valid.slice(0,-1),new Uint8Array(1048590)];
for(const index of [0,1,4,8,12,Math.floor(valid.length/2),valid.length-1]){const bytes=valid.slice();bytes[index]^=1;malformed.push(bytes);}
const mutations=[s=>{s.n=63;},s=>{s.re=new Float32Array(4095);},s=>{s.cycles=-1;},s=>{s.cycles=.5;},s=>{s.pitch=1;},s=>{s.bloch=[1,1,1];},s=>{s.byteLanes[0][0]^=1;},s=>{s.byteRoute[0]=0;},s=>{s.byteStages[0].owned++;},s=>{s.byteStages[0].cpuCycles=1;},s=>{s.byteStages[0].equivalent=false;},s=>{s.byteStages[6].unique++;},s=>{s.re[0]=1e13;},s=>{s.objectRe=new Float32Array(4096);},s=>{s.frames=Array.from({length:25},()=>new Uint8Array(4096));}];
for(const mutate of mutations){const s=decodeState(valid);mutate(s);try{malformed.push(encodeState(s));}catch {result.counts.malformedStateRejections++;}}
for(const bytes of malformed){assert.equal(victim.load(bytes),false);result.counts.malformedStateRejections++;assert.deepEqual(victim.save(),valid);result.counts.rejectionStateUnchangedChecks++;}
// Exhaustive arithmetic encoding/readback and independent integer shift identities.
const arithmetic=new Hpu();
for(let b=0;b<256;b++){
  assert.equal(arithmetic.oam(b).value,b);result.counts.oamRoundTrips++;
  for(let shift=1;shift<=7;shift++){
    arithmetic.oam(b);const left=arithmetic.shift(1,shift);
    assert.equal(left.value,(b*2**shift)%256);assert.equal(left.overflow,b>=2**(8-shift)?1:0);assert.equal(left.rem,0);
    arithmetic.oam(b);const right=arithmetic.shift(-1,shift);
    assert.equal(right.value,Math.floor(b/2**shift));assert.equal(right.rem,b%2**shift);assert.equal(right.overflow,0);
    result.counts.oamShiftCases+=2;
  }
}
const boolRules={and:(a,b)=>a&&b,or:(a,b)=>a||b,nand:(a,b)=>!(a&&b),xor:(a,b)=>a!==b,xnor:(a,b)=>a===b};
for(const [name,fn] of Object.entries(boolRules))for(let a=0;a<2;a++)for(let b=0;b<2;b++){assert.equal(new Hpu().gate(name,a,b).bit,Number(fn(a,b)));result.counts.gateTruthCases++;}
// Analytic single spatial Fourier modes test propagation without another FFT implementation.
let maxAnalyticAbsoluteError=0,maxReversalAbsoluteError=0,maxRelativeEnergyError=0;
for(const [mx,my] of [[0,0],[1,0],[0,1],[1,-2],[3,5],[17,-19],[31,31]])for(const distance of [0,.0006,-.0006,.012]){
  const h=new Hpu();for(let y=0;y<64;y++)for(let x=0;x<64;x++){const phase=2*Math.PI*(mx*x+my*y)/64,i=y*64+x;h.re[i]=Math.cos(phase);h.im[i]=Math.sin(phase);}
  h.propagate(distance);
  const kz=Math.sqrt((2*Math.PI/h.lambda)**2-4*Math.PI**2*((mx/(64*h.pitch))**2+(my/(64*h.pitch))**2));
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const phase=2*Math.PI*(mx*x+my*y)/64+distance*kz,i=y*64+x;maxAnalyticAbsoluteError=Math.max(maxAnalyticAbsoluteError,Math.abs(h.re[i]-Math.cos(phase)),Math.abs(h.im[i]-Math.sin(phase)));}
  assert(maxAnalyticAbsoluteError<1e-5);result.counts.analyticPropagationCases++;
}
for(let seed=1;seed<=12;seed++){
  const h=new Hpu(),r=rng(0x21ab00+seed);for(let i=0;i<4096;i++){h.re[i]=(r()/4294967296)-.5;h.im[i]=(r()/4294967296)-.5;}
  const re=h.re.slice(),im=h.im.slice(),originalEnergy=energy(re,im);
  h.propagate(.0006);const e=energy(h.re,h.im);maxRelativeEnergyError=Math.max(maxRelativeEnergyError,Math.abs(e-originalEnergy)/originalEnergy);
  h.propagate(-.0006);for(let i=0;i<4096;i++)maxReversalAbsoluteError=Math.max(maxReversalAbsoluteError,Math.abs(h.re[i]-re[i]),Math.abs(h.im[i]-im[i]));
  assert(maxReversalAbsoluteError<1e-5);assert(maxRelativeEnergyError<1e-5);result.counts.propagationReversibilityCases++;
}
// State-dependent repeated execution must reproduce data even though wall-clock ledgers differ.
function logicalState(h){const s=decodeState(h.save());s.sampleUs=0;s.stepUs=0;return encodeState(s);}
for(const name of ['aperture','grating','vortex','twin']){
  const h=new Hpu();h.pattern(name);const seed=h.save(),outputs=[];
  for(let repeat=0;repeat<4;repeat++){assert(h.load(seed));h.propagate(.0006);h.sample();h.relocate();h.bytes();h.spool();outputs.push(logicalState(h));}
  for(let i=1;i<outputs.length;i++){assert.deepEqual(outputs[i],outputs[0]);result.counts.deterministicReplayCases++;}
}
result.propagation={maxAnalyticAbsoluteError,maxReversalAbsoluteError,maxRelativeEnergyError,tolerance:1e-5};
result.status='PASS';result.finishedUTC=new Date().toISOString();result.runnerSHA256=digest(await fs.readFile(fileURLToPath(import.meta.url)));result.oracleSHA256=digest(await fs.readFile(path.join(here,'oracle.json')));
await fs.writeFile(path.join(here,'tiffs','manifest.json'),JSON.stringify(tiffManifest,null,2)+'\n');
await fs.writeFile(path.join(here,'BACKTEST_RESULTS.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,counts:result.counts,propagation:result.propagation,selectorFinding:result.findings[0]}));
