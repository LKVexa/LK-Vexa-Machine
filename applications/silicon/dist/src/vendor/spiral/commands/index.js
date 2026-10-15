// @ts-nocheck
import system from "./system.js";
import fsCmds from "./fs.js";
import coreutils from "./coreutils.js";
import browser from "./browser.js";
import ram from "./ram.js";
import hpu from "./hpu.js";
import russl from "./russl.js";
import semisili from "./semisili.js";

export default [...system, ...fsCmds, ...coreutils, ...browser, ...ram, ...hpu, ...russl, ...semisili,
  { name: "sync", summary: "flush and verify the IndexedDB write transaction", usage: "sync", async run(ctx) { if (!ctx.host.sync) throw new Error("persistence unavailable"); await ctx.host.sync(); ctx.stdout.write("Volume transaction committed. Keep an exported backup.\n"); return 0; } },
  { name: "xpuinfo", summary: "show processor backends and validation coverage", usage: "xpuinfo", async run(ctx) { ctx.stdout.write("Field: 64 x 64 complex Float32 samples\nLegacy byte paths: scalar and 32-wide batched JavaScript CPU loops; neither uses a GPU API\nLegacy byte lanes: six LUT identities, four distinct transformations, one deterministic selector\nSemi-sili XPU: CPU phase arithmetic, neuron evolution, and validated Pixel160 state\nGPU coverage: WebGPU independently confirms finite ring arithmetic when hardware dispatch and readback succeed\nRun xpu info for current capability and receipts; run xpu help for preview and explicit save commands\nTIFF adapters: RUSSL 16,384 f64 scalar-site atlas; semi-sili Pixel160 canonical word storage\nFLOP-equivalent, Landauer, Bloch, and logical-cycle values are models, not measured hardware throughput or heat\n"); return 0; } }
];
