// @ts-nocheck
/** TIFF–GIF holographic processor commands. */
import { fail } from "./util.js";
import { Buffer } from "../buffer.js";
import { HARNESS_SOURCE } from "../chip-harness.js";
import { BYTE_STAGES } from "../byte-tables.js";

function hpuOf(ctx) {
  if (!ctx.host.hpu) return null;
  return ctx.host.hpu;
}

function touch(ctx) {
  // Validate numerical and ledger postconditions before the host publishes them.
  ctx.host.hpu.save();
  if (ctx.host.hpuTouch) ctx.host.hpuTouch();
}

function num(s, fallback) {
  const n = Number(s);
  if (s === undefined) return fallback;
  if (!Number.isFinite(n)) throw new Error('expected a finite numeric argument');
  return n;
}

function chipPath(ctx, arg, fallback, ext) {
  const path = ctx.resolve(arg || fallback);
  if (!path.startsWith("/var/hpu/")) return null;
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || base.slice(dot) !== ext || base.length > 64) return null;
  return path;
}

function harnessOk() {
  if (!HARNESS_SOURCE.includes("public byte[] Cpu(")) return false;
  if (!HARNESS_SOURCE.includes("public byte[] Gpu(")) return false;
  if (!HARNESS_SOURCE.includes("public const int Warp = 32")) return false;
  const blocks = HARNESS_SOURCE.match(/new byte\[\] \{([^}]*)\}/g);
  if (!blocks || blocks.length !== BYTE_STAGES.length) return false;
  for (let s = 0; s < BYTE_STAGES.length; s++) {
    const nums = blocks[s].slice(blocks[s].indexOf("{") + 1, blocks[s].lastIndexOf("}")).split(",");
    if (nums.length !== 256) return false;
    const table = BYTE_STAGES[s].table;
    for (let i = 0; i < 256; i++) if (Number(nums[i]) !== table[i]) return false;
  }
  return true;
}

function us(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} ms`;
  return `${n.toFixed(1)} µs`;
}

function aj(j) {
  const v = j * 1e18;
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 0.01) return `${v.toFixed(2)} aJ`;
  return `${(v * 1e3).toFixed(2)} zJ`;
}

function report(ctx, hpu, title) {
  const r = hpu._report();
  const b = r.bloch;
  ctx.stdout.write(
    [
      `\x1b[1m${title}\x1b[0m  stage ${r.stage}  cycle ${r.cycles}`,
      `  project  : ${hpu.n}×${hpu.n} complex field`,
      `  evolve   : ASM  z ${r.zMm.toFixed(2)} mm`,
      `  sample   : ${r.info} info pixels  ·  harness ${us(r.stepUs || r.sampleUs)}`,
      `  relocate : ${r.moved} carriers along −∇I`,
      `  bit line : ${r.logical0} logical 0   anti-bit : ${r.logical1} logical 1`,
      `  Flip proxy: ${aj(r.landauer)} cumulative  ·  ${r.erased} bit transitions (not measured heat)`,
      `  Bloch proxy: ${b[0].toFixed(2)}  ${b[1].toFixed(2)}  ${b[2].toFixed(2)}   purity ${r.purity.toFixed(2)}`,
      `  2-adic   : ⟨v₂⟩ ${r.padic.toFixed(2)}  on the GIF gray`,
      "",
    ].join("\n"),
  );
}

export default [
  {
    name: "hpu",
    summary: "run the software TIFF/GIF field and byte-lane simulator",
    usage: "hpu [pattern|prop|gs|gate|cycle|diffuse|bit|tiff|gif|reset]",
    async run(ctx) {
      const hpu = hpuOf(ctx);
      if (!hpu) return fail(ctx, "hpu", "no holographic processor on this host");
      const sub = (ctx.args[0] || "status").toLowerCase();
      const stdout=ctx.stdout,output=[];
      ctx={...ctx,stdout:{write:chunk=>output.push(chunk)}};
      let beforeState,beforeFiles,failed=false;
      try {
        beforeState=structuredClone({...hpu});
        beforeFiles=ctx.vfs.exportSnapshot();
        if (sub === "status") {
          const p = hpu.preview();
          ctx.stdout.write(
            [
              "\x1b[1mHPU\x1b[0m  processable hologram · TIFF phase · GIF spool",
              `  field   : ${p.n}×${p.n}  λ ${p.lambdaNm.toFixed(0)} nm  pitch ${p.pitchUm.toFixed(1)} µm`,
              `  plane   : ${p.op}`,
              `  stage   : ${p.stage}  cycle ${p.cycles}`,
              `  z       : ${p.zMm.toFixed(2)} mm`,
              `  spool   : ${p.frames} frame${p.frames === 1 ? "" : "s"}`,
              p.gate ? `  gate    : ${p.gate} → ${p.bit}` : "",
              p.nmse != null ? `  nmse    : ${p.nmse.toFixed(3)}` : "",
              p.cycles
                ? `  carriers: ${p.moved}  info ${p.info}  flip proxy ${(p.landauerJ * 1e18).toFixed(2)} aJ`
                : "",
              "  pattern aperture|grating|vortex|twin",
              "  prop [mm]    angular spectrum",
              "  gs [target] [iters]    spots|bar|ring",
              "  gate <and|or|nand|xor|xnor> <0|1> <0|1>",
              "  cycle [n]    project, evolve, sample, relocate, reproject",
              "  frame [pattern]  Gaussian interaction frame (Wigner)",
              "  record [pattern]  interfere a tilted reference into the array",
              "  replay       multiply that weight in place and drop the twin",
              "  oam <0-255>  place charge-+1 wells, LSB on the right",
              "  shift <left|right> [k]   ×2^k or integer ÷2^k",
              "  bytes [pattern]  six LUTs via scalar and batched JS, no GPU",
              "  kuramoto [n] sync phases inside 2-adic balls",
              "  diffuse [n]  walk carriers along −∇I",
              "  bit | bloch | padic",
              "  spool | tiff [path] | gif [path] | reset",
              "",
            ]
              .filter((line) => line !== "")
              .join("\n") + "\n",
          );
          return 0;
        }
        if (sub === "pattern") {
          const name = hpu.pattern(ctx.args[1] || "aperture");
          ctx.stdout.write(`phase mask set · ${name}\n`);
          touch(ctx);
          return 0;
        }
        if (sub === "prop" || sub === "propagate") {
          const mm = num(ctx.args[1], 5);
          if (mm < -80 || mm > 80) return fail(ctx, "hpu", "propagation must stay within ±80 mm");
          hpu.propagate(mm / 1e3);
          ctx.stdout.write(`ASM  ${mm.toFixed(2)} mm   z now ${(hpu.z * 1e3).toFixed(2)} mm\n`);
          touch(ctx);
          return 0;
        }
        if (sub === "gs") {
          const target = ctx.args[1] && Number.isNaN(Number(ctx.args[1])) ? ctx.args[1] : "spots";
          const iters = ctx.args[1] && !Number.isNaN(Number(ctx.args[1])) ? num(ctx.args[1], 8) : num(ctx.args[2], 8);
          const r = hpu.gerchberg(target, iters);
          ctx.stdout.write(
            `Gerchberg–Saxton  ${r.target}  ${r.iters} iters\n  NMSE ${r.nmse.toFixed(3)}  (phase mask at the SLM, intensity at focus)\n`,
          );
          touch(ctx);
          return r.nmse < 2 ? 0 : 1;
        }
        if (sub === "gate") {
          const op = ctx.args[1];
          const a = ctx.args[2];
          const b = ctx.args[3];
          if ((a !== "0" && a !== "1") || (b !== "0" && b !== "1")) {
            return fail(ctx, "hpu", "usage: hpu gate <op> <0|1> <0|1>");
          }
          const r = hpu.gate(op, Number(a), Number(b));
          const how = r.differential ? "π on input B, on-axis null test" : "in-phase focus, on-axis threshold";
          ctx.stdout.write(
            [
              `\x1b[1m${r.op.toUpperCase()}\x1b[0m ${r.a} ${r.b}  →  \x1b[38;5;79m${r.bit}\x1b[0m`,
              `  detector : ${r.detector.toFixed(3)}`,
              `  medium   : ${how}`,
              "",
            ].join("\n"),
          );
          touch(ctx);
          return 0;
        }
        if (sub === "spool") {
          const n = hpu.spool();
          ctx.stdout.write(`GIF frame ${n} spooled from the current intensity\n`);
          touch(ctx);
          return 0;
        }
        if (sub === "reset") {
          hpu._resetLedger();
          hpu.pattern("aperture");
          hpu.resetSpool();
          hpu.z = 0;
          ctx.stdout.write("processor reset · aperture · empty spool · ledger cleared\n");
          touch(ctx);
          return 0;
        }
        if (sub === "frame" || sub === "wigner" || sub === "gif-frame") {
          if (ctx.args[1]) hpu.pattern(ctx.args[1]);
          const r = hpu.frame();
          const ax = r.penteract;
          ctx.stdout.write(
            [
              `\x1b[1mGIF\x1b[0m  Gaussian interaction frame`,
              `  displacement removed : α ${r.alpha.toFixed(3)}`,
              `  residual : n̄ ${r.nbar.toFixed(3)}   Kerr χ ${r.chi.toFixed(3)}`,
              `  Wigner   : min ${r.wMin.toFixed(4)}   negative ${(r.neg * 100).toFixed(1)}%`,
              r.chi < 0.02 ? "  portrait : vacuum, no negativity" : "  portrait : non-Gaussian residual",
              `  penteract: x ${ax.x.toFixed(1)}  y ${ax.y.toFixed(1)}  z ${ax.z.toFixed(2)} mm  t ${ax.t}  ⟨v₂⟩ ${ax.p.toFixed(2)}`,
              "",
            ].join("\n"),
          );
          touch(ctx);
          return 0;
        }
        if (sub === "kuramoto") {
          const n = num(ctx.args[1], 4);
          const r = hpu.kuramoto(n);
          const ax = r.penteract;
          ctx.stdout.write(
            [
              `\x1b[1mKURAMOTO\x1b[0m  ${r.steps} steps on 2-adic balls`,
              `  order R  : ${r.order.toFixed(3)}`,
              `  Wigner   : min ${r.wMin.toFixed(4)}   negative ${(r.neg * 100).toFixed(1)}%`,
              `  penteract: x ${ax.x.toFixed(1)}  y ${ax.y.toFixed(1)}  z ${ax.z.toFixed(2)} mm  t ${ax.t}  ⟨v₂⟩ ${ax.p.toFixed(2)}`,
              "",
            ].join("\n"),
          );
          touch(ctx);
          return 0;
        }
        if (sub === "record") {
          const r = hpu.record(ctx.args[1] || "aperture");
          ctx.stdout.write(
            [
              `\x1b[1mRECORD\x1b[0m  ${r.name}`,
              "  reference : 4 px tilt, interfered in the field array",
              "  weight    : real interferogram, one cell per pixel",
              "  memory    : JavaScript allocations; no host-device transfer API",
              "",
            ].join("\n"),
          );
          touch(ctx);
          return 0;
        }
        if (sub === "replay") {
          const r = hpu.replay();
          if (!r) return fail(ctx, "hpu", "record a hologram before replay");
          ctx.stdout.write(
            [
              `\x1b[1mREPLAY\x1b[0m  ${r.name}`,
              `  MAC      : ${r.macOps.toLocaleString()} in-array products`,
              "  memory   : JavaScript allocations; no host-device transfer API",
              `  fidelity : ${r.fidelity.toFixed(3)} overlap with the recorded object`,
              "  twin     : rejected by the low-pass",
              "",
            ].join("\n"),
          );
          touch(ctx);
          return 0;
        }
        if (sub === "oam") {
          if (ctx.args[1] == null) return fail(ctx, "hpu", "usage: hpu oam <0-255>");
          const r = hpu.oam(num(ctx.args[1], 0));
          ctx.stdout.write(
            [
              `\x1b[1mOAM\x1b[0m  ${r.value} = ${r.bits}`,
              "  wells    : LSB at the right, one helical beam per 1",
              `  charge   : ℓ ${r.charge > 0 ? "+" : ""}${r.charge}`,
              "",
            ].join("\n"),
          );
          touch(ctx);
          return r.value === (num(ctx.args[1], 0) & 255) ? 0 : 1;
        }
        if (sub === "shift" || sub === "mul" || sub === "div") {
          let sign = 1;
          let kArg = ctx.args[1];
          if (sub === "div") sign = -1;
          if (sub === "shift") {
            const way = String(ctx.args[1] || "left").toLowerCase();
            if (way === "right" || way === "r") sign = -1;
            else if (way !== "left" && way !== "l") return fail(ctx, "hpu", "usage: hpu shift <left|right> [k]");
            kArg = ctx.args[2];
          }
          const r = hpu.shift(sign, num(kArg, 1));
          if (!r) return fail(ctx, "hpu", "load a value with hpu oam first");
          const op = r.sign > 0 ? `×${1 << r.k}` : `÷${1 << r.k}`;
          ctx.stdout.write(
            [
              `\x1b[1mSHIFT\x1b[0m  ${r.before} ${op} → ${r.value} = ${r.bits}`,
              `  charge   : ℓ ${r.charge > 0 ? "+" : ""}${r.charge} kept`,
              r.sign > 0 ? `  overflow : ${r.overflow}` : `  remainder: ${r.rem}`,
              "",
            ].join("\n"),
          );
          touch(ctx);
          return 0;
        }
        if (sub === "bytes" || sub === "chip") {
          if (!harnessOk()) return fail(ctx, "hpu", "byte harness does not match the six processor tables");
          if (ctx.args[1]) hpu.pattern(ctx.args[1]);
          const r = hpu.bytes();
          ctx.vfs.mkdir("/var/hpu", { recursive: true });
          const lines = [`\x1b[1mBYTES\x1b[0m  ${hpu.n * hpu.n} RAM samples · scalar JS ≡ batched JS (CPU only)`];
          for (let i = 1; i <= 7; i++) {
            const plane = hpu.tiffPlane(i);
            if (!plane) return fail(ctx, "hpu", "processor plane was not produced");
            const path = `/var/hpu/processor-${i}.tif`;
            ctx.vfs.writeFile(path, Buffer.from(plane));
            const stage = r.stages[i - 1];
            const note = stage.same ? ` · same table as ${stage.same}` : "";
            const metal = stage.cpuCycles
              ? `modeled scalar steps ${stage.cpuCycles.toLocaleString()} · JS batches ${stage.gpuWarps}`
              : "issues the agreeing byte";
            lines.push(`  ${stage.name}  ${metal}`);
            lines.push(`    owns ${stage.owned.toLocaleString()}  ${stage.changed.toLocaleString()} changed${note}`);
            lines.push(`    ${path}`);
          }
          ctx.vfs.writeFile("/var/hpu/ChipHarness.cs", HARNESS_SOURCE);
          lines.push(`  chip     : ${r.written.toLocaleString()} lit pixels took the routed phase`);
          lines.push("  harness  : /var/hpu/ChipHarness.cs wraps the six TIFFs");
          lines.push("");
          ctx.stdout.write(lines.join("\n"));
          touch(ctx);
          return r.written > 0 ? 0 : 1;
        }
        if (sub === "cycle") {
          const n = num(ctx.args[1], 1);
          hpu.cycle(n);
          report(ctx, hpu, "CYCLE");
          touch(ctx);
          return 0;
        }
        if (sub === "diffuse") {
          const n = num(ctx.args[1], 1);
          hpu.diffuse(n);
          report(ctx, hpu, "DIFFUSE");
          touch(ctx);
          return 0;
        }
        if (sub === "sample" || sub === "bit") {
          hpu.sample();
          report(ctx, hpu, "SAMPLE");
          touch(ctx);
          return 0;
        }
        if (sub === "bloch") {
          hpu.sample();
          const b = hpu.bloch;
          ctx.stdout.write(
            `Bloch  ${b[0].toFixed(3)}  ${b[1].toFixed(3)}  ${b[2].toFixed(3)}   purity ${hpu.purity.toFixed(3)}\n` +
              "  θ from the bit/anti-bit populations, φ from the info-pixel phase\n",
          );
          touch(ctx);
          return 0;
        }
        if (sub === "padic" || sub === "p-adic") {
          hpu.sample();
          ctx.stdout.write(
            `2-adic  ⟨v₂⟩ ${hpu.padic.toFixed(3)}   mean valuation of nonzero GIF samples\n` +
              "  larger v₂ means the gray level sits closer to 0 in the ultrametric\n",
          );
          touch(ctx);
          return 0;
        }
        if (sub === "tiff") {
          const path = chipPath(ctx, ctx.args[1], "/var/hpu/phase.tif", ".tif");
          if (!path) return fail(ctx, "hpu", "TIFF paths stay under /var/hpu and end in .tif");
          ctx.vfs.mkdir("/var/hpu", { recursive: true });
          const bytes = hpu.tiff();
          ctx.vfs.writeFile(path, Buffer.from(bytes));
          ctx.stdout.write(`wrote ${path}  ${bytes.length} bytes  16-bit quantized phase TIFF (LOSSY relative to complex field); use russl capture for sample-exact export\n`);
          touch(ctx);
          return 0;
        }
        if (sub === "gif") {
          const path = chipPath(ctx, ctx.args[1], "/var/hpu/spool.gif", ".gif");
          if (!path) return fail(ctx, "hpu", "GIF paths stay under /var/hpu and end in .gif");
          ctx.vfs.mkdir("/var/hpu", { recursive: true });
          if (!hpu.frames.length) hpu.spool();
          const bytes = hpu.gif();
          ctx.vfs.writeFile(path, Buffer.from(bytes));
          ctx.stdout.write(`wrote ${path}  ${bytes.length} bytes  GIF89a ×${hpu.frames.length}\n`);
          touch(ctx);
          return 0;
        }
        return fail(ctx, "hpu", "usage: hpu [pattern|prop|gs|gate|cycle|frame|record|replay|oam|shift|bytes|kuramoto|diffuse|bit|tiff|gif|reset]");
      } catch (err) {
        failed=true;
        if(beforeState){for(const key of Object.keys(hpu))if(!Object.hasOwn(beforeState,key))delete hpu[key];Object.assign(hpu,beforeState);}
        if(beforeFiles&&JSON.stringify(ctx.vfs.exportSnapshot())!==JSON.stringify(beforeFiles))ctx.vfs.importSnapshot(beforeFiles);
        return fail(ctx, "hpu", err.message || String(err));
      } finally {
        if(!failed)for(const chunk of output)stdout.write(chunk);
      }
    },
  },
];
