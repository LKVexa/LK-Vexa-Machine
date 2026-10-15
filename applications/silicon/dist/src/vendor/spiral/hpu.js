import { encodeGrayTiff } from './tiff-codec.js';
import { encodeState, decodeState } from './state-codec.js';
// @ts-nocheck
/**
 * TIFF–GIF holographic processor.
 * A 64×64 complex field is the SLM. Propagation is the sampled angular
 * spectrum method on the sampled grid. Phase masks leave as 16-bit TIFF. Temporal frames leave
 * as a GIF89a spool. Logic is coherent interference at a shared focus.
 */
import { BYTE_STAGES } from "./byte-tables.js";
export const N = 64;
export const PITCH = 8e-6;
export const LAMBDA = 532e-9;
const FOCUS_Z = 0.012;
/** One free-space step of the processable cycle. Metres. */
const CAVITY_Z = 0.0006;
const K_B = 1.380649e-23;
const T_K = 300;
/** Landauer cost of erasing one classical bit at 300 K. */
export const LANDAUER = K_B * T_K * Math.LN2;

function fft1(re, im, n, sign) {
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + half] * wr - im[i + k + half] * wi;
        const vi = re[i + k + half] * wi + im[i + k + half] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const nr = wr * wlenRe - wi * wlenIm;
        wi = wr * wlenIm + wi * wlenRe;
        wr = nr;
      }
    }
  }
  if (sign < 0) {
    const inv = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= inv;
      im[i] *= inv;
    }
  }
}

function fft2(re, im, n, sign) {
  const rowRe = new Float32Array(n);
  const rowIm = new Float32Array(n);
  for (let y = 0; y < n; y++) {
    const o = y * n;
    rowRe.set(re.subarray(o, o + n));
    rowIm.set(im.subarray(o, o + n));
    fft1(rowRe, rowIm, n, sign);
    re.set(rowRe, o);
    im.set(rowIm, o);
  }
  const colRe = new Float32Array(n);
  const colIm = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      colRe[y] = re[y * n + x];
      colIm[y] = im[y * n + x];
    }
    fft1(colRe, colIm, n, sign);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = colRe[y];
      im[y * n + x] = colIm[y];
    }
  }
}

function rot(re, im, i, phase) {
  const c = Math.cos(phase);
  const s = Math.sin(phase);
  const r = re[i];
  const m = im[i];
  re[i] = r * c - m * s;
  im[i] = r * s + m * c;
}

export function v2(x) {
  if (!Number.isInteger(x) || x < 0 || x > 0xffffffff) throw new RangeError('valuation requires uint32');
  let n = x >>> 0;
  if (!n) return Infinity;
  let v = 0;
  while ((n & 1) === 0) {
    n >>>= 1;
    v += 1;
  }
  return v;
}

function pop8(x) {
  let n = x & 255;
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

export function energy(re, im) {
  let s = 0;
  for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i];
  return s;
}

const FOCK = 10;
const FACT = [1];
for (let i = 1; i <= FOCK; i++) FACT[i] = FACT[i - 1] * i;

function stepCount(value,limit) {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value)) throw new RangeError('step count must be a finite integer');
  return Math.max(1,Math.min(limit,value));
}

function hermite(n, x) {
  if (n === 0) return 1;
  if (n === 1) return 2 * x;
  let h0 = 1;
  let h1 = 2 * x;
  for (let k = 1; k < n; k++) {
    const h2 = 2 * x * h1 - 2 * k * h0;
    h0 = h1;
    h1 = h2;
  }
  return h1;
}

function psiAt(cs, x) {
  const e = Math.exp(-0.5 * x * x);
  let re = 0;
  let im = 0;
  for (let n = 0; n < cs.length; n++) {
    const phi = (e * hermite(n, x)) / Math.sqrt(Math.sqrt(Math.PI) * 2 ** n * FACT[n]);
    re += cs[n].re * phi;
    im += cs[n].im * phi;
  }
  return { re, im };
}

/** Kerr on a coherent state: the non-Gaussian residual of the interaction frame. */
export function kerrCoherent(betaRe, betaIm, chi) {
  if (![betaRe,betaIm,chi].every(Number.isFinite) || Math.hypot(betaRe,betaIm) > 8 || Math.abs(chi) > 100) throw new RangeError('Kerr model parameter limit');
  const amp2 = betaRe * betaRe + betaIm * betaIm;
  const norm = Math.exp(-amp2 / 2);
  const cs = [];
  let br = 1;
  let bi = 0;
  for (let k = 0; k <= FOCK; k++) {
    const phase = (-chi * k * (k - 1)) / 2;
    const pr = Math.cos(phase);
    const pi = Math.sin(phase);
    const scale = norm / Math.sqrt(FACT[k]);
    cs.push({ re: scale * (br * pr - bi * pi), im: scale * (br * pi + bi * pr) });
    const nr = br * betaRe - bi * betaIm;
    bi = br * betaIm + bi * betaRe;
    br = nr;
  }
  const retained = cs.reduce((a,c) => a + c.re*c.re + c.im*c.im, 0);
  const scale = Math.sqrt(retained);
  for (const c of cs) { c.re /= scale; c.im /= scale; }
  Object.defineProperty(cs, 'truncationLoss', { value: Math.max(0, 1-retained) });
  return cs;
}

/** Wigner function of a truncated pure state, by the wavefunction overlap. */
export function wignerGrid(cs, grid, span) {
  if (!Array.isArray(cs) || cs.length < 1 || cs.length > FOCK + 1 || cs.some(c => !c || !Number.isFinite(c.re) || !Number.isFinite(c.im) || Math.hypot(c.re,c.im) > 1.000001)) throw new RangeError('invalid truncated state');
  if (!Number.isInteger(grid) || grid < 1 || grid > 64 || !Number.isFinite(span) || span <= 0 || span > 8) throw new RangeError('Wigner geometry limit');
  const out = new Float32Array(grid * grid);
  const yN = 48;
  const yMax = 5;
  const dy = (2 * yMax) / yN;
  for (let iy = 0; iy < grid; iy++) {
    const p = -span + ((iy + 0.5) * (2 * span)) / grid;
    for (let ix = 0; ix < grid; ix++) {
      const q = -span + ((ix + 0.5) * (2 * span)) / grid;
      let acc = 0;
      for (let j = 0; j < yN; j++) {
        const y = -yMax + (j + 0.5) * dy;
        const a = psiAt(cs, q + y);
        const b = psiAt(cs, q - y);
        const cr = a.re * b.re + a.im * b.im;
        const ci = a.im * b.re - a.re * b.im;
        const c = Math.cos(2 * p * y);
        const s = Math.sin(2 * p * y);
        acc += (cr * c + ci * s) * dy;
      }
      out[iy * grid + ix] = acc / Math.PI;
    }
  }
  return out;
}

/** The stored lanes match both a scalar walk and a 32-wide warp walk, and the route is the farthest move. */
function lanesAgree(sample, lanes, route) {
  const n = sample.length;
  if (n % 32 !== 0 || lanes.length !== 6 || route.length !== n) return false;
  for (let s = 0; s < 6; s++) {
    const table = BYTE_STAGES[s].table;
    const lane = lanes[s];
    if (!lane || lane.length !== n) return false;
    for (let i = 0; i < n; i++) if (lane[i] !== table[sample[i]]) return false;
    for (let w = 0; w < n / 32; w++) {
      const base = w * 32;
      for (let t = 0; t < 32; t++) {
        const i = base + t;
        if (lane[i] !== table[sample[i]]) return false;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    let best = -1;
    let pick = 0;
    for (let s = 0; s < 6; s++) {
      const delta = Math.abs(lanes[s][i] - sample[i]);
      if (delta > best) {
        best = delta;
        pick = s;
      }
    }
    if (route[i] !== pick + 1) return false;
  }
  return true;
}

export class Hpu {
  constructor() {
    this.n = N;
    this.pitch = PITCH;
    this.lambda = LAMBDA;
    this.z = 0;
    this.op = "idle";
    this.gateLabel = "";
    this.bit = null;
    this.detector = 0;
    this.nmse = null;
    this.frames = [];
    this.re = new Float32Array(N * N);
    this.im = new Float32Array(N * N);
    this._resetLedger();
    this.pattern("aperture");
  }

  _resetLedger() {
    this.cycles = 0;
    this.stage = "idle";
    this.info = 0;
    this.moved = 0;
    this.logical1 = 0;
    this.erased = 0;
    this.landauer = 0;
    this.sampleUs = 0;
    this.stepUs = 0;
    this.padic = 0;
    this.margin = 0;
    this.bloch = [0, 0, 1];
    this.purity = 1;
    this.gifRam = null;
    this.ramI = null;
    this.wigner = null;
    this.wignerN = 0;
    this.wMin = 0;
    this.wNeg = 0;
    this.gifAlpha = 0;
    this.gifChi = 0;
    this.gifNbar = 0;
    this.orderR = 0;
    this.penteract = null;
    this.recorded = "";
    this.objectRe = null;
    this.objectIm = null;
    this.fidelity = null;
    this.macOps = 0;
    this.oamValue = null;
    this.oamBits = "";
    this.oamCharge = 0;
    this.oamRem = 0;
    this.oamOverflow = 0;
    this.byteStages = null;
    this.byteWritten = 0;
    this.byteRoute = null;
    this.byteLanes = null;
  }

  clear() {
    this._invalidateBytes();
    this.re.fill(0);
    this.im.fill(0);
  }

  pattern(name) {
    const requested = name || "aperture";
    if (!["aperture", "grating", "vortex", "twin"].includes(requested)) {
      throw new Error(`unknown pattern ${requested}`);
    }
    this.clear();
    this.wigner = null;
    this.recorded = "";
    this.objectRe = null;
    this.objectIm = null;
    this.fidelity = null;
    this.oamValue = null;
    this.oamBits = "";
    this.byteStages = null;
    this.byteWritten = 0;
    this.byteRoute = null;
    this.byteLanes = null;
    this.z = 0;
    this.nmse = null;
    this.gateLabel = "";
    this.bit = null;
    const n = this.n;
    const mid = n >> 1;
    const disk = (cx, cy, rad, phase) => {
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= rad * rad) {
            const i = y * n + x;
            this.re[i] = c;
            this.im[i] = s;
          }
        }
      }
    };
    if (name === "grating") {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if ((x & 3) < 2) this.re[y * n + x] = 1;
        }
      }
    } else if (name === "vortex") {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = x - mid;
          const dy = y - mid;
          const r = Math.hypot(dx, dy);
          if (r < 18 && r > 2) {
            const amp = Math.exp(-((r - 10) ** 2) / 40);
            const ph = Math.atan2(dy, dx);
            const i = y * n + x;
            this.re[i] = amp * Math.cos(ph);
            this.im[i] = amp * Math.sin(ph);
          }
        }
      }
    } else if (name === "twin") {
      disk(22, mid, 6, 0);
      disk(42, mid, 6, 0);
    } else {
      disk(mid, mid, 10, 0);
    }
    this.op = requested;
    return requested;
  }

  lens(f) {
    if (!Number.isFinite(f) || Math.abs(f) < 1e-9 || Math.abs(f) > 1) throw new RangeError('invalid focal length');
    this._invalidateBytes();
    const n = this.n;
    const mid = n >> 1;
    const k = (2 * Math.PI) / this.lambda;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = (x - mid) * this.pitch;
        const dy = (y - mid) * this.pitch;
        rot(this.re, this.im, y * n + x, (-k * (dx * dx + dy * dy)) / (2 * f));
      }
    }
  }

  _steer(cx, z) {
    const n = this.n;
    const mid = n >> 1;
    const k = (2 * Math.PI) / this.lambda;
    const per = (k * ((mid - cx) * this.pitch) * this.pitch) / z;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x - cx;
        const dy = y - mid;
        if (dx * dx + dy * dy > 36) continue;
        rot(this.re, this.im, y * n + x, per * dx);
      }
    }
  }

  /** Sampled angular spectrum (not an anti-alias band-limit). z in metres. Evanescent orders are dropped. */
  propagate(z) {
    if (!Number.isFinite(z) || Math.abs(z) > .08 || !Number.isFinite(this.z + z)) throw new RangeError('propagation must be finite, within 80 mm per step');
    this._invalidateBytes();
    this.wigner = null;
    const n = this.n;
    fft2(this.re, this.im, n, 1);
    const k0 = (2 * Math.PI) / this.lambda;
    const df = 1 / (n * this.pitch);
    for (let y = 0; y < n; y++) {
      const fy = (y <= n / 2 ? y : y - n) * df;
      for (let x = 0; x < n; x++) {
        const fx = (x <= n / 2 ? x : x - n) * df;
        const mu2 = k0 * k0 - 4 * Math.PI * Math.PI * (fx * fx + fy * fy);
        const i = y * n + x;
        if (mu2 <= 0) {
          this.re[i] = 0;
          this.im[i] = 0;
          continue;
        }
        rot(this.re, this.im, i, z * Math.sqrt(mu2));
      }
    }
    fft2(this.re, this.im, n, -1);
    this.z += z;
    this.op = `prop ${((this.z) * 1e3).toFixed(2)} mm`;
  }

  intensity() {
    const out = new Float32Array(this.re.length);
    for (let i = 0; i < out.length; i++) out[i] = this.re[i] * this.re[i] + this.im[i] * this.im[i];
    return out;
  }

  /** Phase-only retrieval. Target is drawn in the focal plane; the mask stays on the field. */
  gerchberg(targetName='spots', iters) {
    if (!['spots','bar','ring'].includes(targetName)) throw new Error('target must be spots, bar, or ring');
    const steps = stepCount(iters,40);
    const n = this.n;
    const target = new Float32Array(n * n);
    const mid = n >> 1;
    const paint = (cx, cy, rad, amp) => {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= rad * rad) target[y * n + x] = amp;
        }
      }
    };
    if (targetName === "bar") {
      for (let y = 28; y <= 36; y++) for (let x = 12; x <= 52; x++) target[y * n + x] = 1;
    } else if (targetName === "ring") {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const r = Math.hypot(x - mid, y - mid);
          if (r > 12 && r < 16) target[y * n + x] = 1;
        }
      }
    } else {
      targetName = "spots";
      paint(20, 32, 4, 1);
      paint(44, 32, 4, 1);
    }
    let tEnergy = 0;
    for (let i = 0; i < target.length; i++) tEnergy += target[i] * target[i];
    this.pattern("aperture");
    this.lens(FOCUS_Z);
    const slmRe = Float32Array.from(this.re);
    const slmIm = Float32Array.from(this.im);
    const illum = new Float32Array(n * n);
    for (let i = 0; i < illum.length; i++) illum[i] = Math.hypot(slmRe[i], slmIm[i]);
    for (let s = 0; s < steps; s++) {
      this.propagate(FOCUS_Z);
      this._swapAmp(target);
      this.propagate(-FOCUS_Z);
      this._swapAmp(illum);
    }
    this.propagate(FOCUS_Z);
    const got = this.intensity();
    let gEnergy = 0;
    for (let i = 0; i < got.length; i++) gEnergy += got[i];
    const scale = tEnergy > 0 && gEnergy > 0 ? Math.sqrt(tEnergy / gEnergy) : 1;
    let err = 0;
    for (let i = 0; i < got.length; i++) {
      const d = scale * Math.sqrt(got[i]) - target[i];
      err += d * d;
    }
    this.nmse = tEnergy > 0 ? err / tEnergy : 0;
    this.op = `gs ${targetName} ×${steps}`;
    this.z = FOCUS_Z;
    return { target: targetName, iters: steps, nmse: this.nmse };
  }

  _swapAmp(amp) {
    if (!(amp instanceof Float32Array) || amp.length !== this.re.length || amp.some(v => !Number.isFinite(v) || v < 0 || v > 1e12)) throw new RangeError('invalid target amplitude');
    this._invalidateBytes();
    for (let i = 0; i < this.re.length; i++) {
      const m = Math.hypot(this.re[i], this.im[i]);
      if (m === 0) {
        // Phase at zero amplitude is undefined; choose zero to seed the target.
        this.re[i] = amp[i];
        this.im[i] = 0;
      } else {
        const s = amp[i] / m;
        this.re[i] *= s;
        this.im[i] *= s;
      }
    }
  }

  /**
   * Coherent logic at one focus.
   * AND/OR/NAND share an in-phase lens. XOR/XNOR put π on input B so the
   * focus cancels when both bits are on. NAND and XNOR are the dark port.
   */
  gate(op, a, b) {
    const name = String(op || "").toLowerCase();
    if (!["and", "or", "nand", "xor", "xnor"].includes(name)) {
      throw new Error("gate must be and, or, nand, xor, or xnor");
    }
    const bitA = a;
    const bitB = b;
    if ((bitA !== 0 && bitA !== 1) || (bitB !== 0 && bitB !== 1)) {
      throw new Error("gate bits must be 0 or 1");
    }
    this.wigner = null;
    this.clear();
    const n = this.n;
    const mid = n >> 1;
    const disk = (cx, phase) => {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = x - cx;
          const dy = y - mid;
          if (dx * dx + dy * dy <= 36) {
            const i = y * n + x;
            this.re[i] = Math.cos(phase);
            this.im[i] = Math.sin(phase);
          }
        }
      }
    };
    const differential = name === "xor" || name === "xnor";
    if (bitA) disk(22, 0);
    if (bitB) disk(42, differential ? Math.PI : 0);
    if (bitA) this._steer(22, FOCUS_Z);
    if (bitB) this._steer(42, FOCUS_Z);
    this.propagate(FOCUS_Z);
    const i0 = mid * n + mid;
    const det = this.re[i0] * this.re[i0] + this.im[i0] * this.im[i0];
    this.detector = det;
    let bit;
    if (differential) {
      const on = det > 0.4;
      bit = name === "xor" ? (on ? 1 : 0) : on ? 0 : 1;
    } else if (name === "or") bit = det > 0.4 ? 1 : 0;
    else bit = det > 2.5 ? (name === "nand" ? 0 : 1) : name === "nand" ? 1 : 0;
    this.gateLabel = `${name.toUpperCase()} ${bitA}${bitB}`;
    this.bit = bit;
    this.op = `gate ${this.gateLabel}`;
    return { op: name, a: bitA, b: bitB, bit, detector: det, differential };
  }

  /**
   * Stage 3 — RAM-sample the resident optical field.
   * GIF gray is the bit line. Its complement is the anti-bit line.
   * V1 − V2 > 0 is logical 0; V1 − V2 < 0 is logical 1.
   * Bits that flip in the sample buffer are charged at kT ln 2.
   */
  sample() {
    this._invalidateBytes();
    const t0 = performance.now();
    const gif = this._intensityBytes();
    const n = gif.length;
    const prev = this.gifRam;
    let erased = 0;
    let logical1 = 0;
    let diffSum = 0;
    let vSum = 0;
    let vCount = 0;
    for (let i = 0; i < n; i++) {
      const g = gif[i];
      erased += pop8(g ^ (prev ? prev[i] : 0));
      const bitLine = g / 255;
      const antiBit = 1 - bitLine;
      const d = bitLine - antiBit;
      if (d < 0) logical1 += 1;
      diffSum += Math.abs(d);
      if (g) {
        vSum += v2(g);
        vCount += 1;
      }
    }
    const I = this.intensity();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += I[i];
    const mean = sum / n || 0;
    let info = 0;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let i = 0; i < n; i++) {
      if (I[i] <= mean) continue;
      info += 1;
      const ph = Math.atan2(this.im[i], this.re[i]);
      sx += Math.cos(ph) * I[i];
      sy += Math.sin(ph) * I[i];
      sw += I[i];
    }
    const p1 = logical1 / n;
    const rz = 1 - 2 * p1;
    const coh = sw > 0 ? Math.hypot(sx, sy) / sw : 0;
    const trans = Math.sqrt(Math.max(0, 1 - rz * rz)) * Math.min(1, coh);
    const psi = Math.atan2(sy, sx);
    const rx = trans * Math.cos(psi);
    const ry = trans * Math.sin(psi);
    this.gifRam = gif;
    this.ramI = I;
    this.erased = erased;
    this.landauer += erased * LANDAUER;
    this.logical1 = logical1;
    this.info = info;
    this.padic = vCount ? vSum / vCount : 0;
    this.margin = diffSum / n;
    this.bloch = [rx, ry, rz];
    this.purity = 0.5 * (1 + rx * rx + ry * ry + rz * rz);
    this.sampleUs = (performance.now() - t0) * 1000;
    this.stage = "sample";
    return this._report();
  }

  /**
   * Stage 4 — move information-bearing pixels one step along −∇I.
   * That is the discrete flux of geometric diffusion. Colliding carriers
   * add as complex amplitudes.
   */
  relocate() {
    const n = this.n;
    const I = this.ramI || this.intensity();
    this._invalidateBytes();
    let sum = 0;
    for (let i = 0; i < I.length; i++) sum += I[i];
    const mean = sum / I.length || 0;
    const stay = new Uint8Array(n * n);
    stay.fill(1);
    const moves = [];
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        if (I[i] <= mean) continue;
        const gx = I[i + 1] - I[i - 1];
        const gy = I[i + n] - I[i - n];
        if (gx === 0 && gy === 0) continue;
        let nx = x;
        let ny = y;
        if (Math.abs(gx) >= Math.abs(gy)) nx += gx > 0 ? -1 : 1;
        else ny += gy > 0 ? -1 : 1;
        stay[i] = 0;
        moves.push({ to: ny * n + nx, re: this.re[i], im: this.im[i] });
      }
    }
    const nextRe = new Float32Array(n * n);
    const nextIm = new Float32Array(n * n);
    for (let i = 0; i < stay.length; i++) {
      if (!stay[i]) continue;
      nextRe[i] = this.re[i];
      nextIm[i] = this.im[i];
    }
    for (const m of moves) {
      nextRe[m.to] += m.re;
      nextIm[m.to] += m.im;
    }
    this.re = nextRe;
    this.im = nextIm;
    this.moved = moves.length;
    this.stage = "relocate";
    this.ramI = null;
    return moves.length;
  }

  /**
   * Five-stage processable hologram.
   * project → ASM evolve → RAM-sample → relocate along −∇I → GIF reproject.
   */
  cycle(steps) {
    const count = stepCount(steps,8);
    this.wigner = null;
    const t0 = performance.now();
    for (let s = 0; s < count; s++) {
      this.stage = "project";
      this.stage = "evolve";
      this.propagate(CAVITY_Z);
      this.sample();
      this.relocate();
      this.spool();
      this.stage = "reproject";
      this.cycles += 1;
    }
    this.sampleUs = ((performance.now() - t0) * 1000) / count;
    this.stepUs = this.sampleUs;
    this.op = `cycle ${this.cycles}`;
    return this._report();
  }

  /** Geometric diffusion only: sample and relocate, no free-space step. */
  diffuse(steps) {
    const count = stepCount(steps,16);
    this.wigner = null;
    for (let s = 0; s < count; s++) {
      this.stage = "project";
      this.sample();
      this.relocate();
      this.cycles += 1;
    }
    this.spool();
    this.stage = "diffuse";
    this.op = `diffuse ${this.cycles}`;
    return this._report();
  }

  /**
   * Gaussian Interaction Frame.
   * Overlap with a TEM00 pupil is the lab-frame displacement, and it is
   * divided out. The residual energy sets a Kerr rotation. The portrait is
   * that residual's Wigner function. Negative area is the non-Gaussian part.
   */
  frame() {
    const mode = this._mode();
    let res = 0;
    let tot = 0;
    for (let i = 0; i < mode.g.length; i++) {
      const ur = this.re[i] - mode.re * mode.g[i];
      const ui = this.im[i] - mode.im * mode.g[i];
      res += ur * ur + ui * ui;
      tot += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    }
    const nbar = tot > 1e-12 ? res / tot : 0;
    const chi = Math.min(0.55, nbar * 0.9);
    const beta = Math.sqrt(Math.min(nbar, 2.4) * 1.6);
    const phase = Math.atan2(mode.im, mode.re);
    const cs = kerrCoherent(beta * Math.cos(phase), beta * Math.sin(phase), chi);
    const grid = 40;
    const w = wignerGrid(cs, grid, 3.6);
    let wMin = 0;
    let wMax = 0;
    let neg = 0;
    for (let i = 0; i < w.length; i++) {
      if (w[i] < wMin) wMin = w[i];
      if (w[i] > wMax) wMax = w[i];
      if (w[i] < -1e-4) neg += 1;
    }
    const mag = Array.from(w, (v) => Math.abs(v)).sort((a, b) => a - b);
    const scale = Math.max(mag[Math.floor(mag.length * 0.86)] || 0, 1e-6);
    const bytes = new Uint8Array(w.length);
    for (let i = 0; i < w.length; i++) {
      bytes[i] = Math.max(0, Math.min(255, Math.round(128 + (127 * w[i]) / scale)));
    }
    this.wigner = bytes;
    this.wignerN = grid;
    this.wMin = wMin;
    this.wNeg = neg / w.length;
    this.gifAlpha = Math.hypot(mode.re, mode.im);
    this.gifChi = chi;
    this.gifNbar = nbar;
    this.penteract = this._penteract();
    this.stage = "frame";
    this.op = chi < 0.02 ? "gif vacuum" : `gif χ ${chi.toFixed(2)}`;
    return {
      alpha: this.gifAlpha,
      chi,
      nbar,
      wMin,
      neg: this.wNeg,
      order: this.orderR,
      penteract: this.penteract,
    };
  }

  /** Kuramoto step inside each 2-adic ball of the GIF gray, then a new frame. */
  kuramoto(steps) {
    const count = stepCount(steps,12);
    this._invalidateBytes();
    const n = this.n;
    const gif = this._intensityBytes();
    const sigma = 0.9;
    for (let s = 0; s < count; s++) {
      const balls = new Map();
      for (let i = 0; i < gif.length; i++) {
        if (this.re[i] === 0 && this.im[i] === 0) continue;
        const key = gif[i] ? v2(gif[i]) : 8;
        let ball = balls.get(key);
        if (!ball) {
          ball = [];
          balls.set(key, ball);
        }
        ball.push(i);
      }
      const dth = new Float32Array(gif.length);
      for (const ball of balls.values()) {
        if (ball.length < 2) continue;
        let mr = 0;
        let mi = 0;
        const th = new Float32Array(ball.length);
        for (let k = 0; k < ball.length; k++) {
          th[k] = Math.atan2(this.im[ball[k]], this.re[ball[k]]);
          mr += Math.cos(th[k]);
          mi += Math.sin(th[k]);
        }
        mr /= ball.length;
        mi /= ball.length;
        for (let k = 0; k < ball.length; k++) {
          const i = ball[k];
          const x = i % n;
          const y = (i / n) | 0;
          const omega = (((x * 3 + y * 5) % 7) - 3) * 0.04;
          dth[i] = omega + sigma * (mi * Math.cos(th[k]) - mr * Math.sin(th[k]));
        }
      }
      for (let i = 0; i < dth.length; i++) {
        if (dth[i]) rot(this.re, this.im, i, dth[i]);
      }
    }
    let mr = 0;
    let mi = 0;
    let mass = 0;
    for (let i = 0; i < this.re.length; i++) {
      const a = Math.hypot(this.re[i], this.im[i]);
      if (a < 1e-6) continue;
      const th = Math.atan2(this.im[i], this.re[i]);
      mr += Math.cos(th) * a;
      mi += Math.sin(th) * a;
      mass += a;
    }
    this.orderR = mass > 0 ? Math.hypot(mr, mi) / mass : 0;
    const portrait = this.frame();
    this.stage = "kuramoto";
    this.op = `kuramoto R ${this.orderR.toFixed(2)}`;
    return { steps: count, order: this.orderR, ...portrait };
  }

  _mode() {
    const n = this.n;
    const mid = (n - 1) / 2;
    const w = n / 7;
    const g = new Float32Array(n * n);
    let nn = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const e = Math.exp(-((x - mid) ** 2 + (y - mid) ** 2) / (2 * w * w));
        g[y * n + x] = e;
        nn += e * e;
      }
    }
    const s = Math.sqrt(nn) || 1;
    let re = 0;
    let im = 0;
    for (let i = 0; i < g.length; i++) {
      g[i] /= s;
      re += this.re[i] * g[i];
      im += this.im[i] * g[i];
    }
    return { g, re, im };
  }

  _penteract() {
    const n = this.n;
    const I = this.intensity();
    const gif = this._intensityBytes();
    let sx = 0;
    let sy = 0;
    let sw = 0;
    let vSum = 0;
    let vCount = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        sx += x * I[i];
        sy += y * I[i];
        sw += I[i];
        if (gif[i]) {
          vSum += v2(gif[i]);
          vCount += 1;
        }
      }
    }
    return {
      x: sw > 0 ? sx / sw : n / 2,
      y: sw > 0 ? sy / sw : n / 2,
      z: this.z * 1e3,
      t: this.frames.length,
      p: vCount ? vSum / vCount : 0,
    };
  }

  /**
   * Image-plane hologram. The object pattern and a tilted reference interfere
   * inside the field array. The weight never leaves those cells.
   */
  record(name) {
    const kept = this.pattern(name || "aperture");
    const n = this.n;
    this.objectRe = Float32Array.from(this.re);
    this.objectIm = Float32Array.from(this.im);
    let peak = 1e-6;
    for (let i = 0; i < n * n; i++) {
      const a = Math.hypot(this.objectRe[i], this.objectIm[i]);
      if (a > peak) peak = a;
    }
    const k = (2 * Math.PI) / 4;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const sr = this.objectRe[i] + peak * Math.cos(k * x);
        const si = this.objectIm[i] + peak * Math.sin(k * x);
        this.re[i] = sr * sr + si * si;
        this.im[i] = 0;
      }
    }
    this.recorded = kept;
    this.fidelity = null;
    this.macOps = 0;
    this.wigner = null;
    this.stage = "record";
    this.op = `record ${kept}`;
    return { name: kept };
  }

  /**
   * In-array multiply of the stored interferogram by the same reference,
   * then a low-pass that drops the twin image. The product is written
   * back into the field. Nothing is copied out to a separate ALU.
   */
  replay() {
    if (!this.recorded || !this.objectRe) return null;
    this._invalidateBytes();
    const n = this.n;
    const k = (2 * Math.PI) / 4;
    const re = new Float32Array(n * n);
    const im = new Float32Array(n * n);
    let ops = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const w = this.re[i];
        re[i] = w * Math.cos(k * x);
        im[i] = w * Math.sin(k * x);
        ops += 1;
      }
    }
    fft2(re, im, n, 1);
    const keep = 10;
    for (let y = 0; y < n; y++) {
      const fy = y <= n / 2 ? y : y - n;
      for (let x = 0; x < n; x++) {
        const fx = x <= n / 2 ? x : x - n;
        if (Math.abs(fx) > keep || Math.abs(fy) > keep) {
          const i = y * n + x;
          re[i] = 0;
          im[i] = 0;
        }
      }
    }
    fft2(re, im, n, -1);
    let cr = 0;
    let ci = 0;
    let eo = 0;
    let eu = 0;
    for (let i = 0; i < re.length; i++) {
      cr += this.objectRe[i] * re[i] + this.objectIm[i] * im[i];
      ci += this.objectRe[i] * im[i] - this.objectIm[i] * re[i];
      eo += this.objectRe[i] * this.objectRe[i] + this.objectIm[i] * this.objectIm[i];
      eu += re[i] * re[i] + im[i] * im[i];
    }
    this.re = re;
    this.im = im;
    this.fidelity = eo > 0 && eu > 0 ? (cr * cr + ci * ci) / (eo * eu) : 0;
    this.macOps = ops;
    this.wigner = null;
    this.z = 0;
    this.stage = "replay";
    this.op = `replay ${this.recorded}`;
    return { name: this.recorded, fidelity: this.fidelity, macOps: ops };
  }

  /** Eight OAM wells. LSB is the rightmost. A lit well is topological charge +1. */
  oam(value) {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('OAM value must be an integer byte');
    this._invalidateBytes();
    const n = this.n;
    const v = value;
    this.clear();
    this.wigner = null;
    this.z = 0;
    for (let i = 0; i < 8; i++) {
      if (((v >> i) & 1) === 0) continue;
      const cx = n - 4 - i * 8;
      const cy = n >> 1;
      for (let y = cy - 4; y <= cy + 4; y++) {
        for (let x = cx - 4; x <= cx + 4; x++) {
          if (x < 0 || x >= n || y < 0 || y >= n) continue;
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.hypot(dx, dy);
          if (r < 1.3 || r > 3.3) continue;
          const ph = Math.atan2(dy, dx);
          const p = y * n + x;
          this.re[p] = Math.cos(ph);
          this.im[p] = Math.sin(ph);
        }
      }
    }
    const read = this._readOam();
    this.oamValue = read.value;
    this.oamBits = read.bits;
    this.oamCharge = read.charge;
    this.oamRem = 0;
    this.oamOverflow = 0;
    this.stage = "oam";
    this.op = `oam ${read.value}`;
    return read;
  }

  /**
   * Move every lit well one place. Left is ×2. Right is integer ÷2.
   * The helical phase is copied, not rewritten, so the charge stays.
   */
  shift(dir, steps=1) {
    if (this.oamValue == null) return null;
    if ((dir !== -1 && dir !== 1) || !Number.isInteger(steps) || steps < 1 || steps > 7) throw new RangeError('OAM shift needs direction +/-1 and 1..7 steps');
    this._invalidateBytes();
    const n = this.n;
    const k = steps;
    const sign = dir < 0 ? -1 : 1;
    const before = this.oamValue;
    let rem = 0;
    let overflow = 0;
    for (let s = 0; s < k; s++) {
      const srcRe = Float32Array.from(this.re);
      const srcIm = Float32Array.from(this.im);
      this.re.fill(0);
      this.im.fill(0);
      for (let i = 0; i < 8; i++) {
        const dest = i + sign;
        if (dest < 0 || dest > 7) {
          const sx = (7 - i) * 8;
          let e = 0;
          for (let y = 0; y < n; y++) {
            for (let x = 0; x < 8; x++) {
              const p = y * n + sx + x;
              e += srcRe[p] * srcRe[p] + srcIm[p] * srcIm[p];
            }
          }
          if (e > 2) {
            if (sign > 0) overflow = 1;
            else rem |= 1 << s;
          }
          continue;
        }
        const sx = (7 - i) * 8;
        const dx = (7 - dest) * 8;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < 8; x++) {
            this.re[y * n + dx + x] = srcRe[y * n + sx + x];
            this.im[y * n + dx + x] = srcIm[y * n + sx + x];
          }
        }
      }
    }
    const read = this._readOam();
    this.oamValue = read.value;
    this.oamBits = read.bits;
    this.oamCharge = read.charge;
    this.oamRem = rem;
    this.oamOverflow = overflow;
    this.wigner = null;
    this.stage = "oam";
    this.op = sign > 0 ? `×${1 << k}` : `÷${1 << k}`;
    return { before, ...read, rem, overflow, k, sign };
  }

  _readOam() {
    const n = this.n;
    let value = 0;
    let charge = 0;
    let lit = 0;
    const flags = [];
    for (let i = 0; i < 8; i++) {
      const cx = n - 4 - i * 8;
      const cy = n >> 1;
      let e = 0;
      for (let y = cy - 4; y <= cy + 4; y++) {
        for (let x = cx - 4; x <= cx + 4; x++) {
          if (x < 0 || x >= n || y < 0 || y >= n) continue;
          const p = y * n + x;
          e += this.re[p] * this.re[p] + this.im[p] * this.im[p];
        }
      }
      const on = e > 2 ? 1 : 0;
      flags.push(on);
      if (on) {
        value |= 1 << i;
        charge += this._winding(cx, cy);
        lit += 1;
      }
    }
    const bits = flags.reverse().join("");
    return { value, bits, charge: lit ? Math.round(charge / lit) : 0 };
  }

  _winding(cx, cy) {
    const n = this.n;
    const samples = 24;
    const radius = 2.2;
    let wind = 0;
    let prev = null;
    for (let s = 0; s <= samples; s++) {
      const a = (s / samples) * Math.PI * 2;
      const x = Math.round(cx + radius * Math.cos(a));
      const y = Math.round(cy + radius * Math.sin(a));
      const ph = Math.atan2(this.im[y * n + x], this.re[y * n + x]);
      if (prev != null) {
        let d = ph - prev;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        wind += d;
      }
      prev = ph;
    }
    return wind / (Math.PI * 2);
  }

  /**
   * Six processors each run the RAM sample twice: a scalar CPU
   * (fetch, decode, execute, writeback) and a 32-wide batched CPU loop. The TIFF
   * is kept only when those lanes match. Processor 7 issues the byte
   * that moved farthest. A tie keeps the lowest index.
   */
  bytes() {
    this.sample();
    const gif = this.gifRam;
    if (!gif || gif.length % 32 !== 0) throw new Error("RAM sample is not a whole number of GPU warps");
    const warp = 32;
    const lanes = [];
    const stages = [];
    for (const stage of BYTE_STAGES) {
      const cpu = new Uint8Array(gif.length);
      const gpu = new Uint8Array(gif.length);
      let changed = 0;
      for (let i = 0; i < gif.length; i++) {
        const sample = gif[i];
        const out = stage.table[sample];
        cpu[i] = out;
        if (out !== sample) changed += 1;
      }
      const warps = gif.length / warp;
      for (let w = 0; w < warps; w++) {
        const base = w * warp;
        for (let lane = 0; lane < warp; lane++) {
          const i = base + lane;
          gpu[i] = stage.table[gif[i]];
        }
      }
      let equivalent = true;
      for (let i = 0; i < gif.length; i++) if (cpu[i] !== gpu[i]) equivalent = false;
      if (!equivalent) throw new Error(`${stage.name} CPU and GPU lanes diverged`);
      lanes.push(cpu);
      let same = "";
      for (let p = 0; p < stages.length; p++) {
        const prior = BYTE_STAGES[p].table;
        let equal = true;
        for (let b = 0; b < 256; b++) if (prior[b] !== stage.table[b]) { equal = false; break; }
        if (equal) { same = BYTE_STAGES[p].name; break; }
      }
      stages.push({
        id: stage.id,
        name: stage.name,
        changed,
        unique: stage.unique,
        owned: 0,
        same,
        cpuCycles: gif.length * 4,
        gpuWarps: warps,
        equivalent,
      });
    }
    const route = new Uint8Array(gif.length);
    const selected = new Uint8Array(gif.length);
    const seen = new Set();
    let changed = 0;
    for (let i = 0; i < gif.length; i++) {
      const sample = gif[i];
      let best = -1;
      let pick = 0;
      for (let s = 0; s < lanes.length; s++) {
        const delta = Math.abs(lanes[s][i] - sample);
        if (delta > best) {
          best = delta;
          pick = s;
        }
      }
      route[i] = pick + 1;
      selected[i] = lanes[pick][i];
      stages[pick].owned += 1;
      if (selected[i] !== sample) changed += 1;
      seen.add(selected[i]);
    }
    stages.push({
      id: "processor-7",
      name: "Processor 7",
      changed,
      unique: seen.size,
      owned: gif.length,
      same: "",
      equivalent: true,
    });
    let written = 0;
    for (let i = 0; i < selected.length; i++) {
      const a = Math.hypot(this.re[i], this.im[i]);
      if (!(a >= 1e-6)) continue;
      const ph = (selected[i] / 255) * Math.PI * 2 - Math.PI;
      this.re[i] = a * Math.cos(ph);
      this.im[i] = a * Math.sin(ph);
      written += 1;
    }
    this.byteStages = stages;
    this.byteWritten = written;
    this.byteRoute = route;
    this.byteLanes = lanes;
    this.wigner = null;
    this.stage = "bytes";
    this.op = "byte chip";
    return { written, stages };
  }

  /** Processor 1–6: its own lane. Processor 7: the route, one index per sample. */
  tiffPlane(index) {
    if (!Number.isInteger(index) || index < 1 || index > 7) throw new RangeError('processor index must be 1..7');
    const n = this.n * this.n;
    const samples = new Uint16Array(n);
    if (index === 7) {
      const route = this.byteRoute;
      if (!route) return null;
      for (let i = 0; i < n; i++) {
        const r = route[i];
        samples[i] = (r << 8) | r;
      }
    } else {
      const lane = this.byteLanes && this.byteLanes[index - 1];
      if (!lane) return null;
      for (let i = 0; i < n; i++) samples[i] = lane[i] * 257;
    }
    return encodeTiffGray16(this.n, this.n, samples, {description: {
      profile: 'JA21-BYTE-PLANE/2.0', corpus: 'RUSSL-CORPUS/2.0.0',
      logicalShape: [1,1,1,this.n,this.n], placement: 'F[0,0,0,y,x]=TIFF[y,x]',
      processor: index, meaning: index===7?'route ID (1..6)':'LUT output byte (0..255)',
      sampleEncoding: 'u16 = byte * 257; inverse = u16 / 257, exact',
      classification: 'LOSSLESS', domain: 'stored byte samples, not original complex field',
      execution: 'JavaScript CPU; image samples are data, not executable instructions'
    }});
  }

  _report() {
    return {
      cycles: this.cycles,
      stage: this.stage,
      info: this.info,
      moved: this.moved,
      logical1: this.logical1,
      logical0: this.n * this.n - this.logical1,
      erased: this.erased,
      landauer: this.landauer,
      sampleUs: this.sampleUs,
      stepUs: this.stepUs,
      padic: this.padic,
      margin: this.margin,
      bloch: this.bloch,
      purity: this.purity,
      zMm: this.z * 1e3,
    };
  }

  spool() {
    const frame = this._intensityBytes();
    this.frames.push(frame);
    if (this.frames.length > 24) this.frames.shift();
    return this.frames.length;
  }

  resetSpool() {
    this.frames = [];
  }

  phaseBytes() {
    const n = this.n;
    const out = new Uint16Array(n * n);
    for (let i = 0; i < out.length; i++) {
      const ph = Math.atan2(this.im[i], this.re[i]);
      out[i] = Math.max(0, Math.min(65535, Math.round(((ph + Math.PI) / (2 * Math.PI)) * 65535)));
    }
    return out;
  }

  _intensityBytes() {
    const raw = this.intensity();
    let max = 1e-12;
    for (let i = 0; i < raw.length; i++) if (raw[i] > max) max = raw[i];
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((255 * raw[i]) / max)));
    return out;
  }

  preview() {
    const n = this.n;
    const phase = new Uint8Array(n * n);
    const amp = this._intensityBytes();
    for (let i = 0; i < phase.length; i++) {
      const ph = Math.atan2(this.im[i], this.re[i]);
      phase[i] = Math.round(((ph + Math.PI) / (2 * Math.PI)) * 255);
    }
    return {
      n,
      phase: Array.from(phase),
      intensity: Array.from(amp),
      zMm: this.z * 1e3,
      lambdaNm: this.lambda * 1e9,
      pitchUm: this.pitch * 1e6,
      op: this.op,
      gate: this.gateLabel,
      bit: this.bit,
      detector: this.detector,
      frames: this.frames.length,
      nmse: this.nmse,
      cycles: this.cycles,
      stage: this.stage,
      info: this.info,
      moved: this.moved,
      logical1: this.logical1,
      erased: this.erased,
      landauerJ: this.landauer,
      sampleUs: this.sampleUs,
      padic: this.padic,
      margin: this.margin,
      bloch: this.bloch,
      purity: this.purity,
      wigner: this.wigner ? Array.from(this.wigner) : null,
      wignerN: this.wignerN,
      wMin: this.wMin,
      wNeg: this.wNeg,
      gifAlpha: this.gifAlpha,
      gifChi: this.gifChi,
      gifNbar: this.gifNbar,
      orderR: this.orderR,
      penteract: this.penteract,
      recorded: this.recorded,
      fidelity: this.fidelity,
      macOps: this.macOps,
      oamValue: this.oamValue,
      oamBits: this.oamBits,
      oamCharge: this.oamCharge,
      oamRem: this.oamRem,
      oamOverflow: this.oamOverflow,
      byteStages: this.byteStages,
      byteWritten: this.byteWritten,
      route: this.stage === "bytes" && this.byteRoute ? Array.from(this.byteRoute, (r) => r * 42) : null,
    };
  }

  tiff() {
    return encodeTiffGray16(this.n, this.n, this.phaseBytes(), {
      resolution: {x:[3175,1],y:[3175,1],unit:2},
      description: {profile:'JA21-PHASE-U16/2.0',corpus:'RUSSL-CORPUS/2.0.0',
        logicalShape:[1,1,1,this.n,this.n],placement:'F[0,0,0,y,x]=TIFF[y,x]',
        meaning:'phase radians; amplitude not stored',calibration:'simulated pitch 8e-6 m, not an acquisition measurement',
        quantizer:'clamp(round((atan2(im,re)+pi)/(2*pi)*65535),0,65535)',
        reconstruction:'u16/65535*2*pi-pi',maxAbsolutePhaseErrorRadians:Math.PI/65535,
        classification:'LOSSY',domain:'phase quantization and discarded amplitude; u16 samples themselves export exactly',
        losslessAlternative:'russl capture -> /var/hpu/russl-field.tif'}});
  }

  gif() {
    const frames = this.frames.length ? this.frames : [this._intensityBytes()];
    return encodeGifGray(this.n, this.n, frames);
  }

  save() { this._validateState(this); return encodeState(this); }

  load(bytes) {
    try {
      if (!(bytes instanceof Uint8Array) || bytes.length > 1048588) return false;
      const next = new Hpu();
      if (bytes[0] === 72 && bytes[1] === 80 && bytes[2] === 85 && bytes[3] === 50) {
        const state = decodeState(bytes); next._validateState(state); Object.assign(next, state);
      } else if (!next._loadLegacy(bytes)) return false;
      next._validateState(next);
      Object.assign(this, next); return true;
    } catch { return false; }
  }

  _validateState(s) {
    const keys = Object.keys(newStateShape());
    if (!s || Object.keys(s).length !== keys.length || keys.some(k => !Object.hasOwn(s,k))) throw new Error('state schema mismatch');
    if (s.n !== N || s.pitch !== PITCH || s.lambda !== LAMBDA) throw new Error('field geometry mismatch');
    const exact = (x,C,n) => x instanceof C && x.length === n;
    for (const k of ['re','im']) if (!exact(s[k],Float32Array,N*N)) throw new Error('invalid complex field');
    for (const k of ['ramI','objectRe','objectIm']) if (s[k] !== null && !exact(s[k],Float32Array,N*N)) throw new Error('invalid auxiliary field');
    if ((s.objectRe === null) !== (s.objectIm === null) || Boolean(s.recorded) !== (s.objectRe !== null)) throw new Error('incoherent recorded object');
    for (const k of ['re','im','objectRe','objectIm']) if (s[k] !== null && s[k].some(x => !Number.isFinite(x) || Math.abs(x)>1e12)) throw new Error('invalid complex field value');
    if (s.ramI !== null && s.ramI.some(x => !Number.isFinite(x) || x < 0 || x > Math.fround(2e24))) throw new Error('invalid sampled intensity');
    for (const k of ['gifRam','byteRoute']) if (s[k] !== null && !exact(s[k],Uint8Array,N*N)) throw new Error('invalid byte field');
    if (!Array.isArray(s.frames) || s.frames.length > 24 || s.frames.some(x => !exact(x,Uint8Array,N*N))) throw new Error('invalid spool');
    if (!Array.isArray(s.bloch) || s.bloch.length !== 3 || s.bloch.some(x => typeof x !== 'number' || Math.abs(x) > 1.000001)) throw new Error('invalid Bloch proxy');
    if (![null,0,1].includes(s.bit) || (s.wigner !== null && (!exact(s.wigner,Uint8Array,1600) || s.wignerN !== 40))) throw new Error('invalid model metadata');
    for (const k of ['op','stage','gateLabel','recorded','oamBits']) if (typeof s[k] !== 'string' || s[k].length > 128) throw new Error('invalid field text');
    for (const k of ['n','pitch','lambda','z','cycles','detector','info','moved','logical1','erased','landauer','sampleUs','stepUs','padic','margin','purity','wignerN','wMin','wNeg','gifAlpha','gifChi','gifNbar','orderR','macOps','oamCharge','oamRem','oamOverflow','byteWritten']) if (typeof s[k] !== 'number' || !Number.isFinite(s[k])) throw new Error('invalid field number');
    for (const k of ['nmse','fidelity','oamValue']) if (s[k] !== null && (typeof s[k] !== 'number' || !Number.isFinite(s[k]))) throw new Error('invalid optional field number');
    const bounded = (k,lo,hi,integer=false) => { const x=s[k];if(x<lo||x>hi||(integer&&!Number.isSafeInteger(x)))throw new Error('invalid '+k+' range'); };
    bounded('cycles',0,Number.MAX_SAFE_INTEGER,true);
    for (const k of ['info','moved','logical1','byteWritten','macOps']) bounded(k,0,N*N,true);
    bounded('erased',0,N*N*8,true);bounded('oamRem',0,127,true);bounded('oamOverflow',0,1,true);
    if (s.oamValue !== null) bounded('oamValue',0,255,true);
    if (s.oamBits !== '' && (!/^[01]{8}$/.test(s.oamBits) || s.oamValue === null || parseInt(s.oamBits,2) !== s.oamValue)) throw new Error('invalid OAM bits');
    if (s.oamValue !== null && s.oamBits === '') throw new Error('missing OAM bits');
    if (![0,40].includes(s.wignerN)) throw new Error('invalid Wigner grid size');
    for (const k of ['detector','landauer','sampleUs','stepUs','gifAlpha','gifNbar']) bounded(k,0,Number.MAX_SAFE_INTEGER);
    bounded('padic',0,7);bounded('margin',0,1);bounded('purity',.5,1.000001);bounded('wNeg',0,1);bounded('gifChi',0,.55);bounded('orderR',0,1.000001);
    if (s.nmse !== null) bounded('nmse',0,Number.MAX_SAFE_INTEGER);
    if (s.fidelity !== null) bounded('fidelity',0,1.000001);
    if (s.bloch.reduce((a,x)=>a+x*x,0)>1.000001) throw new Error('invalid Bloch proxy norm');
    if (s.penteract !== null && (!s.penteract || Object.keys(s.penteract).sort().join(',') !== 'p,t,x,y,z' || Object.values(s.penteract).some(v => !Number.isFinite(v)))) throw new Error('invalid penteract coordinates');
    if (s.byteLanes !== null || s.byteStages !== null || s.byteRoute !== null) {
      if (!s.gifRam || !s.byteRoute || !Array.isArray(s.byteLanes) || s.byteLanes.length !== 6 || s.byteLanes.some(x => !exact(x,Uint8Array,N*N)) || !Array.isArray(s.byteStages) || s.byteStages.length !== 7 || !lanesAgree(s.gifRam,s.byteLanes,s.byteRoute)) throw new Error('byte lane verification failed');
      const owners = Array(6).fill(0); for (const r of s.byteRoute) owners[r-1]++;
      s.byteStages.forEach((b,i) => {
        if (!b || b.id !== `processor-${i+1}` || b.name !== `Processor ${i+1}` || typeof b.same !== 'string' || b.owned !== (i === 6 ? N*N : owners[i]) || b.equivalent !== true) throw new Error('invalid processor ledger');
        let changed=0;const selected=new Set();
        for(let p=0;p<N*N;p++){const value=i===6?s.byteLanes[s.byteRoute[p]-1][p]:s.byteLanes[i][p];if(value!==s.gifRam[p])changed++;selected.add(value);}
        const unique=i===6?selected.size:BYTE_STAGES[i].unique;
        const prior=i===6?-1:BYTE_STAGES.findIndex((stage,j)=>j<i&&stage.table.every((v,p)=>v===BYTE_STAGES[i].table[p]));
        if(b.changed!==changed||b.unique!==unique||b.same!==(prior<0?'':BYTE_STAGES[prior].name))throw new Error('processor ledger does not match samples');
        const ledgerKeys=i===6?'changed,equivalent,id,name,owned,same,unique':'changed,cpuCycles,equivalent,gpuWarps,id,name,owned,same,unique';
        if(Object.keys(b).sort().join(',')!==ledgerKeys||(i<6&&(b.cpuCycles!==N*N*4||b.gpuWarps!==N*N/32)))throw new Error('invalid processor verification metadata');
      });
    } else if (s.byteWritten !== 0) throw new Error('missing byte verification for written count');
    encodeState(s); // All other values are bounded, finite and non-executable.
    return true;
  }

  _invalidateBytes() { this.byteLanes = null; this.byteStages = null; this.byteRoute = null; this.byteWritten = 0; this.ramI = null; }

  _saveLegacy() {
    const n = this.n;
    const frames = this.frames;
    const enc = new TextEncoder();
    const op = enc.encode(this.op).subarray(0, 16);
    let trailer = 0;
    const packed = [];
    if (this.byteRoute && this.byteLanes && this.byteStages && this.byteStages.length === 7) {
      for (const stage of this.byteStages) {
        packed.push({
          owned: stage.owned >>> 0,
          changed: stage.changed >>> 0,
          unique: stage.unique & 65535,
          name: enc.encode(String(stage.name || "")).subarray(0, 24),
          same: enc.encode(String(stage.same || "")).subarray(0, 24),
        });
      }
      trailer = 8;
      for (const stage of packed) trailer += 12 + stage.name.length + stage.same.length;
      trailer += n * n * 7;
      if (this.gifRam && this.gifRam.length === n * n) trailer += n * n;
    }
    const bytes = 32 + n * n * 8 + frames.length * n * n + trailer;
    const out = new Uint8Array(bytes);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x48505531, true);
    v.setUint32(4, n, true);
    v.setFloat32(8, this.z, true);
    v.setUint32(12, frames.length, true);
    let o = 32;
    new Uint8Array(out.buffer, o, n * n * 4).set(new Uint8Array(this.re.buffer));
    o += n * n * 4;
    new Uint8Array(out.buffer, o, n * n * 4).set(new Uint8Array(this.im.buffer));
    o += n * n * 4;
    for (const frame of frames) {
      out.set(frame, o);
      o += frame.length;
    }
    out.set(op, 16);
    if (trailer) {
      v.setUint32(o, 0x42395437, true);
      v.setUint32(o + 4, this.byteWritten >>> 0, true);
      o += 8;
      for (const stage of packed) {
        v.setUint32(o, stage.owned, true);
        v.setUint32(o + 4, stage.changed, true);
        v.setUint16(o + 8, stage.unique, true);
        o += 10;
        out[o++] = stage.name.length;
        out.set(stage.name, o);
        o += stage.name.length;
        out[o++] = stage.same.length;
        out.set(stage.same, o);
        o += stage.same.length;
      }
      out.set(this.byteRoute, o);
      o += this.byteRoute.length;
      for (const lane of this.byteLanes) {
        out.set(lane, o);
        o += lane.length;
      }
      if (this.gifRam && this.gifRam.length === n * n) out.set(this.gifRam, o);
    }
    return out;
  }

  _loadLegacy(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u.byteLength < 32) return false;
    const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
    if (v.getUint32(0, true) !== 0x48505531) return false;
    const n = v.getUint32(4, true);
    if (n !== this.n) return false;
    this.z = v.getFloat32(8, true);
    if (!Number.isFinite(this.z)) return false;
    const count = v.getUint32(12, true);
    if (count > 24) return false;
    let o = 32;
    const need = o + n * n * 8 + count * n * n;
    if (u.byteLength < need) return false;
    this.re = new Float32Array(u.slice(o, o + n * n * 4).buffer);
    o += n * n * 4;
    this.im = new Float32Array(u.slice(o, o + n * n * 4).buffer);
    o += n * n * 4;
    this.frames = [];
    for (let i = 0; i < count; i++) {
      this.frames.push(u.slice(o, o + n * n));
      o += n * n;
    }
    this.op = new TextDecoder().decode(u.subarray(16, 32)).replace(/\0/g, "") || "restored";
    for (let i = 0; i < this.re.length; i++) {
      if (!Number.isFinite(this.re[i]) || !Number.isFinite(this.im[i]) || Math.abs(this.re[i]) > 1e12 || Math.abs(this.im[i]) > 1e12) return false;
    }
    this.byteRoute = null;
    this.byteLanes = null;
    this.byteStages = null;
    this.byteWritten = 0;
    if (o !== u.byteLength && (o + 8 > u.byteLength || v.getUint32(o, true) !== 0x42395437)) return false;
    if (o + 8 <= u.byteLength && v.getUint32(o, true) === 0x42395437) {
      const end = u.byteLength;
      let p = o + 4;
      const written = v.getUint32(p, true);
      p += 4;
      const stages = [];
      let ok = true;
      for (let s = 0; s < 7 && ok; s++) {
        if (p + 11 > end) { ok = false; break; }
        const owned = v.getUint32(p, true);
        const changed = v.getUint32(p + 4, true);
        const unique = v.getUint16(p + 8, true);
        p += 10;
        const nameLen = u[p++];
        if (nameLen > 24 || p + nameLen + 1 > end) { ok = false; break; }
        const name = new TextDecoder().decode(u.subarray(p, p + nameLen));
        p += nameLen;
        const sameLen = u[p++];
        if (sameLen > 24 || p + sameLen > end) { ok = false; break; }
        const same = new TextDecoder().decode(u.subarray(p, p + sameLen));
        p += sameLen;
        stages.push({
          id: `processor-${s + 1}`,
          name,
          changed,
          unique,
          owned,
          same,
        });
      }
      const cells = n * n;
      if (!ok || p + cells * 7 > end) {
        return false;
      } else {
        const route = u.slice(p, p + cells);
        p += cells;
        let routeOk = true;
        for (let i = 0; i < route.length; i++) if (route[i] < 1 || route[i] > 6) routeOk = false;
        const lanes = [];
        for (let s = 0; s < 6; s++) {
          lanes.push(u.slice(p, p + cells));
          p += cells;
        }
        if (routeOk && p + cells === end && lanesAgree(u.subarray(p, p + cells), lanes, route)) {
          this.byteRoute = route;
          this.byteLanes = lanes;
          this.byteStages = stages;
          this.byteWritten = written;
          this.gifRam = u.slice(p, p + cells);
          this.stage = "bytes";
          for (const stage of stages) {
            if (stage.id === "processor-7") stage.equivalent = true;
            else {
              stage.cpuCycles = cells * 4;
              stage.gpuWarps = cells / 32;
              stage.equivalent = true;
            }
          }
        } else if (false) { // Legacy lanes without their sample cannot be verified.
          this.byteRoute = route;
          this.byteLanes = lanes;
          this.byteStages = stages;
          this.byteWritten = written;
          this.stage = "bytes";
        }
      }
    }
    if (u.byteLength > need && (!this.byteRoute || !this.gifRam)) return false;
    return true;
  }
}

export function encodeTiffGray16(width, height, samples, options={}) {
  if (!(samples instanceof Uint16Array)) throw new Error('TIFF sample shape mismatch');
  return encodeGrayTiff(width,height,samples,options);
}

function lzwEncode(indices) {
  const minCodeSize = 8;
  const clear = 256;
  const eoi = 257;
  let codeSize = 9;
  let next = 258;
  const dict = new Map();
  const bytes = [];
  let acc = 0;
  let bits = 0;
  const write = (code) => {
    acc += code * 2 ** bits;
    bits += codeSize;
    while (bits >= 8) {
      bytes.push(acc & 255);
      acc = Math.floor(acc / 256);
      bits -= 8;
    }
  };
  const reset = () => {
    dict.clear();
    codeSize = 9;
    next = 258;
  };
  reset();
  write(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 512 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    write(prefix);
    if (next < 4096) {
      dict.set(key, next);
      next += 1;
      // A decoder inserts this entry when it reads the next code, so its
      // table, and its bit width, trails this counter by one.
      if (next === (1 << codeSize) + 1 && codeSize < 12) codeSize += 1;
    } else {
      write(clear);
      reset();
    }
    prefix = k;
  }
  write(prefix);
  write(eoi);
  if (bits) bytes.push(acc & 255);
  return bytes;
}

export function encodeGifGray(width, height, frames) {
  checkImage(width,height);
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 24 || frames.some(f => !(f instanceof Uint8Array) || f.length !== width*height)) throw new Error('GIF frame shape mismatch');
  const out = [];
  const push = (...xs) => out.push(...xs);
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  push(width & 255, width >> 8, height & 255, height >> 8, 0xf7, 0, 0);
  for (let i = 0; i < 256; i++) push(i, i, i);
  push(0x21, 0xff, 0x0b);
  for (const c of "NETSCAPE2.0") push(c.charCodeAt(0));
  push(3, 1, 0, 0, 0);
  for (const frame of frames) {
    push(0x21, 0xf9, 0x04, 0x04, 10, 0, 0, 0);
    push(0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0);
    const packed = lzwEncode(frame);
    push(8);
    let i = 0;
    while (i < packed.length) {
      const n = Math.min(255, packed.length - i);
      push(n);
      for (let k = 0; k < n; k++) push(packed[i + k]);
      i += n;
    }
    push(0);
  }
  push(0x3b);
  return Uint8Array.from(out);
}

const STATE_KEYS = {"bit": 1, "bloch": 1, "byteLanes": 1, "byteRoute": 1, "byteStages": 1, "byteWritten": 1, "cycles": 1, "detector": 1, "erased": 1, "fidelity": 1, "frames": 1, "gateLabel": 1, "gifAlpha": 1, "gifChi": 1, "gifNbar": 1, "gifRam": 1, "im": 1, "info": 1, "lambda": 1, "landauer": 1, "logical1": 1, "macOps": 1, "margin": 1, "moved": 1, "n": 1, "nmse": 1, "oamBits": 1, "oamCharge": 1, "oamOverflow": 1, "oamRem": 1, "oamValue": 1, "objectIm": 1, "objectRe": 1, "op": 1, "orderR": 1, "padic": 1, "penteract": 1, "pitch": 1, "purity": 1, "ramI": 1, "re": 1, "recorded": 1, "sampleUs": 1, "stage": 1, "stepUs": 1, "wMin": 1, "wNeg": 1, "wigner": 1, "wignerN": 1, "z": 1};
function newStateShape() { return STATE_KEYS; }

function checkImage(w,h) { if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 512 || h > 512 || w*h > 262144) throw new RangeError('image geometry limit'); }
