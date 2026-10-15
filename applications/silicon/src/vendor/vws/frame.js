/** hermit.vws.v3: [kind:u8][sequence:uint48 BE][nonempty payload]. */
export const PROTOCOL = 'hermit.vws.v3';
export const KIND_INPUT = 1, KIND_OUTPUT = 2;
export const MAX_SEQ = 2 ** 48 - 1;
export const MAX_PAYLOAD = 16384;
function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('expected Uint8Array or ArrayBuffer');
}
export function encodeData(kind, seq, payload) {
  if (kind !== KIND_INPUT && kind !== KIND_OUTPUT) throw new RangeError('invalid frame kind');
  if (!Number.isSafeInteger(seq) || seq < 1 || seq > MAX_SEQ) throw new RangeError('invalid frame sequence');
  const body = bytes(payload);
  if (!body.length || body.length > MAX_PAYLOAD) throw new RangeError('invalid frame size');
  const out = new Uint8Array(7 + body.length); out[0] = kind;
  let n = seq;
  for (let i = 6; i >= 1; i--) { out[i] = n % 256; n = Math.floor(n / 256); }
  out.set(body, 7); return out;
}
export function decodeData(value) {
  const u = bytes(value);
  if (u.length < 8 || u.length > MAX_PAYLOAD + 7) throw new RangeError('invalid frame size');
  if (u[0] !== KIND_INPUT && u[0] !== KIND_OUTPUT) throw new RangeError('invalid frame kind');
  let seq = 0;
  for (let i = 1; i <= 6; i++) seq = seq * 256 + u[i];
  if (seq < 1 || seq > MAX_SEQ) throw new RangeError('invalid frame sequence');
  return {kind:u[0], seq, payload:u.subarray(7)};
}
