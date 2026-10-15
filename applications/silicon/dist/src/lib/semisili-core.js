/** Finite numerical phase-ring / hierarchical neuron model. No physical optics claim. */
export const MAX_SAMPLES = 4096;
export const MAX_MODULUS = 65536;
export const BULK_BLOCK = 64;
const TAU = 2 * Math.PI;
const OPS = Object.freeze(['add', 'sub', 'mul', 'negate', 'complement']);

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}
function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} out of range`);
  return value;
}
function primeNumber(p) {
  if (!Number.isSafeInteger(p) || p < 2 || p > MAX_MODULUS) return false;
  for (let divisor = 2; divisor * divisor <= p; divisor++) if (p % divisor === 0) return false;
  return true;
}
export function createRing({prime = 2, precision = 8} = {}) {
  if (!primeNumber(prime)) throw new RangeError('prime must be a prime integer');
  integer(precision, 1, 16, 'precision');
  const modulus = prime ** precision;
  integer(modulus, 2, MAX_MODULUS, 'modulus');
  return Object.freeze({prime, precision, modulus, bitWidth: Math.ceil(Math.log2(modulus))});
}
function ringOf(ring) {
  if (ring === undefined) return createRing();
  if (!ring || typeof ring !== 'object') throw new TypeError('ring configuration required');
  const checked = createRing(ring);
  if (ring.modulus !== undefined && ring.modulus !== checked.modulus) throw new RangeError('ring modulus mismatch');
  if (ring.bitWidth !== undefined && ring.bitWidth !== checked.bitWidth) throw new RangeError('ring width mismatch');
  return checked;
}
function codes(values, ring, name) {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) throw new TypeError(`${name} must be an array`);
  integer(values.length, 1, MAX_SAMPLES, `${name} count`);
  const copy = new Uint16Array(values.length);
  for (let i = 0; i < copy.length; i++) copy[i] = integer(values[i], 0, ring.modulus - 1, `${name}[${i}]`);
  return copy;
}
function operands(a, b, options = {}) {
  const ring = ringOf(options.ring);
  const operation = options.operation === undefined ? 'add' : options.operation;
  if (!OPS.includes(operation)) throw new RangeError('unsupported phase-ring operation');
  const left = codes(a, ring, 'a');
  const unary = operation === 'negate' || operation === 'complement';
  const right = unary ? new Uint16Array(left.length) : codes(b, ring, 'b');
  if (right.length !== left.length) throw new RangeError('operand shape mismatch');
  return {ring, operation, left, right};
}
export function directRing(a, b, options = {}) {
  const {ring, operation, left, right} = operands(a, b, options);
  const modulus = BigInt(ring.modulus), output = new Uint16Array(left.length);
  for (let i = 0; i < output.length; i++) {
    const x = BigInt(left[i]), y = BigInt(right[i]);
    let value;
    switch (operation) {
      case 'add': value = x + y; break;
      case 'sub': value = x - y; break;
      case 'mul': value = x * y; break;
      case 'negate': value = -x; break;
      case 'complement': value = modulus - 1n - x; break;
    }
    output[i] = Number((value % modulus + modulus) % modulus);
  }
  return output;
}
export function encodeResidue(value, ring) {
  const checked = ringOf(ring);
  integer(value, 0, checked.modulus - 1, 'residue');
  const angle = TAU * value / checked.modulus;
  return {re: Math.cos(angle), im: Math.sin(angle)};
}
export function decodeCarrier(re, im, ring, {minMargin = 0.49, minAmplitude = 1e-12} = {}) {
  const checked = ringOf(ring);
  finite(re, 'carrier real'); finite(im, 'carrier imaginary');
  finite(minMargin, 'minimum decision margin'); finite(minAmplitude, 'minimum amplitude');
  if (minMargin < 0 || minMargin > 0.5 || minAmplitude <= 0) throw new RangeError('invalid carrier guard');
  const amplitude = Math.hypot(re, im);
  if (!Number.isFinite(amplitude) || amplitude < minAmplitude) throw new RangeError('carrier has no readable phase');
  let angle = Math.atan2(im, re);
  if (angle < 0) angle += TAU;
  const cell = angle * checked.modulus / TAU;
  const nearest = Math.round(cell);
  const errorCells = Math.abs(cell - nearest), margin = 0.5 - errorCells;
  if (margin < minMargin) throw new RangeError('carrier decision margin insufficient');
  return {value: (nearest % checked.modulus + checked.modulus) % checked.modulus, angle, amplitude, margin, errorCells};
}
function normalizedProduct(a, b) {
  const re = a.re * b.re - a.im * b.im, im = a.re * b.im + a.im * b.re;
  const magnitude = Math.hypot(re, im);
  if (!Number.isFinite(magnitude) || magnitude < 1e-12) throw new RangeError('numerical carrier multiplication failed');
  return {re: re / magnitude, im: im / magnitude};
}
function integerPower(base, exponent) {
  let result = {re: 1, im: 0}, factor = base, remaining = exponent;
  while (remaining > 0) {
    if (remaining % 2 === 1) result = normalizedProduct(result, factor);
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) factor = normalizedProduct(factor, factor);
  }
  return result;
}
/** All operands are copied first; every phase is confirmed before any output is returned. */
export function runPhaseBatch(a, b, options = {}) {
  const {ring, operation, left, right} = operands(a, b, options);
  const minMarginGuard = options.minMargin === undefined ? 0.49 : options.minMargin;
  finite(minMarginGuard, 'minimum decision margin');
  if (minMarginGuard < 0 || minMarginGuard > 0.5) throw new RangeError('invalid phase decision margin');
  const reference = directRing(left, right, {ring, operation});
  const values = new Uint16Array(left.length), carriers = new Float64Array(left.length * 2);
  let minMargin = 0.5, maxErrorCells = 0;
  const minusOne = encodeResidue(ring.modulus - 1, ring);
  for (let i = 0; i < left.length; i++) {
    const x = encodeResidue(left[i], ring), y = encodeResidue(right[i], ring);
    let wave;
    switch (operation) {
      case 'add': wave = normalizedProduct(x, y); break;
      case 'sub': wave = normalizedProduct(x, {re: y.re, im: -y.im}); break;
      case 'mul': wave = integerPower(x, right[i]); break;
      case 'negate': wave = {re: x.re, im: -x.im}; break;
      case 'complement': wave = normalizedProduct(minusOne, {re: x.re, im: -x.im}); break;
    }
    const read = decodeCarrier(wave.re, wave.im, ring, {minMargin: minMarginGuard});
    if (read.value !== reference[i]) throw new Error(`phase reference mismatch at sample ${i}`);
    values[i] = read.value; carriers[i * 2] = wave.re; carriers[i * 2 + 1] = wave.im;
    minMargin = Math.min(minMargin, read.margin); maxErrorCells = Math.max(maxErrorCells, read.errorCells);
  }
  return Object.freeze({ring, operation, count: values.length, values, carriers, reference,
    verified: true, minMargin, maxErrorCells, execution: 'CPU Float64 numerical phase model',
    gpuStatus: 'NOT_RUN', physicalOpticalHardware: false, trainedModel: false});
}
/** Exact integer valuation. Zero has infinite valuation; it is never silently given a finite norm. */
export function valuation(value, prime = 2) {
  integer(value, 0, 0xffffffff, 'valuation input');
  if (!primeNumber(prime)) throw new RangeError('valuation requires a prime');
  if (value === 0) return Infinity;
  let n = value, order = 0;
  while (n % prime === 0) {n /= prime; order++;}
  return order;
}
export function pAdicDistance(a, b, {prime = 2} = {}) {
  integer(a, 0, 0xffffffff, 'address a'); integer(b, 0, 0xffffffff, 'address b');
  if (!primeNumber(prime)) throw new RangeError('distance requires a prime');
  return a === b ? 0 : prime ** -valuation(Math.abs(a - b), prime);
}
/** Integer-address ball proximity on a finite residue ring; equality is distance zero. */
export function residueDistance(a, b, ring) {
  const checked = ringOf(ring);
  integer(a, 0, checked.modulus - 1, 'residue a'); integer(b, 0, checked.modulus - 1, 'residue b');
  return pAdicDistance(a, b, checked);
}
export function sampleIntensity(re, im, ring) {
  const checked = ringOf(ring);
  if ((!Array.isArray(re) && !ArrayBuffer.isView(re)) || (!Array.isArray(im) && !ArrayBuffer.isView(im))) throw new TypeError('complex field arrays required');
  integer(re.length, 1, MAX_SAMPLES, 'field count');
  if (im.length !== re.length) throw new RangeError('complex field shape mismatch');
  const intensity = new Float64Array(re.length);
  let peak = 0, sum = 0;
  for (let i = 0; i < re.length; i++) {
    finite(re[i], 'field real'); finite(im[i], 'field imaginary');
    const value = re[i] * re[i] + im[i] * im[i];
    if (!Number.isFinite(value)) throw new RangeError('field intensity overflow');
    intensity[i] = value; peak = Math.max(peak, value); sum += value;
  }
  if (!Number.isFinite(sum)) throw new RangeError('field energy overflow');
  const values = new Uint16Array(re.length), bits = new Uint8Array(re.length), antiBits = new Uint8Array(re.length), input = new Float64Array(re.length);
  for (let i = 0; i < re.length; i++) {
    values[i] = peak === 0 ? 0 : Math.round((checked.modulus - 1) * intensity[i] / peak);
    input[i] = 2 * values[i] / (checked.modulus - 1) - 1;
    bits[i] = values[i] >= checked.modulus / 2 ? 1 : 0;
    antiBits[i] = 1 - bits[i];
  }
  return Object.freeze({ring: checked, count: values.length, values, bits, antiBits, input, intensity, peak,
    modelEnergy: sum, units: 'dimensionless numerical samples', quantization: 'relative field peak, nearest integer'});
}
/** Bit-major words, 64 samples per block, two uint32 words per plane/block. */
export function packBitPlanes(values, ring) {
  const checked = ringOf(ring), input = codes(values, checked, 'samples');
  const blocks = Math.ceil(input.length / BULK_BLOCK), words = new Uint32Array(checked.bitWidth * blocks * 2);
  for (let plane = 0; plane < checked.bitWidth; plane++) for (let i = 0; i < input.length; i++) {
    const block = Math.floor(i / BULK_BLOCK), within = i % BULK_BLOCK;
    const word = (plane * blocks + block) * 2 + Math.floor(within / 32);
    if ((input[i] >>> plane) & 1) words[word] = (words[word] | (1 << (within % 32))) >>> 0;
  }
  return Object.freeze({ring: checked, count: input.length, blockSize: BULK_BLOCK, blocks, words});
}
export function unpackBitPlanes(packed) {
  if (!packed || typeof packed !== 'object') throw new TypeError('packed bit planes required');
  const ring = ringOf(packed.ring), count = integer(packed.count, 1, MAX_SAMPLES, 'packed count');
  const blocks = Math.ceil(count / BULK_BLOCK);
  if (packed.blockSize !== BULK_BLOCK || packed.blocks !== blocks || !(packed.words instanceof Uint32Array) || packed.words.length !== ring.bitWidth * blocks * 2) throw new RangeError('packed bit-plane shape mismatch');
  const values = new Uint16Array(count);
  for (let plane = 0; plane < ring.bitWidth; plane++) for (let i = 0; i < blocks * BULK_BLOCK; i++) {
    const word = (plane * blocks + Math.floor(i / BULK_BLOCK)) * 2 + Math.floor((i % BULK_BLOCK) / 32);
    const bit = (packed.words[word] >>> (i % 32)) & 1;
    if (i >= count && bit) throw new RangeError('nonzero padding in bit-plane data');
    if (i < count) values[i] |= bit << plane;
  }
  return codes(values, ring, 'unpacked samples');
}
/** Reverse coarse Morton digits so low base-2 digits denote coarse 64x64 spatial branches. */
export function canonicalAddresses(count = MAX_SAMPLES) {
  integer(count, 1, MAX_SAMPLES, 'address count');
  return Uint32Array.from({length: count}, (_, index) => {
    const x = index % 64, y = Math.floor(index / 64);
    let address = 0;
    for (let level = 0; level < 6; level++) {
      address |= ((x >>> (5 - level)) & 1) << (2 * level);
      address |= ((y >>> (5 - level)) & 1) << (2 * level + 1);
    }
    return address;
  });
}
export function clippedSigmoid(value) {finite(value, 'neuron value'); return Math.max(-1, Math.min(1, value));}
export function neuronStep(state, input, options = {}) {
  if ((!Array.isArray(state) && !ArrayBuffer.isView(state)) || (!Array.isArray(input) && !ArrayBuffer.isView(input))) throw new TypeError('neuron arrays required');
  const count = integer(state.length, 1, MAX_SAMPLES, 'neuron count');
  if (input.length !== count) throw new RangeError('neuron input shape mismatch');
  const prime = options.prime === undefined ? 2 : options.prime;
  if (!primeNumber(prime)) throw new RangeError('neuron address prime required');
  const level = integer(options.level === undefined ? 6 : options.level, 0, 16, 'ball level');
  const ballModulus = prime ** level;
  if (!Number.isSafeInteger(ballModulus)) throw new RangeError('address precision exceeds exact integer range');
  const parameters = {
    dt: options.dt === undefined ? 0.25 : options.dt,
    leak: options.leak === undefined ? 1 : options.leak,
    reaction: options.reaction === undefined ? 1.5 : options.reaction,
    coupling: options.coupling === undefined ? 0.25 : options.coupling,
    drive: options.drive === undefined ? 0.5 : options.drive,
    bias: options.bias === undefined ? 0 : options.bias,
    stateLimit: options.stateLimit === undefined ? 4 : options.stateLimit,
  };
  for (const [name, value] of Object.entries(parameters)) finite(value, name);
  const {dt, leak, reaction, coupling, drive, bias, stateLimit} = parameters;
  if (leak <= 0 || reaction < 0 || coupling < 0 || drive < 0 || stateLimit < 1 || stateLimit > 16 || dt <= 0 || dt > 1 / (leak + coupling) || reaction + drive + Math.abs(bias) > leak * stateLimit) throw new RangeError('neuron parameters violate the bounded-step contract');
  const addresses = options.addresses === undefined ? (prime === 2 ? canonicalAddresses(count) : Uint32Array.from({length: count}, (_, i) => i)) : options.addresses;
  if (!(addresses instanceof Uint32Array) || addresses.length !== count) throw new RangeError('neuron address shape mismatch');
  if (new Set(addresses).size !== count) throw new RangeError('neuron addresses must be unique');
  const source = new Float64Array(count), driveInput = new Float64Array(count), groups = new Map();
  for (let i = 0; i < count; i++) {
    const x = finite(state[i], 'neuron state'), u = finite(input[i], 'neuron input');
    if (Math.abs(x) > stateLimit || Math.abs(u) > 1) throw new RangeError('neuron sample exceeds model bounds');
    source[i] = x; driveInput[i] = u;
    const key = addresses[i] % ballModulus, group = groups.get(key) || {sum: 0, count: 0};
    group.sum += x; group.count++; groups.set(key, group);
  }
  const values = new Float64Array(count), outputs = new Float64Array(count), bits = new Uint8Array(count), antiBits = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const group = groups.get(addresses[i] % ballModulus), mean = group.sum / group.count;
    const next = (1 - dt * (leak + coupling)) * source[i] + dt * (reaction * clippedSigmoid(source[i]) + coupling * mean + drive * driveInput[i] + bias);
    if (!Number.isFinite(next) || Math.abs(next) > stateLimit + 1e-12) throw new RangeError('neuron step escaped its invariant bound');
    // Clamp only allowed floating-point boundary drift after the invariant check.
    values[i] = Math.max(-stateLimit, Math.min(stateLimit, next));
    outputs[i] = clippedSigmoid(values[i]); bits[i] = values[i] > 0 ? 1 : 0; antiBits[i] = 1 - bits[i];
  }
  return Object.freeze({count, values, outputs, bits, antiBits, parameters: Object.freeze(parameters),
    prime, level, ballModulus, addressModel: prime === 2 && options.addresses === undefined ? 'coarse-first Morton digits on 64x64 finite grid' : 'finite integer-address congruence balls',
    stableBound: stateLimit, trainedModel: false, gpuStatus: 'NOT_RUN'});
}
/** Numerical display/readout coupling. Arithmetic still uses separate unit phasors. */
export function coupleNeuronCarriers(values, state, ring, {gain = 0.5} = {}) {
  const checked = ringOf(ring), input = codes(values, checked, 'carrier residues');
  if ((!Array.isArray(state) && !ArrayBuffer.isView(state)) || state.length !== input.length) throw new RangeError('carrier neuron shape mismatch');
  finite(gain, 'neuron amplitude gain');
  if (gain < 0 || gain >= 1) throw new RangeError('neuron amplitude gain must be in [0,1)');
  const carriers = new Float64Array(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const amplitude = 1 + gain * clippedSigmoid(state[i]), phase = encodeResidue(input[i], checked);
    carriers[i * 2] = amplitude * phase.re; carriers[i * 2 + 1] = amplitude * phase.im;
    const decoded = decodeCarrier(carriers[i * 2], carriers[i * 2 + 1], checked);
    if (decoded.value !== input[i]) throw new Error('neuron amplitude coupling changed residue');
  }
  return Object.freeze({ring: checked, count: input.length, gain, carriers, verified: true,
    meaning: 'dimensionless numerical neuron amplitude; no optical hardware measurement'});
}
