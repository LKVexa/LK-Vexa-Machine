import { Buffer } from './buffer.js';
const MAX = 1024 * 1024;
const types = { Uint8Array, Float32Array };
export function crc32(bytes) { let c = -1; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ -1) >>> 0; }
function pack(x, depth = 0) {
  if (depth > 6) throw new Error('state nesting limit');
  if (x === null || typeof x === 'boolean') return x;
  if (typeof x === 'number') { if (!Number.isFinite(x) || Math.abs(x) > Number.MAX_SAFE_INTEGER) throw new Error('nonfinite or excessive state number'); return x; }
  if (typeof x === 'string') { if (x.length > 256) throw new Error('state text limit'); return x; }
  if (x instanceof Uint8Array || x instanceof Float32Array) {
    if (x.length > 4096) throw new Error('state array limit');
    if (x instanceof Float32Array && x.some(v => !Number.isFinite(v))) throw new Error('invalid float state value');
    // Explicit little-endian payload, independent of the host typed-array endianness.
    const bytes = new Uint8Array(x.length * x.BYTES_PER_ELEMENT);
    if (x instanceof Float32Array) { const dv = new DataView(bytes.buffer); x.forEach((v,i) => dv.setFloat32(i*4,v,true)); } else bytes.set(x);
    return { $type: x.constructor.name, data: Buffer.from(bytes).toString('base64') };
  }
  if (Array.isArray(x)) { if (x.length > 24) throw new Error('state list limit'); return x.map(v => pack(v, depth + 1)); }
  if (x && Object.getPrototypeOf(x) === Object.prototype) {
    const out = Object.create(null); const keys = Object.keys(x);
    if (keys.length > 64) throw new Error('state key limit');
    for (const k of keys) { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || ['__proto__','constructor','prototype'].includes(k)) throw new Error('invalid state key'); out[k] = pack(x[k], depth + 1); }
    return out;
  }
  throw new Error('unsupported state value');
}
function unpack(x, depth = 0) {
  if (depth > 6) throw new Error('state nesting limit');
  if (x && typeof x === 'object' && !Array.isArray(x) && Object.hasOwn(x, '$type')) {
    if (!Object.hasOwn(types, x.$type) || Object.keys(x).length !== 2 || typeof x.data !== 'string' || x.data.length > 21848 || x.data.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(x.data)) throw new Error('invalid typed state');
    const bytes = Buffer.from(x.data, 'base64'), C = types[x.$type];
    if (bytes.length % C.BYTES_PER_ELEMENT) throw new Error('misaligned state array');
    if (bytes.length / C.BYTES_PER_ELEMENT > 4096) throw new Error('state array limit');
    if (C === Uint8Array) return new Uint8Array(bytes);
    const result = new Float32Array(bytes.length / 4), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    result.forEach((_,i) => { result[i] = dv.getFloat32(i*4,true); }); return result;
  }
  if (Array.isArray(x)) { if (x.length > 24) throw new Error('state list limit'); return x.map(v => unpack(v, depth + 1)); }
  if (x && typeof x === 'object') {
    if (Object.keys(x).length > 64) throw new Error('state key limit');
    const out = {};
    for (const [k,v] of Object.entries(x)) { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || ['__proto__','constructor','prototype'].includes(k)) throw new Error('invalid state key'); out[k] = unpack(v, depth + 1); }
    return out;
  }
  return x;
}
export function encodeState(state) {
  const data = new TextEncoder().encode(JSON.stringify(pack({ ...state })));
  if (data.length > MAX) throw new Error('state exceeds 1 MiB');
  const out = new Uint8Array(data.length + 12), dv = new DataView(out.buffer);
  out.set([72,80,85,50]); dv.setUint32(4, data.length, true); dv.setUint32(8, crc32(data), true); out.set(data,12); return out;
}
export function decodeState(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > MAX + 12) throw new Error('state size limit');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), data = bytes.subarray(12);
  if (bytes[0] !== 72 || bytes[1] !== 80 || bytes[2] !== 85 || bytes[3] !== 50 || dv.getUint32(4,true) !== data.length || dv.getUint32(8,true) !== crc32(data)) throw new Error('state checksum or header mismatch');
  const result = unpack(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)));
  pack(result); // Enforce the same limits after decode, before publication.
  return result;
}
