# CPU identity audit — read-only findings

The integrated console contains a specialized **JavaScript field-and-byte processor model**. It performs real software computations on the Lenovo's host CPU; it does not create a physical JA21 silicon CPU, boot an ARM operating system, emulate an ARM instruction set, or implement a general-purpose instruction-set CPU.

The physical processor identified by the parent host inventory is an Intel Core Ultra 7 255U in a Lenovo 83KS / IdeaPad 5 2-in-1 16IAL10. This agent did not independently collect hardware identity; its conclusions below concern the shipped executable and source execution boundaries.

## Active execution trace

| Stage | Evidence relative to project root | Behavior |
|---|---|---|
| Native console build | `host/Build-SiliconConsole.cmd:10` | Compiles .NET Framework/WPF with `/platform:x64` and the `SiliconConsoleEntry` entry point. |
| Compiled startup | `host/SiliconConsoleEntry.cs:47`, `:50`, `:63`, `:69` | Requires 64-bit Windows process, verifies runtime seal/configuration, selects exact local origin and runs the presenter. |
| Live JavaScript runtime | `host/LiveWebBridge.cs:78`, `:182` | Hosts Microsoft WebView2 and maps `applications/silicon/dist` to the exact HTTPS virtual host. |
| Application entry | `applications/silicon/dist/index.html:2` | Loads `/src/app.js` as a JavaScript module. |
| Software worker | `applications/silicon/src/lib/ram-link.js:7`, `:29` | Constructs a JavaScript module worker and exchanges terminal messages over `MessageChannel`. |
| Shell/model initialization | `applications/silicon/src/vendor/ram-worker.js:79`, `:82`, `:84` | Constructs SPIRAL shell/VFS and an `Hpu` instance, then installs Hpu on the worker-local host object. |
| Command control | `applications/silicon/src/vendor/spiral/kernel.js:393`, `:441`, `:488` | Parses shell text, resolves a JavaScript command descriptor, and calls `descriptor.run(ctx)`. |
| Numerical processing | `applications/silicon/src/vendor/spiral/hpu.js:265`, `:266`, `:418`, `:533`, `:1155` | Computes field propagation, optical-gate models and LUT transformations using typed arrays and JavaScript loops. |
| Storage | `applications/silicon/src/vendor/ram-worker.js:12`, `:39`, `:82` | Uses bounded virtual files and IndexedDB commits; it does not expose physical machine RAM or disk devices. |

WebView2 host object exposure and web messages are explicitly disabled at `host/LiveWebBridge.cs:137–138`. The C# `ChipHarness` is **reference source exported as a VFS file**, not browser-executed native acceleration (`ChipHarness.cs:10`; `commands/hpu.js:315`). Its `Gpu` method is a nested CPU loop, which the reference source explicitly states (`ChipHarness.cs:4–6`).

The native browser presenter separately initializes a DF_Medium software VM/web-engine DLL and runs JA21 policy intermediate representation (`host/JA21VirtualBrowser.cs:3756`, `:3764`). This separate interpreter is not the software Hpu's ISA or a physical silicon CPU. Native DLL interop supplies Windows UI/loader operations, WebView2 and the software document engine.

## Implemented computation

The Hpu stores a 64 × 64 complex field in two 4,096-element Float32 arrays. It supports radix-2 Fourier propagation, Gerchberg-Saxton phase retrieval, coherent optical AND/OR/NAND/XOR/XNOR models, field sampling/relocation, geometric diffusion, Kuramoto synchronization, truncated Kerr/Wigner calculations, OAM byte encoding/shifting, model snapshots and TIFF/GIF data exports.

Each of six byte lanes applies one fixed 256-entry lookup table independently to every input byte. There are **four distinct functions**, confirmed by all 256 table inputs and SHA-256 fingerprints:

- Tables 1, 3 and 6 are identical, each with 26 possible outputs.
- Table 2 computes `(255 - 2 × input) mod 256`, producing 128 distinct outputs.
- Table 4 always returns 255.
- Table 5 always returns 0.

A seventh selector chooses the largest absolute difference between the input byte and lane output, resolving ties to the lowest lane index (`hpu.js:1207–1220`). It writes the selected byte back as field phase (`:1234–1239`). This selector is a deterministic function, not a scheduling controller with instructions or a general ALU.

There is no Hpu instruction fetch/decode loop, architectural program counter, register file, binary ISA encoding, MMU/page tables, trap/interrupt model, or general arithmetic program stream. The only control path into Hpu is JavaScript method dispatch from shell commands or explicit adapter actions. The model has arithmetic because its JavaScript implementation performs arithmetic; that does not establish an independently programmable general CPU ISA.

## Model values versus measured values

`cpuCycles` is assigned `gif.length × 4` (`hpu.js:1198`): 16,384 for a full sample. This is a fixed accounting multiplier, not measured processor cycles or an implemented four-stage instruction pipeline. `gpuWarps` is `gif.length / 32` (`:1172`, `:1199`): 128 nominal batches, executed serially in nested JavaScript loops (`:1173–1178`). No GPU compute API is invoked. `cycles` increments once per model iteration (`:714`, `:730`). `performance.now()` timing (`:644`, `:716`) measures elapsed software operation time, which can be benchmarked on this host but must not be relabeled CPU clock cycles or hardware FLOPS. Landauer values are computed from popcounted byte changes times `kB × 300 K × ln 2` (`:600`, `:637`), not measured power or heat.

The page already states software execution, CPU/no GPU API and modeled operations (`web/index.html:8`, `:19`); `xpuinfo` accurately says six identities/four distinct transformations and no measured heat/throughput (`commands/index.js:12`). These disclosures should remain.

## Active hardware design inventory

The reproducible `cpu-identity-audit.mjs` scans only active roots: `host`, `source`, `engine/df_medium/source`, `engine/ja21`, `applications/silicon/src`, `web` and `dist`. It found **zero** `.v`, `.sv`, `.vh`, `.svh`, `.vhd`, `.vhdl`, `.gds`, `.gdsii`, `.oas`, `.lef`, `.def`, `.sdc`, `.xdc`, `.spice`, `.cir`, `.bit`, `.dcp`, `.sys`, `.cu` or `.wgsl` files. Targeted active-source searches also found no `DeviceIoControl`, OpenCL/CUDA/Vulkan/WebGPU compute, FPGA bitstream programming or hardware synthesis tool call. Historical corpora, baseline virtual-machine bundles and archived research material are intentionally excluded from evidence of active hardware execution.

This file inventory and the execution trace support the software-model conclusion. They do not purport to prove that no inert document anywhere in the very large historical package mentions chips, RTL or ARM.

## Corrections recommended for a separate reviewed patch

1. **Integrated System-page startup copy is stale.** `applications/silicon/dist/index.html:19` and its source `web/index.html:19` say a local static Node server opens the app and launchers provision private Node. In the combined console, local files are mapped through WebView2; the native launcher does not use Node. Correct the integration overlay, while preserving standalone component documentation if still applicable.
2. **Startup log is ambiguous.** `host/SiliconConsoleEntry.cs:54` says “no Node/server or script interpreter.” The entry is compiled and avoids PowerShell, but JavaScript execution is required. Use explicit “compiled native startup; WebView2 executes JavaScript; no Node/local server” wording.
3. **Lane naming/comment can overstate capability.** `byte-tables.js:1` calls these “six general byte processors,” while only four fixed functions exist. Use “six lookup-table lanes; four distinct byte functions.” `hpu.js:1150–1153` labels a byte lookup/write as fetch/decode/execute/writeback; replace it with scalar lookup plus batched loop and explicitly modeled accounting. These are source comments, not currently a hidden hardware implementation.
4. **Compatibility error text uses GPU names.** `hpu.js:1158`, `:1182` says GPU warps/lane divergence although both loops execute on CPU. Prefer batched-loop terminology in visible errors. Retain serialized field names only if needed for snapshot compatibility.

The agent changed only analysis artifacts under `work/ideapad-cpu-audit`; the shipped project remains unchanged. `CPU_IDENTITY_AUDIT.json` includes table fingerprints, active scope count and exact source/dist parity for browser-shipped files. `regex-worker-node.js` is intentionally not served, excluded by `applications/silicon/scripts/build.mjs:30`.
