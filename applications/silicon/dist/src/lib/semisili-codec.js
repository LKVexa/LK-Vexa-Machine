// SPDX-License-Identifier: GPL-3.0-only
/** Exact Pixel160 storage for a bounded numerical model, not an executable image.
 * Five coordinates locate a cell. Five uint32 word lanes describe that cell.
 * Words are opaque here: float32 and residue semantics belong to the model.
 */
import { encodeGrayTiff, decodeGrayTiff } from '../vendor/spiral/tiff-codec.js';
import { crc32 } from '../vendor/spiral/state-codec.js';

export const PIXEL160_PROFILE = 'JA21-PIXEL160/1.0';
export const NEURON_PROFILE = 'JA21-SEMISILI-NEURON/1.0';
export const STATE_SCHEMA = 'JA21-SEMISILI-STATE/1.0';
export const TIFF_SCHEMA = 'JA21-PIXEL160-TIFF/1.0';
export const AXES = Object.freeze(['D4', 'D5', 'D6', 'D7', 'D8']);
export const CODEC_LIMITS = Object.freeze({ cells: 4096, frames: 8, stateBytes: 1572864, configBytes: 32768, configNodes: 4096, configDepth: 6 });
const GENERIC_ROLES = Object.freeze(['L4', 'L5', 'L6', 'L7', 'L8']);
const NEURON_ROLES = Object.freeze(['residue', 'activationFloat32Bits', 'amplitudeFloat32Bits', 'realFloat32Bits', 'imaginaryFloat32Bits']);
const textEncoder = new TextEncoder();
const fail = message => { throw new Error(`Semi-sili codec: ${message}`); };
const integer = (v, lo, hi, name) => { if (!Number.isSafeInteger(v) || v < lo || v > hi) fail(`${name} limit`); return v; };
const profileRoles = profile => profile === PIXEL160_PROFILE ? GENERIC_ROLES : profile === NEURON_PROFILE ? NEURON_ROLES : fail('unknown profile');
const sameArray = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

function denseArray(value, limit, label) {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} dense array required`);
  return Array.from({ length: value.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail(`${label} array data properties required`);
    return d.value;
  });
}

function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain record`);
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(k => typeof k !== 'string' || !keys.includes(k))) fail(`${label} schema keys`);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail(`${label} data properties required`);
  }
  return value;
}

/** Row-major coordinates: D8 is fastest. Word lanes are not extra axes. */
export function shapeInfo(shape) {
  if (!Array.isArray(shape) || shape.length !== 5) fail('exactly five coordinate axes required');
  const dims = denseArray(shape, 5, 'shape').map((n, i) => integer(n, 1, CODEC_LIMITS.cells, `shape ${AXES[i]}`));
  const strides = new Array(5); let cells = 1;
  for (let i = 4; i >= 0; i--) { strides[i] = cells; if (dims[i] > Math.floor(CODEC_LIMITS.cells / cells)) fail('shape product limit'); cells *= dims[i]; }
  return Object.freeze({ shape: Object.freeze(dims), strides: Object.freeze(strides), cells, wordCount: cells * 5, byteLength: cells * 20 });
}

export function coordinateToOrdinal(coords, shape) {
  const info = shapeInfo(shape);
  if (!Array.isArray(coords) || coords.length !== 5) fail('exactly five coordinates required');
  return denseArray(coords, 5, 'coordinates').reduce((sum, c, i) => sum + integer(c, 0, info.shape[i] - 1, `coordinate ${AXES[i]}`) * info.strides[i], 0);
}

export function ordinalToCoordinate(index, shape) {
  const info = shapeInfo(shape); integer(index, 0, info.cells - 1, 'cell ordinal');
  return info.strides.map((stride, i) => Math.floor(index / stride) % info.shape[i]);
}

function fieldWords(words, info) {
  if (!(words instanceof Uint32Array) || words.length !== info.wordCount) fail('uint32 field length');
  return words;
}
function fieldBytes(bytes, info) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== info.byteLength) fail('canonical byte length');
  return bytes;
}

export function packPixel160(words) {
  if (!(words instanceof Uint32Array) && !Array.isArray(words)) fail('five uint32 pixel words required');
  if (words.length !== 5) fail('five uint32 pixel words required');
  if (Array.isArray(words)) words = denseArray(words, 5, 'pixel words');
  const out = new Uint8Array(20), view = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) view.setUint32(i * 4, integer(words[i], 0, 0xffffffff, 'pixel word'), false);
  return out;
}

export function unpackPixel160(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 20) fail('pixel must contain exactly 20 bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.from({ length: 5 }, (_, i) => view.getUint32(i * 4, false));
}

export function packField160(words, shape) {
  const info = shapeInfo(shape); fieldWords(words, info);
  const out = new Uint8Array(info.byteLength), view = new DataView(out.buffer);
  for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i], false);
  return out;
}

export function unpackField160(bytes, shape) {
  const info = shapeInfo(shape); fieldBytes(bytes, info);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.from({ length: info.wordCount }, (_, i) => view.getUint32(i * 4, false));
}

/** Small finite JSON metadata. Key sorting is this format's canonicalization,
 * not a claim of RFC 8785/JCS conformance or cryptographic authentication. */
function configCopy(config) {
  let nodes = 0;
  function copy(value, depth) {
    if (++nodes > CODEC_LIMITS.configNodes || depth > CODEC_LIMITS.configDepth) fail('config complexity limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail('finite config number required'); return Object.is(value, -0) ? 0 : value; }
    if (typeof value === 'string') { if (value.length > 4096) fail('config string limit'); return value; }
    if (Array.isArray(value)) {
      return denseArray(value, CODEC_LIMITS.configNodes, 'config').map(item => copy(item, depth + 1));
    }
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('config JSON data required');
    const keys = Reflect.ownKeys(value);
    if (keys.length > 64 || keys.some(k => typeof k !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k) || ['constructor', 'prototype', '__proto__'].includes(k))) fail('config key limit');
    const out = Object.create(null);
    for (const k of keys.sort()) {
      const d = Object.getOwnPropertyDescriptor(value, k);
      if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail('config data properties required');
      out[k] = copy(d.value, depth + 1);
    }
    return out;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('config record required');
  const out = copy(config, 0);
  if (textEncoder.encode(JSON.stringify(out)).length > CODEC_LIMITS.configBytes) fail('config byte budget');
  return out;
}

const wordHex = words => Array.from(words, x => x.toString(16).padStart(8, '0')).join('');
function hexWords(hex, info) {
  if (typeof hex !== 'string' || hex.length !== info.wordCount * 8 || !/^[0-9a-f]+$/.test(hex)) fail('canonical word hex required');
  return Uint32Array.from({ length: info.wordCount }, (_, i) => Number.parseInt(hex.slice(i * 8, i * 8 + 8), 16));
}
function snapshot(frame, info, encoded) {
  record(frame, encoded ? ['sequence', 'simulationTime', 'wordHex'] : ['sequence', 'simulationTime', 'words'], 'snapshot');
  integer(frame.sequence, 0, Number.MAX_SAFE_INTEGER, 'sequence');
  if (!Number.isFinite(frame.simulationTime) || frame.simulationTime < 0 || frame.simulationTime > Number.MAX_SAFE_INTEGER) fail('simulation time limit');
  const words = encoded ? hexWords(frame.wordHex, info) : new Uint32Array(fieldWords(frame.words, info));
  return { sequence: frame.sequence, simulationTime: Object.is(frame.simulationTime, -0) ? 0 : frame.simulationTime, words };
}
function normalizeState(state, encoded) {
  record(state, encoded ? ['schema', 'profile', 'shape', 'config', 'current', 'frames'] : ['profile', 'shape', 'config', 'current', 'frames'], 'state');
  if (encoded && state.schema !== STATE_SCHEMA) fail('state schema version');
  profileRoles(state.profile);
  const info = shapeInfo(state.shape), config = configCopy(state.config), current = snapshot(state.current, info, encoded);
  if (!Array.isArray(state.frames) || state.frames.length > CODEC_LIMITS.frames) fail('history frame limit');
  let previous = -1, time = 0;
  const frames = denseArray(state.frames, CODEC_LIMITS.frames, 'history').map(f => {
    const frame = snapshot(f, info, encoded);
    if (frame.sequence <= previous || frame.sequence > current.sequence || frame.simulationTime < time || frame.simulationTime > current.simulationTime) fail('history clock order');
    if (frame.sequence === current.sequence && (frame.simulationTime !== current.simulationTime || frame.words.some((w, i) => w !== current.words[i]))) fail('current and history snapshot disagree');
    previous = frame.sequence; time = frame.simulationTime; return frame;
  });
  return { profile: state.profile, shape: [...info.shape], config, current, frames };
}

export function encodeState(state) {
  const clean = normalizeState(state, false);
  const encoded = frame => ({ sequence: frame.sequence, simulationTime: frame.simulationTime, wordHex: wordHex(frame.words) });
  const text = JSON.stringify({ schema: STATE_SCHEMA, profile: clean.profile, shape: clean.shape, config: clean.config, current: encoded(clean.current), frames: clean.frames.map(encoded) });
  if (text.length > CODEC_LIMITS.stateBytes || textEncoder.encode(text).length > CODEC_LIMITS.stateBytes) fail('state byte budget');
  return text;
}

export function decodeState(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > CODEC_LIMITS.stateBytes || textEncoder.encode(text).length > CODEC_LIMITS.stateBytes) fail('state byte budget');
  let parsed; try { parsed = JSON.parse(text); } catch { fail('invalid state JSON'); }
  const clean = normalizeState(parsed, true);
  // This also rejects duplicate JSON keys, whitespace and alternate numeric/hex
  // spellings, giving each accepted state one unambiguous serialized form.
  if (encodeState(clean) !== text) fail('noncanonical state JSON');
  return clean;
}

function tiffMetadata(profile, shape, config, bytes) {
  return { schema: TIFF_SCHEMA, profile, axes: [...AXES], shape: [...shape], config: configCopy(config), carriage: 'u8-byte-raster', layout: 'cell-major/word-major', byteOrder: 'BE32', wordRoles: [...profileRoles(profile)], checksum: { algorithm: 'CRC32', hex: crc32(bytes).toString(16).padStart(8, '0') } };
}

/** TIFF is byte carriage: one logical cell occupies 20 grayscale samples.
 * Neither TIFF display pixels nor its sample precision become 160-bit floats. */
export function encodePixel160Tiff(field, options = {}) {
  const keys = ['profile', 'shape', 'words'];
  if (field && Object.hasOwn(field, 'config')) keys.push('config');
  record(field, keys, 'TIFF field'); profileRoles(field.profile);
  const info = shapeInfo(field.shape), bytes = packField160(field.words, info.shape);
  record(options, Object.keys(options), 'TIFF options');
  if (Object.keys(options).some(k => !['byteOrder', 'bigTiff'].includes(k))) fail('unsupported TIFF option');
  return encodeGrayTiff(20, info.cells, bytes, { ...options, description: JSON.stringify(tiffMetadata(field.profile, info.shape, Object.hasOwn(field, 'config') ? field.config : {}, bytes)) });
}

export function decodePixel160Tiff(input) {
  const image = decodeGrayTiff(input);
  if (image.dtype !== 'u8' || image.width !== 20 || image.orientation !== 1 || image.opaqueTags.length !== 0 || image.calibration.unit !== 1 || !sameArray(image.calibration.x, [1, 1]) || !sameArray(image.calibration.y, [1, 1])) fail('unsupported Pixel160 TIFF carriage');
  if (typeof image.description !== 'string') fail('Pixel160 TIFF metadata required');
  let meta; try { meta = JSON.parse(image.description); } catch { fail('invalid Pixel160 TIFF metadata'); }
  record(meta, ['schema', 'profile', 'axes', 'shape', 'config', 'carriage', 'layout', 'byteOrder', 'wordRoles', 'checksum'], 'TIFF metadata');
  const roles = profileRoles(meta.profile), info = shapeInfo(meta.shape);
  record(meta.checksum, ['algorithm', 'hex'], 'TIFF checksum');
  if (meta.schema !== TIFF_SCHEMA || !sameArray(meta.axes, AXES) || !sameArray(meta.wordRoles, roles) || meta.carriage !== 'u8-byte-raster' || meta.layout !== 'cell-major/word-major' || meta.byteOrder !== 'BE32' || meta.checksum.algorithm !== 'CRC32' || typeof meta.checksum.hex !== 'string' || !/^[0-9a-f]{8}$/.test(meta.checksum.hex) || image.height !== info.cells) fail('Pixel160 TIFF metadata mismatch');
  const canonical = tiffMetadata(meta.profile, info.shape, meta.config, image.samples);
  if (meta.checksum.hex !== canonical.checksum.hex) fail('Pixel160 TIFF checksum mismatch');
  if (JSON.stringify(canonical) !== image.description) fail('noncanonical Pixel160 TIFF metadata');
  return { profile: meta.profile, shape: [...info.shape], config: canonical.config, words: unpackField160(image.samples, info.shape), metadata: canonical, sourceBytes: image.sourceBytes };
}
