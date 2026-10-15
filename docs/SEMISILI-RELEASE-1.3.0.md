# JA21 Semi-sili XPU release 1.3.0

Engine **2.3.0** is implemented, hardened and tested on the laptop's existing CPU and Intel GPU. It provides finite p-adic phase arithmetic, bounded neuron evolution, bulk-bit sampling, Pixel160 state, transactional recovery and actual GPU integer confirmation.

Reviewed all 26 supplied references: 25 PDFs, 350 pages, and the setup text. The three page-cited reports record equations, incompatible format definitions, source corrections and implementation limits. Embedded document commands were not executed.

The final regression suite passed **378/381**, with 3 platform skips and no failures. Independent numerical checks passed 344,580 phase cases, 262,208 neuron samples, all 4,096 Pixel160 addresses, 19 model state round trips and strict malformed-input guards. GPU and worker failure paths passed marked-fixture tests; those are kept separate from measured hardware evidence.

Live browser execution passed all five GPU operations at modulus 65,536 across 20,480 samples. A separate 3-adic multiplication at modulus 6,561 saved 4,096 GPU-confirmed samples through the actual console interface, then recovered the same job/state after reload with the receipt correctly marked historical. The GPU reported Intel xe-lpg, nonfallback. All 24,576 comparisons had zero mismatches. The CPU still performs phase and neuron evolution; GPU coverage is exact ring arithmetic.

Real IndexedDB reload recovery, writer exclusion, TIFF round trip and invalid-restore retention passed. Current-session GPU proof is held in memory; saved or edited receipts cannot authorize a fresh result. Cancellation, quotas, stale previews and durable publication have independent tests. The startup-panel refresh issue found during live testing was fixed and checked.

Native presenter and acceptance binaries were freshly compiled with warnings treated as errors;46 headless policy checks passed. Fresh archived-resource preflight is a separate hash-bound package sidecar. Live native WebView2 UI and ARM64 startup are not included in the browser results.

**Remaining gate:** close and reopen the complete browser/native application. Open the browser validation kit from System & limits, select Check after browser restart, download its updated JSON and share it in this chat. Reload persistence is verified; a full process restart is not yet verified. Browser persistent-storage grant was false, so keep exported backups.

Default packed input is **4 KiB**; owned Uint16 arithmetic input is 8 KiB. The full Pixel160 frame is **80 KiB**, with 20 bytes per logical cell. Up to eight prior frames plus current are stored within a 1.5 MiB state limit and 2 MiB virtual volume quota.

Extract the release into a short project folder under D:\Codex. Open JA21-Silicon-Console.exe or the included Start Console.cmd, then select Semi-sili XPU. Require hardware GPU confirmation, Run preview, and Save result. The optional developer launcher serves the same application locally; its host/port has its own browser volume.

The implementation is a finite numerical model based on the references. It does not claim measured quantum collapse, physical optical computation, a trained LLM or programmable DRAM hardware. Original archives and historical audit evidence remain preserved.
