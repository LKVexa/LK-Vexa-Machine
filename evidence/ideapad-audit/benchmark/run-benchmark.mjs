import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import os from 'node:os';

// Read-only use of the installed engine. No simulated metric is a benchmark timer.
const engineRoot = resolve(process.argv[2] || 'D:/Codex/2026-10-13/pl/work/blank-console-arm64/project/JA21-Silicon-Console/applications/silicon');
const outputPath = resolve(process.argv[3] || 'D:/Codex/2026-10-13/pl/work/ideapad-cpu-audit/benchmark/BENCHMARK_RESULTS.json');
const enginePath = join(engineRoot, 'src/vendor/spiral/hpu.js');
const { Hpu, N, energy } = await import(pathToFileURL(enginePath).href);
const sourceSha256 = createHash('sha256').update(readFileSync(enginePath)).digest('hex');
const pkg = JSON.parse(readFileSync(join(engineRoot, 'package.json'), 'utf8'));
const started = performance.now();
const deadline = started + 45000;
const digest = (...arrays) => {
  const hash = createHash('sha256');
  for (const a of arrays) hash.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  return hash.digest('hex');
};
const percentile = (values, p) => {
  const a = [...values].sort((x,y) => x-y);
  return a[Math.max(0, Math.ceil(p * a.length) - 1)];
};

// Deterministic amplitude fixture covers all byte values, sixteen occurrences each.
// Phase is seeded with xorshift32. No Math.random or external input.
const seed = 0x4a413231;
let prng = seed;
const fixtureRe = new Float32Array(N*N), fixtureIm = new Float32Array(N*N);
for (let i=0; i<N*N; i++) {
  prng ^= prng << 13; prng ^= prng >>> 17; prng ^= prng << 5;
  const amplitude = Math.sqrt(Math.min(255, (i & 255) + .15) / 255);
  const phase = ((prng >>> 0) / 0x100000000) * 2*Math.PI - Math.PI;
  fixtureRe[i] = amplitude * Math.cos(phase);
  fixtureIm[i] = amplitude * Math.sin(phase);
}
const initialEnergy = energy(fixtureRe, fixtureIm);
const reset = hpu => { hpu.re.set(fixtureRe); hpu.im.set(fixtureIm); hpu.z = 0; };

const byteHpu = new Hpu();
const fieldHpu = new Hpu();
const tiffHpu = new Hpu();
reset(tiffHpu); tiffHpu.bytes();
const stateBytes = tiffHpu.save();
const restoreHpu = new Hpu();
let lastTiff;
const results = [];

function measure(name, batchOperations, operation, checksum, details) {
  const warmupTrials = 3, plannedMeasuredTrials = 25;
  for (let t=0; t<warmupTrials; t++) for (let i=0; i<batchOperations; i++) operation();
  const wallPerOperationMs = [], cpuPerOperationMs = [], checksums = [];
  let memoryBefore = process.memoryUsage();
  for (let t=0; t<plannedMeasuredTrials; t++) {
    if (performance.now() >= deadline) break;
    const cpu0 = process.cpuUsage(), wall0 = performance.now();
    for (let i=0; i<batchOperations; i++) operation();
    const elapsed = performance.now() - wall0;
    const cpu = process.cpuUsage(cpu0);
    wallPerOperationMs.push(elapsed / batchOperations);
    cpuPerOperationMs.push((cpu.user + cpu.system) / 1000 / batchOperations);
    // Checksum calculation is outside the timed region.
    checksums.push(checksum());
  }
  const uniqueChecksums = [...new Set(checksums)];
  const completed = wallPerOperationMs.length === plannedMeasuredTrials;
  results.push({name, ...details, warmupTrials, measuredTrials:wallPerOperationMs.length,
    plannedMeasuredTrials, batchOperations, measuredOperations:wallPerOperationMs.length*batchOperations,
    complete:completed, consistency:uniqueChecksums.length === 1 ? 'PASS' : 'FAIL',
    uniqueChecksums, wallTimeMsPerOperation:{p50:percentile(wallPerOperationMs,.5),p95:percentile(wallPerOperationMs,.95),
      minimum:Math.min(...wallPerOperationMs), maximum:Math.max(...wallPerOperationMs)},
    processCpuTimeMsPerOperation:{p50:percentile(cpuPerOperationMs,.5),p95:percentile(cpuPerOperationMs,.95)},
    samplesMsPerOperation:wallPerOperationMs, memoryBefore, memoryAfter:process.memoryUsage()});
}

measure('byte pipeline', 16, () => { reset(byteHpu); byteHpu.bytes(); },
  () => digest(byteHpu.gifRam, ...byteHpu.byteLanes, byteHpu.byteRoute, byteHpu.re, byteHpu.im),
  {operation:'restore two 4096-element Float32 fixture arrays; Hpu.bytes() samples intensity, runs six scalar and six batched byte lanes, checks equality, selects route, writes field phase',
   pointsPerOperation:N*N, laneLookupsPerOperation:12*N*N,
   simulatedCounters:{cpuCyclesPerLane:N*N*4,gpuWarpsPerLane:N*N/32},
   simulatedCounterWarning:'cpuCycles is defined as samples*4 and gpuWarps as samples/32. Neither is measured hardware activity.'});

measure('complex field lens and propagation', 6, () => {
  reset(fieldHpu); fieldHpu.lens(.05); fieldHpu.propagate(.005); fieldHpu.propagate(-.005);
}, () => digest(fieldHpu.re, fieldHpu.im),
{operation:'restore two 4096-element Float32 fixture arrays; lens(0.05m); propagate(0.005m); propagate(-0.005m)',
 pointsPerOperation:N*N, fft2CallsPerOperation:4,
 physicalInterpretation:'Numerical angular-spectrum optical field simulation; distances are model parameters, not measured laptop optics.'});

measure('seven byte-plane TIFF exports', 6, () => {
  lastTiff = Array.from({length:7}, (_,i) => tiffHpu.tiffPlane(i+1));
}, () => digest(...lastTiff),
{operation:'Hpu.tiffPlane(1..7) from a fixed resident byte-pipeline result; seven 64x64 unsigned 16-bit TIFF buffers',
 pointsPerPlane:N*N, planesPerOperation:7});

measure('HPU state encode and restore', 6, () => {
  const encoded = tiffHpu.save();
  if (!restoreHpu.load(encoded)) throw new Error('State restore refused known-valid state');
}, () => digest(restoreHpu.re, restoreHpu.im, restoreHpu.gifRam, ...restoreHpu.byteLanes, restoreHpu.byteRoute),
{operation:'Hpu.save() followed by Hpu.load() including production full-state validation; fixed stored state',
 sourceStateBytes:stateBytes.length,
 scope:'In-memory state serialization only; this does not exercise IndexedDB, browser reload or disk persistence.'});

const byteSampleCoverage = new Set(byteHpu.gifRam).size;
const cpuSample = os.cpus();
const report = {
 schema:'JA21-HOST-BENCHMARK/1', generatedAt:new Date().toISOString(), status:results.every(x=>x.complete && x.consistency==='PASS')?'PASS':'INCOMPLETE_OR_INCONSISTENT',
 runtime:{node:process.version,v8:process.versions.v8,execPath:process.execPath,platform:process.platform,architecture:process.arch,
   operatingSystemRelease:os.release(),cpuModel:cpuSample[0]?.model,logicalCpuEntries:cpuSample.length,parallelism:os.availableParallelism()},
 engine:{version:pkg.version,engineRoot,sourceSha256},
 methodology:{timer:'Node performance.now() monotonic wall clock',cpuTimer:'process.cpuUsage() user plus system CPU time for this Node process',
  percentiles:'Nearest-rank percentiles of 25 measured batch-average operation times after three warmup batches.',
  cpuAccountingCaveat:'Windows process CPU accounting can be coarse at short durations. A zero CPU-time sample is an accounting-resolution effect, not evidence of zero computation. Wall-time results are the primary performance measurements.',
  memoryCaveat:'Memory values are snapshots for this Node process, including its runtime, temporary allocations and garbage collection. They are not whole-laptop memory requirements or a leak test.',
  deterministicSeed:seed,fixtureDigest:digest(fixtureRe,fixtureIm),initialFieldEnergy:initialEnergy,
  all256InputBytesCovered:byteSampleCoverage===256,actualInputByteValues:byteSampleCoverage,
  checksums:'SHA-256 of production numerical outputs outside timed region; excludes mutable timing telemetry.',
  totalTimeLimitSeconds:45,elapsedSeconds:(performance.now()-started)/1000,
  scope:'Direct production Hpu JavaScript functions in pinned Node on this host. No browser, live WebView2, worker transport, filesystem or hardware accelerator is measured.',
  exclusions:'No hardware cycle counter, clock-frequency measurement, GPU execution, FLOPS claim, power/thermal profiling, silicon authenticity proof, or cross-machine performance guarantee.',
  conditions:'Power mode, thermal state, foreground load and antivirus activity were not controlled. These results are local observations, not a calibrated hardware comparison.'},
 results
};
writeFileSync(outputPath, JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,elapsedSeconds:report.methodology.elapsedSeconds,inputByteValues:byteSampleCoverage,
  workloads:results.map(r=>({name:r.name,p50ms:r.wallTimeMsPerOperation.p50,p95ms:r.wallTimeMsPerOperation.p95,
    measuredOperations:r.measuredOperations,consistency:r.consistency,complete:r.complete})),outputPath},null,2));
if (report.status!=='PASS') process.exitCode=1;
