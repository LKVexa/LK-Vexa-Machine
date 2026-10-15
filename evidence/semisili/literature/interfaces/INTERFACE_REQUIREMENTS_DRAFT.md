# Semi-sili XPU interface and verification draft

Status: research draft for the root agent's integrated specification. No production implementation is authorized by this document, and no attached document instructions have been executed.

## Target and execution model

The practical target is a RAM-resident numerical processor that uses the existing Lenovo CPU, plus its GPU when an actual compute adapter is available. Keep the existing local virtual console as the control surface. The phase and hologram are numerical data structures; hardware execution means CPU JavaScript execution or submitted WebGPU compute work, recorded separately for each stage. Ordinary laptop RAM stores those data structures. This interface does not turn DDR memory cells into a programmable in-memory accelerator.

The previous host audit identified Lenovo 83KS / IdeaPad 5 2-in-1 16IAL10 and Intel Core Ultra 7 255U, x64, 14 logical processors. The setup text and RAM sampling report discuss several different IdeaPad generations and assumed 32 GiB configurations. Their capacity, memory-bus, CPU, and efficiency claims must not replace a probe of the actual machine. Browser `hardwareConcurrency` is an environment hint, not a CPU model or exact hardware inventory.

## Reference-to-console mapping

Page numbers below are the PDFs' one-based physical pages.

| Reference | Relevant requirement | Existing console | Practical interpretation |
| --- | --- | --- | --- |
| IdeaPad Silicon Computing Setup.txt, sections "Zero-Copy Data Ingestion", "Vectorized Binarization", and "Pipeline Synthesis" | Memory-resident TIFF input, bounded LUT/neuron addressing, bit packing, deterministic output | ArrayBuffers, a bounded virtual filesystem, sample-exact RUSSL TIFF import, six byte LUTs | Preserve bounded image input and contiguous typed arrays. Linux mmap flags, AVX2 intrinsics, huge-page locking, and physical 32 GiB allocations are not browser interfaces. GPU upload/readback copies must be measured rather than labeled zero-copy. |
| IdeaPad 5i RAM Sampling.pdf, pp. 1-4 | Separates memory profiling, sample buffering, memory acquisition, and diagnostics; names VTune, PEBS, perf, and ETW/WPA | JavaScript sampled intensity and Node wall/CPU timing | Use only application-owned buffers for numerical RAM sampling. Optional PMU/ETW profiling is a separate tool, not the XPU's sample operation. Do not ingest arbitrary process or whole-system memory. The PDF's hardware table is for other IdeaPad variants. |
| RAM Neural Operation Interfaces.pdf, pp. 2-6 and 9-10 | PUM/PNM taxonomy, custom SRAM/ReRAM/DRAM execution interfaces, bank-local layouts, command registers and compiler/runtime lowering | No memory-controller, CXL, ADC, PIM register or custom driver backend | Implement logical RAM neurons as indexed tables evaluated on the existing CPU/GPU. Physical PUM described on pp. 5-6 needs programmable memory-controller hardware; specialized PNM banks need their own devices. CXL/ONNX/MLIR descriptions are architectural references, not existing console capabilities. |
| C# Hologram Computation Harness.pdf, pp. 8-12 | GPU phase/FFT pipelines, typed complex arrays, TIFF/GIF ingestion and bounded producer/consumer queues | CPU Hpu angular-spectrum field, phase retrieval, sampling and TIFF/GIF export; C# is a separate byte reference | The native proposal is ILGPU/OpenCL or CUDA/cuFFT with explicit adapter/driver selection. The Intel laptop cannot be assumed to support the NVIDIA cuFFT/NVLink path. Prefer a small WebGPU integer confirmation kernel inside the console first. Retain CPU field propagation unless a separately verified GPU FFT is added. Adopt bounded queues, explicit copies and resource disposal. |
| 1-Bit LAMB Unikernel Integration.pdf, pp. 7-10 | Word-packed bits, explicit decompression before numeric reduction, error state, and an accelerator-driver boundary | No distributed trainer, Ring-0 unikernel, NIC/RDMA or hardware driver service | Reuse explicit word packing and strict buffer ownership as numerical conventions. Do not identify bit packing as an implementation of the complete LAMB optimizer. Packed words cannot be numerically summed as if they were unpacked values. Browser workers remain normal OS applications. |
| Columned Unikernel Research Analysis.pdf, pp. 5-8 | Columnar buffers, bit packing, error/state separation and synchronized stages | Worker-owned typed arrays and a serial management RPC boundary | Use contiguous logical arrays and versioned state. There is no physical contiguous-page, pinned-DMA or Ring-0 guarantee. "LCTL" in this PDF is a research label and an architecture analogy, not a confirmed Intel browser instruction/API. |
| Holographic LLM Weight Image Processing.pdf, pp. 3-6 | Complex holographic binding, structured tensor metadata, exact high-bit-depth storage and explicit latent/image decoding | Complex 64x64 resident field and sample-exact TIFF serialization | Preserve typed shape/dtype/phase metadata and distinguish reversible full-field storage from lossy phase/GIF previews. TIFF pixels are data; they do not become executable neural code. The document's LLM, compression, optics and accuracy claims are not evidence that this console implements those systems. |

## Minimum pipeline coverage

Use a stage coverage manifest rather than one broad "XPU confirmed" flag:

1. **Phase:** existing numerical complex-field propagation/phase operations on CPU. Record the selected operations and model parameters. No claim of an optical measurement.
2. **RAM sample:** quantize the resident field into the canonical 4,096-byte sample using the existing production quantizer. Record its SHA-256 digest.
3. **Finite adic/bit representation:** apply the root specification's exact prime, precision, zero convention and packing order. Current `Hpu.padic` is only the mean v2 valuation of nonzero samples, not a full p-adic processor.
4. **RAM neurons:** evaluate a bounded, explicit connectivity/table model on the canonical sample. Record its model identifier and parameter digest. A demonstration table is not a trained neural network or a demonstrated classification accuracy.
5. **Confirmation:** independently execute the covered integer stages on the CPU and a real WebGPU adapter, then compare every result element exactly. If GPU phase/FFT work is not submitted, report phase coverage as CPU-only.
6. **Publication:** only publish a new resident result after successful validation and required confirmation. Preserve the previous valid field on mismatch, device loss, cancellation, invalid input or stale revision.

The GPU may use 32-bit storage words for portable WGSL addressing while the canonical sample remains bytes. Six 4,096-byte output lanes represent 24 KiB of logical output; a uint32-per-entry GPU representation occupies 96 KiB. Workgroup size is a dispatch setting, not evidence of a hardware warp width. The historical `gpuWarps = samples/32` and `cpuCycles = samples*4` counters must remain labeled modeled counts.

## Browser and native backend choice

WebGPU is exposed through `WorkerNavigator.gpu` in secure supporting browser contexts. The current HTTPS virtual-host mapping provides a suitable origin for secure-context APIs, but driver/browser feature availability must still be probed. [Worker WebGPU entry point](https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/gpu), [Microsoft virtual-host mapping](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content#loading-local-content-by-using-virtual-host-name-mapping).

Feature detection must inspect `globalThis.isSecureContext`, `navigator.gpu`, `requestAdapter()`, the returned adapter's limits/features, and `requestDevice()`. Do not enable unsafe browser flags or force a software fallback to produce a GPU success. Store adapter vendor/architecture/description only when exposed. `adapter.info.isFallbackAdapter` is the current property; old `adapter.isFallbackAdapter` can be used only when it actually returns a boolean. Missing fallback identity is unknown, not false. A compute result from a fallback adapter must not be called physical GPU confirmation. [Fallback identity](https://developer.mozilla.org/en-US/docs/Web/API/GPUAdapterInfo/isFallbackAdapter).

If a future native backend is justified, use an explicitly selected ILGPU OpenCL adapter compatible with the actual Intel driver. ILGPU's CPU fallback must also be labeled CPU. CUDA/cuFFT requires a compatible NVIDIA device and cannot be an unconditional dependency here. No new ILGPU, CUDA or driver package is needed for the proposed browser route. [ILGPU accelerator types](https://ilgpu.net/docs/02-beginner/01-context-and-accelerators/).

Keep shader sources as packaged, sealed JavaScript string constants loaded under the current same-origin CSP. Accept bounded numeric/model inputs only; do not accept arbitrary shader strings, native commands, device addresses or uploaded executable code. Existing local resource and navigation restrictions can remain intact. SharedArrayBuffer and physical page pinning are unnecessary; owned/transferable ArrayBuffers suffice.

## Worker contract proposal

Extend the existing `op: 'xpu'` management RPC with literal actions, not arbitrary function names:

| Action | Request | Response and behavior |
| --- | --- | --- |
| `capabilities` | no large payload | Schema/version, secure-context status, supported CPU stages, GPU API/device state, adapter metadata/fallback identity, numeric buffer limits, features and confirmation coverage. No hardware success before a real dispatch/readback test. |
| `run` | expected field revision, validated pipeline/model parameters, fixed geometry, confirmation requirement (`cpu` or `cpu-and-gpu`) | Input/output/model digests, per-stage backend, exact comparison count/mismatches, measured wall times, confirmation status and whether a state publication occurred. |
| `verify` | current field revision and bounded fixed vector selection | Same receipt schema, with fresh run ID and generation. Execute without replacing the resident field unless the root specification explicitly requests publication. |
| `receipt` | run ID | A fresh bounded JSON receipt. Hashes are integrity/identity evidence, not a trusted hardware attestation or signature. |

Use the existing worker writer lock, management serialization, 2 MiB VFS bounds and `kernel.holdCommands()` pattern. Reject new mutating jobs when a terminal command or management operation is active. Before awaiting GPU work, capture an owned immutable draft and input revision; before commit, revalidate the same worker epoch, revision and active job token. Release command holds and GPU buffers in `finally` on every outcome. The current management RPC deadline is 15 seconds; choose bounded job work inside it or provide a specific job lifecycle in the integrated spec. Do not silently extend every management request.

A cancellation request must use a separately handled validated job-control message if `rpcBusy` would otherwise reject it. Cancellation and timeout prevent late publication; they do not guarantee hardware preemption of already submitted GPU commands. Never allow a late callback to commit after a newer field, restore, reboot or cancellation. Buffer maps must be copied into owned arrays before unmapping.

Suggested receipt fields:

```json
{
  "schema": "JA21-SEMISILI-XPU-RECEIPT/1",
  "runId": "fresh-per-run",
  "workerEpoch": "current-epoch",
  "inputRevision": "expected-token",
  "model": {"id": "specified-model", "sha256": "parameter-digest"},
  "geometry": [64, 64],
  "inputSha256": "canonical-byte-sample-digest",
  "stageCoverage": [],
  "cpu": {"backend": "javascript-worker", "verified": true},
  "gpu": {"state": "NOT_RUN", "fallback": null, "apiConfirmed": false, "hardwareConfirmed": false},
  "comparison": {"elements": 0, "mismatches": 0, "status": "NOT_RUN"},
  "timing": {"wallMs": null, "gpuTimestampMs": null},
  "committed": false
}
```

These values illustrate the schema, not a test result. Supported statuses should distinguish GPU unavailable, request failure, device loss, fallback execution, unidentified adapter, shader validation failure, mismatch, cancellation, deadline and successful non-fallback GPU comparison. CPU-only execution remains usable while clearly returning GPU `NOT_RUN`; `cpu-and-gpu` required mode must return an unmet-confirmation result without publishing a claimed verified output.

WebGPU readback mapping waits for earlier buffer work; `onSubmittedWorkDone()` can throttle submissions but is not a hardware timer. Measure CPU wall work, GPU submit-to-readback wall work, and total job wall time separately. Optional `timestamp-query` measurements require an exposed supported feature; absence is null, not zero. Device loss must invalidate the device and all associated resources, retaining the last valid result. [Queue completion](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/onSubmittedWorkDone), [Device loss](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost).

## Verification strategy

- **Pure CPU numerical oracle:** root-defined formulas independently evaluated for every byte 0-255 and permitted prime/precision. Explicit zero behavior, deterministic connectivity, all-zero/all-one/alternating/seeded input, pack/unpack bijection and lowest-index tie behavior. Avoid asserting a duplicated implementation against itself.
- **GPU policy unit tests:** controlled test doubles for missing API, null adapter, fallback/unknown adapter, missing feature, rejected request, shader error, corrupt readback, map failure, device loss, timeout and cancellation. Mock success is never reported as measured hardware success.
- **Actual compute comparison:** sealed WGSL integer shader; fresh enumeration and adversarial vectors; queue submission, readback and every-element equality. Require known non-fallback identity for the physical GPU confirmation flag. Record precisely which stages ran on the GPU.
- **Worker transaction tests:** stale revisions, attempted interleaved commands, write-lock loss, rollback on mismatch, duplicate jobs, old epoch responses, cancellation during mapping, reboot/restore and late completion. Ensure the prior state survives and holds/buffers are released.
- **Persistence test:** save the complete model parameters, canonical input/output identity and field using validated bounded serialization. Reload in a real browser session and compare semantic state; device handles cannot be restored. A prior GPU receipt must be retained as historical evidence, never reused as fresh confirmation after reload.
- **Performance backtest:** warmup plus deterministic repeated workloads; p50/p95 wall time and stable hashes; separate fixture preparation, CPU work, upload/dispatch/readback, serialization and browser transport. A tiny 4 KiB workload may be slower on the GPU once transfer/dispatch costs are included. Do not promise speedup, bandwidth, energy savings or real-time deadlines before measuring them.

The existing environment blocks WebView2 initialization, so browser storage reload and actual GPU device execution remain live acceptance gates. Node can verify the CPU path and negative GPU capability handling, but it does not substitute for browser WebGPU execution. Provide an ordinary Windows-session validation action that exports a fresh JSON receipt; do not weaken system security to obtain a success.
