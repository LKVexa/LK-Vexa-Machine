# JA21 production-engine benchmark

This runner measures the JA21 2.2.2 JavaScript engine directly in Node. It reads the engine source and never modifies the console. It is a compute benchmark and does not exercise the live browser, WebView2 initialization, IndexedDB, hardware GPU, or disk persistence.

With Node available, run from a writable folder:

```powershell
node 'path-to\run-benchmark.mjs' 'path-to\JA21-Silicon-Console\applications\silicon' '.\benchmark-results.json'
```

The first argument is the extracted console's software-engine folder, and the second is the result file. Use Node 24.21.0 to match the recorded measurements. The fixture seed is fixed, all 256 input byte values occur, each workload receives three warmup batches and 25 measured batches, and the runner compares SHA-256 hashes of numerical output after every measured batch. Two fresh processes produced matching output hashes in the accompanying evidence.

Reported milliseconds are measured wall time per operation, averaged over a batch. The byte and field workloads include copying two resident fixture arrays before each operation. Fixture generation and checksum calculation are outside the timed region. The four workloads are the full byte pipeline, a lens plus forward and reverse field propagation, seven byte-plane TIFF exports, and in-memory HPU state encoding and restoration.

The source engine's `cpuCycles` and `gpuWarps` are modeled counts. They do not measure laptop CPU cycles, GPU work, or independent silicon. Windows CPU-time accounting can be coarse for short batches, so zero CPU-time samples do not indicate zero computation. Memory snapshots describe the current Node process rather than the entire computer or a minimum memory requirement. Power, temperature, and other foreground tasks were not controlled.

Passing results establish local repeatability of the observed software output. They do not establish that JA21 is a physical silicon processor, validate all mathematical models, or verify browser persistence.
