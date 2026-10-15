import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as codec from '../src/lib/semisili-codec.js';
import { encodeGrayTiff, decodeGrayTiff } from '../src/vendor/spiral/tiff-codec.js';

const results = { profile: 'SEMISILI-CODEC-INDEPENDENT-ACCEPTANCE/1', status: 'RUNNING', pixelVectors: 0, fieldWords: 0, coordinateCases: 0, stateRoundtrips: 0, tiffRoundtrips: 0, malformedRejections: 0, tiffOracleBytes: 0 };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function rejects(fn) { assert.throws(fn); results.malformedRejections++; }
const u32 = list => Uint32Array.from(list);
const shape = [1, 1, 1, 1, 1];
const goldenWords = u32([0, 0x01020304, 0x89abcdef, 0xffffffff, 0x80000000]);
const goldenHex = ['00000000', '01020304', '89abcdef', 'ffffffff', '80000000'].join('');
const hex = bytes => Buffer.from(bytes).toString('hex');

// Independent BigInt positional-byte oracle does not reuse the codec DataView.
function byteOracle(words) {
  const bytes = [];
  for (const word of words) for (let k = 3; k >= 0; k--) bytes.push(Number((BigInt(word) / (256n ** BigInt(k))) % 256n));
  return Uint8Array.from(bytes);
}
assert.equal(hex(codec.packPixel160(goldenWords)), goldenHex);
assert.deepEqual(codec.unpackPixel160(byteOracle(goldenWords)), goldenWords);
results.pixelVectors += 2;
for (const bit of Array.from({ length: 32 }, (_, i) => i)) {
  const words = u32([2 ** bit, 0xffffffff - 2 ** bit, 0, 0xffffffff, bit]);
  assert.deepEqual(codec.packPixel160(words), byteOracle(words));
  assert.deepEqual(codec.unpackPixel160(byteOracle(words)), words); results.pixelVectors++;
}
const offsetBytes = new Uint8Array(26).fill(0xa5); offsetBytes.set(byteOracle(goldenWords), 3);
assert.deepEqual(codec.unpackPixel160(offsetBytes.subarray(3, 23)), goldenWords);
const offsetWords = u32([123, ...goldenWords, 456]).subarray(1, 6);
assert.equal(hex(codec.packPixel160(offsetWords)), goldenHex);

const largeShape = [4, 4, 4, 8, 8];
const info = codec.shapeInfo(largeShape);
assert.equal(info.cells, 4096); assert.equal(info.byteLength, 81920); assert.equal(info.wordCount, 20480);
assert.deepEqual([...info.strides], [1024, 256, 64, 8, 1]);
for (let d4 = 0; d4 < 4; d4++) for (let d5 = 0; d5 < 4; d5++) for (let d6 = 0; d6 < 4; d6++) for (let d7 = 0; d7 < 8; d7++) for (let d8 = 0; d8 < 8; d8++) {
  const coords = [d4, d5, d6, d7, d8], ordinal = (((d4 * 4 + d5) * 4 + d6) * 8 + d7) * 8 + d8;
  assert.equal(codec.coordinateToOrdinal(coords, largeShape), ordinal);
  assert.deepEqual(codec.ordinalToCoordinate(ordinal, largeShape), coords); results.coordinateCases++;
}
let seed = 0x3a21160;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
const largeWords = Uint32Array.from({ length: info.wordCount }, random);
const canonicalBytes = codec.packField160(largeWords, largeShape);
assert.deepEqual(canonicalBytes, byteOracle(largeWords));
assert.deepEqual(codec.unpackField160(canonicalBytes, largeShape), largeWords); results.fieldWords += largeWords.length;
const paddedField = new Uint8Array(canonicalBytes.length + 7).fill(0x55); paddedField.set(canonicalBytes, 2);
assert.deepEqual(codec.unpackField160(paddedField.subarray(2, 2 + canonicalBytes.length), largeShape), largeWords);
assert.deepEqual(codec.packField160(new Uint32Array([999, ...goldenWords, 111]).subarray(1, 6), shape), byteOracle(goldenWords));
rejects(() => codec.packPixel160([0, 0, 0, 0]));
rejects(() => codec.packPixel160([0, 0, 0, 0, -1]));
rejects(() => codec.packPixel160([0, 0, 0, 0, 2 ** 32]));
rejects(() => codec.packPixel160([0, 0, 0, 0, 0.5]));
for (const size of [0, 19, 21, 24]) rejects(() => codec.unpackPixel160(new Uint8Array(size)));
for (const badShape of [[1, 1, 1, 1], [1, 1, 1, 1, 0], [4, 4, 4, 16, 16], [1, 1, 1, 1, 4097], [1, 1, 1, 1, 1.5]]) rejects(() => codec.shapeInfo(badShape));
rejects(() => codec.coordinateToOrdinal([0, 0, 0, 0, 8], largeShape));
rejects(() => codec.ordinalToCoordinate(4096, largeShape));
rejects(() => codec.packField160(new Float32Array(5), shape));
rejects(() => codec.unpackField160(new Uint8Array(19), shape));
rejects(() => codec.shapeInfo(new Array(5)));
rejects(() => codec.coordinateToOrdinal(new Array(5), shape));
rejects(() => codec.packPixel160(new Array(5)));
const accessorShape = [...shape]; Object.defineProperty(accessorShape, '2', { enumerable: true, get() { throw new Error('must not execute shape accessor'); } });
rejects(() => codec.shapeInfo(accessorShape));

function stateFor(words = goldenWords, dims = shape, profile = codec.PIXEL160_PROFILE) {
  return { profile, shape: [...dims], config: { zeta: 'numerical model', prime: 2, precision: 8, limits: [0, 1, 1.5], flags: { enabled: true } }, current: { sequence: 2, simulationTime: 0.5, words: words.slice() }, frames: [{ sequence: 1, simulationTime: 0.25, words: words.slice() }] };
}
const sourceState = stateFor(), sourceBefore = structuredClone(sourceState);
const stateText = codec.encodeState(sourceState), stateDecoded = codec.decodeState(stateText);
assert.deepEqual(sourceState, sourceBefore);
assert.deepEqual(stateDecoded.current.words, goldenWords); assert.deepEqual(stateDecoded.frames[0].words, goldenWords);
assert.equal(codec.encodeState(stateDecoded), stateText); results.stateRoundtrips++;
assert.deepEqual(stateDecoded.shape, shape); assert.equal(stateDecoded.config.prime, 2);
stateDecoded.current.words[0] = 123; assert.equal(sourceState.current.words[0], 0);
const rawFloatBits = u32([0xffffffff, 0x80000000, 0x7fc00001, 0x7f800000, 0xff800000]);
for (const profile of [codec.PIXEL160_PROFILE, codec.NEURON_PROFILE]) {
  const x = stateFor(rawFloatBits, shape, profile), y = codec.decodeState(codec.encodeState(x));
  assert.deepEqual(y.current.words, rawFloatBits); results.stateRoundtrips++;
}
const maxState = stateFor(largeWords, largeShape, codec.NEURON_PROFILE);
maxState.current.sequence = 8; maxState.current.simulationTime = 8;
maxState.frames = Array.from({ length: 8 }, (_, i) => ({ sequence: i, simulationTime: i, words: largeWords.slice() }));
const maxText = codec.encodeState(maxState);
assert(new TextEncoder().encode(maxText).length < codec.CODEC_LIMITS.stateBytes);
assert.deepEqual(codec.decodeState(maxText).frames[7].words, largeWords); results.stateRoundtrips++;
results.maximumAcceptedStateBytes = new TextEncoder().encode(maxText).length;
const sameCurrent = stateFor(); sameCurrent.frames = [structuredClone(sameCurrent.current)];
assert.equal(codec.encodeState(codec.decodeState(codec.encodeState(sameCurrent))), codec.encodeState(sameCurrent)); results.stateRoundtrips++;

function alteredState(change) { const s = structuredClone(sourceState); change(s); return () => codec.encodeState(s); }
for (const change of [
  s => { s.profile = 'unknown'; }, s => { s.extra = true; }, s => { s.current.extra = true; },
  s => { s.current.words = u32([1, 2]); }, s => { s.current.sequence = -1; }, s => { s.current.simulationTime = NaN; },
  s => { s.frames = new Array(9).fill(s.frames[0]); }, s => { s.frames = [s.frames[0], s.frames[0]]; },
  s => { s.frames[0].sequence = 3; }, s => { s.frames[0].simulationTime = 1; },
  s => { s.frames[0].sequence = 2; s.frames[0].simulationTime = 0.5; s.frames[0].words[0] = 5; },
  s => { s.config = null; }, s => { s.config.precision = Infinity; }, s => { s.config.array = new Array(4); },
  s => { s.config = { a: { a: { a: { a: { a: { a: { a: { a: 1 } } } } } } } }; },
  s => { s.config = Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['key' + i, 'a'.repeat(4096)])); }
]) rejects(alteredState(change));
let getterExecuted = false;
const accessorState = stateFor(); Object.defineProperty(accessorState.config, 'trap', { enumerable: true, get() { getterExecuted = true; return 1; } });
rejects(() => codec.encodeState(accessorState)); assert.equal(getterExecuted, false);
for (const altered of [
  stateText + '\n', ' ' + stateText, stateText.replace('00000000', '0000000A'), stateText.replace('"schema":', '"extra":0,"schema":'),
  stateText.replace('"profile":', '"profile":"unknown","profile":'), stateText.replace('"sequence":2', '"sequence":2.0'),
  '{', '', 'a'.repeat(codec.CODEC_LIMITS.stateBytes + 1)
]) rejects(() => codec.decodeState(altered));
const protoJson = JSON.parse(stateText); protoJson.config = JSON.parse('{"__proto__":{"polluted":true}}');
rejects(() => codec.decodeState(JSON.stringify(protoJson))); assert.equal({}.polluted, undefined);

// Parse TIFF directory and strip bytes independently of the production decoder.
function tiffByteOracle(file) {
  const le = file[0] === 73, view = new DataView(file.buffer, file.byteOffset, file.byteLength), big = view.getUint16(2, le) === 43;
  const size = big ? 8 : 4, entrySize = big ? 20 : 12, countSize = big ? 8 : 2;
  const read = (p, n) => n === 8 ? Number(view.getBigUint64(p, le)) : n === 4 ? view.getUint32(p, le) : view.getUint16(p, le);
  const ifd = read(big ? 8 : 4, size), count = read(ifd, countSize), tags = new Map();
  for (let i = 0; i < count; i++) {
    const p = ifd + countSize + i * entrySize, id = read(p, 2), type = read(p + 2, 2), number = read(p + 4, size), slot = p + (big ? 12 : 8);
    const n = type === 3 ? 2 : type === 16 ? 8 : 4, at = number * n > size ? read(slot, size) : slot;
    if ([256, 257, 258, 273, 279].includes(id)) tags.set(id, read(at, n));
  }
  assert.equal(tags.get(256), 20); assert.equal(tags.get(258), 8);
  return file.slice(tags.get(273), tags.get(273) + tags.get(279));
}
const fixtures = new URL('./codec-artifacts/', import.meta.url); await fs.mkdir(fixtures, { recursive: true });
for (const profile of [codec.PIXEL160_PROFILE, codec.NEURON_PROFILE]) for (const byteOrder of ['II', 'MM']) for (const bigTiff of [false, true]) {
  const field = { profile, shape: largeShape, config: { precision: 8, prime: 2 }, words: largeWords };
  const file = codec.encodePixel160Tiff(field, { byteOrder, bigTiff }), image = codec.decodePixel160Tiff(file);
  assert.deepEqual(image.words, largeWords); assert.deepEqual(image.shape, largeShape); assert.equal(image.profile, profile); assert.equal(image.config.prime, 2);
  assert.deepEqual(tiffByteOracle(file), canonicalBytes); results.tiffOracleBytes += canonicalBytes.length;
  assert.equal(image.metadata.byteOrder, 'BE32');
  if (profile === codec.NEURON_PROFILE) assert.deepEqual(image.metadata.wordRoles, ['residue', 'activationFloat32Bits', 'amplitudeFloat32Bits', 'realFloat32Bits', 'imaginaryFloat32Bits']);
  await fs.writeFile(new URL(`${profile === codec.NEURON_PROFILE ? 'neuron' : 'generic'}-${byteOrder}-${bigTiff ? 'big' : 'classic'}.tiff`, fixtures), file); results.tiffRoundtrips++;
}
await fs.writeFile(new URL('canonical-bytes.bin', fixtures), canonicalBytes);
const smallFile = codec.encodePixel160Tiff({ profile: codec.NEURON_PROFILE, shape, config: { prime: 2 }, words: goldenWords });
const decodedGray = decodeGrayTiff(smallFile), metadata = JSON.parse(decodedGray.description);
function malformedTiff(change, imageOptions = {}) {
  const meta = structuredClone(metadata); change(meta);
  return encodeGrayTiff(imageOptions.width ?? 20, imageOptions.height ?? 1, imageOptions.samples ?? byteOracle(goldenWords), { description: JSON.stringify(meta), ...(imageOptions.options ?? {}) });
}
for (const change of [
  m => { m.schema = 'JA21-PIXEL160-TIFF/9.0'; }, m => { m.profile = 'unknown'; }, m => { m.extra = 1; },
  m => { m.axes.reverse(); }, m => { m.shape = [1, 1, 1, 1, 2]; }, m => { m.wordRoles.reverse(); },
  m => { m.byteOrder = 'LE32'; }, m => { m.carriage = 'float160'; }, m => { m.layout = 'lane-major'; },
  m => { m.checksum.hex = '00000000'; }, m => { m.checksum.algorithm = 'SHA256'; }, m => { m.checksum.extra = 1; },
  m => { m.config = []; }, m => { delete m.config; }
]) rejects(() => codec.decodePixel160Tiff(malformedTiff(change)));
const utf8Noncanonical = encodeGrayTiff(20, 1, byteOracle(goldenWords), { description: JSON.stringify(metadata, null, 2) });
rejects(() => codec.decodePixel160Tiff(utf8Noncanonical));
rejects(() => codec.decodePixel160Tiff(encodeGrayTiff(20, 1, byteOracle(goldenWords))));
rejects(() => codec.decodePixel160Tiff(malformedTiff(() => {}, { samples: Uint16Array.from(byteOracle(goldenWords)) })));
rejects(() => codec.decodePixel160Tiff(malformedTiff(() => {}, { options: { resolution: { x: [72, 1], y: [72, 1], unit: 2 } } })));
rejects(() => codec.decodePixel160Tiff(malformedTiff(() => {}, { width: 10, height: 2 })));
const corrupt = smallFile.slice(); corrupt[corrupt.length - 1] ^= 1; rejects(() => codec.decodePixel160Tiff(corrupt));
// Change declared orientation from 1 to 2 while keeping sample bytes untouched.
const oriented = smallFile.slice(), ov = new DataView(oriented.buffer), ifd = ov.getUint32(4, true);
for (let i = 0; i < ov.getUint16(ifd, true); i++) { const p = ifd + 2 + i * 12; if (ov.getUint16(p, true) === 274) ov.setUint16(p + 8, 2, true); }
rejects(() => codec.decodePixel160Tiff(oriented));
rejects(() => codec.encodePixel160Tiff({ profile: codec.PIXEL160_PROFILE, shape, words: goldenWords }, { description: 'other' }));
rejects(() => codec.encodePixel160Tiff({ profile: codec.PIXEL160_PROFILE, shape, words: goldenWords, config: null }));
rejects(() => codec.decodePixel160Tiff(new Uint8Array(7)));

results.status = 'PASS'; results.runtime = process.version; results.finishedUTC = new Date().toISOString();
results.sourceSHA256 = hash(await fs.readFile(new URL('../src/lib/semisili-codec.js', import.meta.url)));
results.testSHA256 = hash(await fs.readFile(new URL('./semisili-codec.test.mjs', import.meta.url)));
results.adapterSHA256 = Object.fromEntries(await Promise.all(['tiff-codec.js', 'state-codec.js', 'buffer.js'].map(async name => [name, hash(await fs.readFile(new URL('../src/vendor/spiral/' + name, import.meta.url)))])));
results.limits = ['Opaque uint32 storage preserves bits but does not validate neuron physics or float finiteness.', 'TIFF stores 20 uint8 samples per logical cell; no 160-bit display pixel claim.', 'CRC32 detects accidental corruption and provides no authenticity guarantee.', 'Browser persistence and GPU acceptance are separate integration gates.'];
await fs.writeFile(new URL('../audit/SEMISILI_CODEC_RESULTS.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results));
