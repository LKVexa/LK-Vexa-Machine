// Adapted from HERMIT 2.0.0-ramws.1 protocol/codec.js. Copyright (c) 2026 David Paul Russell.
// Original source and LICENSE retained in the integration provenance. ESM packaging only.
function makeCodec() {
  'use strict';

  const PROTOCOL = 'hermit.vws.v2';
  const MAX_ENVELOPE_BYTES = 65536;
  const MAX_DEPTH = 8;
  const SAFE = 9007199254740991;

  class CodecError extends Error {
    constructor(code, message) { super(message); this.name = 'CodecError'; this.code = code; }
  }

  /* ------------------------------------------------------------------ *
   * strict JSON
   * ------------------------------------------------------------------ */

  /** Parse JSON text rejecting duplicate keys, non-finite numbers and deep nesting. */
  function strictParse(text) {
    let i = 0;
    const n = text.length;
    const fail = (m) => { throw new CodecError('BAD_JSON', `${m} at ${i}`); };
    const ws = () => { while (i < n) { const c = text.charCodeAt(i); if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++; else break; } };

    function value(depth) {
      if (depth > MAX_DEPTH) fail('nesting too deep');
      ws();
      if (i >= n) fail('unexpected end');
      const c = text[i];
      if (c === '{') return object(depth);
      if (c === '[') return array(depth);
      if (c === '"') return string();
      if (c === '-' || (c >= '0' && c <= '9')) return number();
      if (text.startsWith('true', i)) { i += 4; return true; }
      if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('null', i)) { i += 4; return null; }
      return fail('unexpected token');
    }
    function object(depth) {
      i++; // {
      const out = Object.create(null);
      const seen = new Set();
      ws();
      if (text[i] === '}') { i++; return toPlain(out); }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected string key');
        const k = string();
        if (seen.has(k)) throw new CodecError('DUPLICATE_KEY', `duplicate key "${k.slice(0, 32)}"`);
        seen.add(k);
        ws();
        if (text[i] !== ':') fail('expected colon');
        i++;
        out[k] = value(depth + 1);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return toPlain(out); }
        fail('expected , or }');
      }
    }
    function toPlain(o) {
      // Null-prototype during parse (no __proto__ surprises); plain own-property object out.
      const p = {};
      for (const k of Object.keys(o)) Object.defineProperty(p, k, { value: o[k], enumerable: true, writable: true, configurable: true });
      return p;
    }
    function array(depth) {
      i++;
      const out = [];
      ws();
      if (text[i] === ']') { i++; return out; }
      for (;;) {
        out.push(value(depth + 1));
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return out; }
        fail('expected , or ]');
      }
    }
    function string() {
      const start = i; i++;
      for (;;) {
        if (i >= n) fail('unterminated string');
        const c = text.charCodeAt(i);
        if (c === 0x22) { i++; break; }
        if (c < 0x20) fail('control character in string');
        if (c === 0x5c) {
          i++;
          const e = text[i];
          if (e === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.substr(i + 1, 4))) fail('bad \\u escape'); i += 5; }
          else if ('"\\/bfnrt'.indexOf(e) >= 0 && e !== undefined) i++;
          else fail('bad escape');
        } else i++;
      }
      // Delegate unescaping of an already-validated string literal to the platform.
      return JSON.parse(text.slice(start, i));
    }
    function number() {
      const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i, i + 64));
      if (!m) fail('bad number');
      i += m[0].length;
      const v = Number(m[0]);
      if (!Number.isFinite(v)) throw new CodecError('NONFINITE', 'non-finite number');
      return v;
    }

    const v = value(0);
    ws();
    if (i !== n) fail('trailing data');
    return v;
  }

  /* ------------------------------------------------------------------ *
   * schema subset validator
   * ------------------------------------------------------------------ */

  const SUPPORTED = new Set(['$schema', '$id', 'title', 'description', 'oneOf', 'type', 'properties', 'required',
    'additionalProperties', 'const', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'contentEncoding']);
  const patternCache = new Map();
  function re(p) { let r = patternCache.get(p); if (!r) { r = new RegExp(p); patternCache.set(p, r); } return r; }

  function assertSupported(schema) {
    if (schema === null || typeof schema !== 'object') return;
    if (Array.isArray(schema)) { schema.forEach(assertSupported); return; }
    for (const k of Object.keys(schema)) {
      if (!SUPPORTED.has(k)) throw new CodecError('SCHEMA_UNSUPPORTED', `unsupported schema keyword: ${k}`);
      if (k === 'properties') Object.values(schema[k]).forEach(assertSupported);
      else if (k === 'oneOf') schema[k].forEach(assertSupported);
    }
  }

  function codeUnitsToPoints(s) { let c = 0; for (const _ of s) c++; return c; }

  /** @returns {string|null} first violation, or null */
  function check(value, schema, path) {
    if ('const' in schema && value !== schema.const) return `${path}: const`;
    if (schema.enum && !schema.enum.includes(value)) return `${path}: enum`;
    if (schema.type) {
      const t = schema.type;
      const ok = t === 'object' ? (value !== null && typeof value === 'object' && !Array.isArray(value))
        : t === 'string' ? typeof value === 'string'
        : t === 'integer' ? (typeof value === 'number' && Number.isInteger(value))
        : t === 'boolean' ? typeof value === 'boolean'
        : t === 'number' ? (typeof value === 'number' && Number.isFinite(value))
        : false;
      if (!ok) return `${path}: type ${t}`;
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) return `${path}: minimum`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${path}: maximum`;
    }
    if (typeof value === 'string') {
      const len = codeUnitsToPoints(value);
      if (schema.minLength !== undefined && len < schema.minLength) return `${path}: minLength`;
      if (schema.maxLength !== undefined && len > schema.maxLength) return `${path}: maxLength`;
      if (schema.pattern && !re(schema.pattern).test(value)) return `${path}: pattern`;
    }
    if (schema.properties || schema.required || schema.additionalProperties === false) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${path}: object expected`;
      for (const r of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, r)) return `${path}.${r}: required`;
      const props = schema.properties || {};
      for (const k of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(props, k)) {
          const e = check(value[k], props[k], `${path}.${k}`);
          if (e) return e;
        } else if (schema.additionalProperties === false) return `${path}.${k}: unknown property`;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * base64 (canonical) + bytes
   * ------------------------------------------------------------------ */

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_INV = (() => { const t = new Int16Array(128).fill(-1); for (let k = 0; k < 64; k++) t[B64.charCodeAt(k)] = k; return t; })();

  function b64encode(bytes) {
    let out = '';
    let k = 0;
    for (; k + 2 < bytes.length; k += 3) {
      const v = (bytes[k] << 16) | (bytes[k + 1] << 8) | bytes[k + 2];
      out += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
    }
    if (k + 1 === bytes.length) { const v = bytes[k] << 16; out += B64[v >> 18] + B64[(v >> 12) & 63] + '=='; }
    else if (k + 2 === bytes.length) { const v = (bytes[k] << 16) | (bytes[k + 1] << 8); out += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + '='; }
    return out;
  }

  /** Decode canonical base64 only: correct alphabet, padding, and zero trailing bits. */
  function b64decode(s) {
    const n = s.length;
    if (n % 4 !== 0) throw new CodecError('BAD_BASE64', 'length');
    if (n === 0) return new Uint8Array(0);
    let pad = 0;
    if (s[n - 1] === '=') pad++;
    if (s[n - 2] === '=') pad++;
    const out = new Uint8Array((n / 4) * 3 - pad);
    let o = 0;
    for (let k = 0; k < n; k += 4) {
      const last = k + 4 === n;
      const q = [0, 0, 0, 0];
      for (let j = 0; j < 4; j++) {
        const c = s.charCodeAt(k + j);
        if (last && j >= 4 - pad) { if (c !== 0x3d) throw new CodecError('BAD_BASE64', 'padding'); q[j] = 0; continue; }
        const v = c < 128 ? B64_INV[c] : -1;
        if (v < 0) throw new CodecError('BAD_BASE64', 'alphabet');
        q[j] = v;
      }
      const v = (q[0] << 18) | (q[1] << 12) | (q[2] << 6) | q[3];
      if (last && pad === 2 && (q[1] & 15) !== 0) throw new CodecError('BAD_BASE64', 'non-canonical trailing bits');
      if (last && pad === 1 && (q[2] & 3) !== 0) throw new CodecError('BAD_BASE64', 'non-canonical trailing bits');
      out[o++] = (v >> 16) & 255;
      if (!(last && pad === 2)) out[o++] = (v >> 8) & 255;
      if (!(last && pad >= 1)) out[o++] = v & 255;
    }
    return out;
  }

  const enc = new TextEncoder();
  function utf8(s) { return enc.encode(s); }
  function utf8Strict(bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }

  /* ------------------------------------------------------------------ *
   * codec
   * ------------------------------------------------------------------ */

  function createCodec(schema, meta) {
    assertSupported(schema);
    if (meta.protocol !== PROTOCOL) throw new CodecError('SCHEMA_UNSUPPORTED', 'protocol-meta mismatch');
    const byType = new Map();
    for (const branch of schema.oneOf) byType.set(branch.properties.type.const, branch);
    const dirs = {
      client_to_server: new Set(meta.directions.client_to_server),
      server_to_client: new Set(meta.directions.server_to_client)
    };
    const caps = meta.decoded_payload_caps || {};
    const bin = meta.binary || null;
    const maxBytes = meta.max_envelope_bytes || MAX_ENVELOPE_BYTES;

    function validate(msg, direction) {
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) throw new CodecError('BAD_MESSAGE', 'envelope must be an object');
      const branch = typeof msg.type === 'string' ? byType.get(msg.type) : undefined;
      if (!branch) throw new CodecError('BAD_MESSAGE', 'unknown type');
      const err = check(msg, branch, '$');
      if (err) throw new CodecError('BAD_MESSAGE', err);
      if (!dirs[direction] || !dirs[direction].has(msg.type)) throw new CodecError('WRONG_DIRECTION', `${msg.type} not allowed ${direction}`);
      if (('sid' in msg) !== ('epoch' in msg)) throw new CodecError('BAD_MESSAGE', 'sid and epoch must appear together');
      if (caps[msg.type] !== undefined) {
        const raw = b64decode(msg.payload.data); // canonical check + decoded size
        if (raw.length > caps[msg.type]) throw new CodecError('LIMIT_EXCEEDED', `${msg.type} decoded bytes ${raw.length} > ${caps[msg.type]}`);
        return raw;
      }
      return null;
    }

    /**
     * Decode one complete WebSocket text message.
     * @param {Uint8Array|string} input  raw UTF-8 bytes (preferred) or an already-decoded string
     * @returns {{msg:object, bytes:Uint8Array|null}} bytes = decoded terminal payload when applicable
     */
    function decode(input, direction) {
      let text;
      if (typeof input === 'string') {
        if (input.length > maxBytes) throw new CodecError('LIMIT_EXCEEDED', 'envelope too large');
        const b = utf8(input);
        if (b.length > maxBytes) throw new CodecError('LIMIT_EXCEEDED', 'envelope too large');
        text = input;
      } else {
        if (input.length > maxBytes) throw new CodecError('LIMIT_EXCEEDED', 'envelope too large');
        try { text = utf8Strict(input); } catch { throw new CodecError('BAD_UTF8', 'invalid UTF-8'); }
      }
      const msg = strictParse(text);
      const bytes = validate(msg, direction);
      return { msg, bytes };
    }

    /** Validate + serialize an outbound envelope; throws rather than emit an invalid message. */
    function encode(msg, direction) {
      validate(msg, direction);
      const text = JSON.stringify(msg);
      if (utf8(text).length > maxBytes) throw new CodecError('LIMIT_EXCEEDED', 'envelope too large');
      return text;
    }

    /* ---- binary data messages (v2) ---- */
    const U48_MAX = 281474976710655;
    /** Parse a complete binary message WITHOUT copying the payload. @returns {{kind:'input'|'output', seq:number, payload:Uint8Array}} */
    function decodeData(bytes, direction) {
      if (!bin) throw new CodecError('UNSUPPORTED', 'binary messages are not part of this protocol');
      if (bytes.length < bin.header_bytes + 1) throw new CodecError('BAD_MESSAGE', 'data message without payload');
      const kind = bytes[0] === bin.kinds.input ? 'input' : bytes[0] === bin.kinds.output ? 'output' : null;
      if (!kind) throw new CodecError('BAD_MESSAGE', 'unknown data kind');
      if (bin.direction[kind] !== direction) throw new CodecError('WRONG_DIRECTION', `${kind} not allowed ${direction}`);
      const seq = bytes[1] * 1099511627776 + bytes[2] * 4294967296 + bytes[3] * 16777216 + bytes[4] * 65536 + bytes[5] * 256 + bytes[6];
      if (seq < 1) throw new CodecError('BAD_MESSAGE', 'seq must be >= 1');
      const n = bytes.length - bin.header_bytes;
      if (n > bin.payload_caps[kind]) throw new CodecError('LIMIT_EXCEEDED', `${kind} payload ${n} > ${bin.payload_caps[kind]}`);
      return { kind, seq, payload: bytes.subarray(bin.header_bytes) };
    }
    /** Write the 7-byte header into `target` (length >= 7). The payload is sent as a separate write: no concatenation copy. */
    function writeDataHeader(target, kind, seq) {
      if (!Number.isSafeInteger(seq) || seq < 1 || seq > U48_MAX) throw new CodecError('LIMIT_EXCEEDED', 'seq outside uint48');
      target[0] = bin.kinds[kind];
      let hi = Math.floor(seq / 4294967296), lo = seq >>> 0;
      target[1] = (hi >>> 8) & 255; target[2] = hi & 255; target[3] = (lo >>> 24) & 255; target[4] = (lo >>> 16) & 255; target[5] = (lo >>> 8) & 255; target[6] = lo & 255;
      return target;
    }
    return { decode, encode, validate, maxBytes, caps, types: [...byType.keys()], decodeData, writeDataHeader, binary: bin, U48_MAX };
  }

  /** Standalone data-header writer for environments that build messages before a codec exists (browser input path). */
  function writeDataHeaderRaw(target, kindByte, seq) {
    if (!Number.isSafeInteger(seq) || seq < 1 || seq > 281474976710655) throw new CodecError('LIMIT_EXCEEDED', 'seq outside uint48');
    target[0] = kindByte; const hi = Math.floor(seq / 4294967296), lo = seq >>> 0;
    target[1] = (hi >>> 8) & 255; target[2] = hi & 255; target[3] = (lo >>> 24) & 255; target[4] = (lo >>> 16) & 255; target[5] = (lo >>> 8) & 255; target[6] = lo & 255; return target;
  }

  /** Base64url random identifier (rid / nonce / sid) from a byte source. */
  function b64url(bytes) { return b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  return { PROTOCOL, MAX_ENVELOPE_BYTES, SAFE, CodecError, strictParse, createCodec, b64encode, b64decode, b64url, utf8, utf8Strict, check, writeDataHeaderRaw };
}
const adaptedCodec=makeCodec();
export const { PROTOCOL, MAX_ENVELOPE_BYTES, SAFE, CodecError, strictParse, createCodec, b64encode, b64decode, b64url, utf8, utf8Strict, check, writeDataHeaderRaw } = adaptedCodec;
export const HERMIT_SCHEMA = {
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "$id": "urn:hermit:vws:envelope:2",
 "title": "hermit.vws.v2 control envelope (JSON text messages)",
 "description": "ADAPTATION for RAMWS. Terminal bytes are NOT carried here: they travel in binary WebSocket messages described in protocol-meta.json. Same strictness as v1: strict UTF-8, duplicate keys rejected, 65536-byte cap before parse.",
 "oneOf": [
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "hello"
    },
    "payload": {
     "type": "object",
     "properties": {
      "protocol": {
       "const": "hermit.vws.v2"
      },
      "serverEpoch": {
       "type": "string",
       "minLength": 16,
       "maxLength": 64,
       "pattern": "^[A-Za-z0-9_-]+$"
      },
      "profile": {
       "enum": [
        "LOCAL_VOLATILE"
       ]
      },
      "limits": {
       "type": "object",
       "properties": {
        "envelopeBytes": {
         "type": "integer",
         "minimum": 0,
         "maximum": 9007199254740991
        },
        "inputBytes": {
         "type": "integer",
         "minimum": 0,
         "maximum": 9007199254740991
        },
        "outputChunkBytes": {
         "type": "integer",
         "minimum": 0,
         "maximum": 9007199254740991
        },
        "maxCreditWindowBytes": {
         "type": "integer",
         "minimum": 0,
         "maximum": 9007199254740991
        },
        "maxSessions": {
         "type": "integer",
         "minimum": 0,
         "maximum": 9007199254740991
        }
       },
       "required": [
        "envelopeBytes",
        "inputBytes",
        "outputChunkBytes",
        "maxCreditWindowBytes",
        "maxSessions"
       ],
       "additionalProperties": false
      },
      "capabilities": {
       "type": "object",
       "properties": {
        "resume": {
         "type": "boolean"
        },
        "browserPane": {
         "type": "boolean"
        },
        "virtualCommands": {
         "type": "boolean"
        },
        "fabric": {
         "type": "boolean"
        }
       },
       "required": [
        "resume",
        "browserPane",
        "virtualCommands",
        "fabric"
       ],
       "additionalProperties": false
      }
     },
     "required": [
      "protocol",
      "serverEpoch",
      "profile",
      "limits",
      "capabilities"
     ],
     "additionalProperties": false
    }
   },
   "required": [
    "v",
    "type",
    "payload"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "session.open"
    },
    "payload": {
     "type": "object",
     "properties": {
      "cols": {
       "type": "integer",
       "minimum": 2,
       "maximum": 400
      },
      "rows": {
       "type": "integer",
       "minimum": 1,
       "maximum": 200
      },
      "mode": {
       "const": "virtual"
      },
      "creditBytes": {
       "type": "integer",
       "minimum": 0,
       "maximum": 9007199254740991
      },
      "previous": {
       "type": "object",
       "properties": {
        "sid": {
         "type": "string",
         "minLength": 22,
         "maxLength": 64,
         "pattern": "^[A-Za-z0-9_-]+$"
        },
        "epoch": {
         "type": "string",
         "minLength": 16,
         "maxLength": 64,
         "pattern": "^[A-Za-z0-9_-]+$"
        },
        "pendingInputs": {
         "type": "integer",
         "minimum": 0,
         "maximum": 1000000
        }
       },
       "required": [
        "sid",
        "epoch",
        "pendingInputs"
       ],
       "additionalProperties": false
      }
     },
     "required": [
      "cols",
      "rows",
      "mode",
      "creditBytes"
     ],
     "additionalProperties": false
    },
    "rid": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "rid"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "session.reset"
    },
    "payload": {
     "type": "object",
     "properties": {
      "reason": {
       "enum": [
        "process_restart",
        "session_not_found",
        "instance_changed"
       ]
      },
      "outcome": {
       "enum": [
        "OUTCOME_UNKNOWN",
        "NO_PENDING_INPUT"
       ]
      },
      "previousEpoch": {
       "type": "string",
       "minLength": 16,
       "maxLength": 64,
       "pattern": "^[A-Za-z0-9_-]+$"
      },
      "pendingInputs": {
       "type": "integer",
       "minimum": 0,
       "maximum": 1000000
      }
     },
     "required": [
      "reason",
      "outcome",
      "previousEpoch",
      "pendingInputs"
     ],
     "additionalProperties": false
    },
    "rid": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "rid"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "session.opened"
    },
    "payload": {
     "type": "object",
     "properties": {
      "cols": {
       "type": "integer",
       "minimum": 2,
       "maximum": 400
      },
      "rows": {
       "type": "integer",
       "minimum": 1,
       "maximum": 200
      }
     },
     "required": [
      "cols",
      "rows"
     ],
     "additionalProperties": false
    },
    "rid": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "sid": {
     "type": "string",
     "minLength": 22,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "epoch": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "rid",
    "sid",
    "epoch"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "terminal.resize"
    },
    "payload": {
     "type": "object",
     "properties": {
      "cols": {
       "type": "integer",
       "minimum": 2,
       "maximum": 400
      },
      "rows": {
       "type": "integer",
       "minimum": 1,
       "maximum": 200
      }
     },
     "required": [
      "cols",
      "rows"
     ],
     "additionalProperties": false
    },
    "rid": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "sid": {
     "type": "string",
     "minLength": 22,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "epoch": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "rid",
    "sid",
    "epoch"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "terminal.signal"
    },
    "payload": {
     "type": "object",
     "properties": {
      "signal": {
       "const": "SIGINT"
      }
     },
     "required": [
      "signal"
     ],
     "additionalProperties": false
    },
    "rid": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "sid": {
     "type": "string",
     "minLength": 22,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "epoch": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "rid",
    "sid",
    "epoch"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "request.ack"
    },
    "payload": {
     "type": "object",
     "properties": {
      "operation": {
       "enum": [
        "terminal.resize",
        "terminal.signal"
       ]
      },
      "stage": {
       "const": "accepted"
      }
     },
     "required": [
      "operation",
      "stage"
     ],
     "additionalProperties": false
    },
    "rid": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "sid": {
     "type": "string",
     "minLength": 22,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "epoch": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "rid",
    "sid",
    "epoch"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "input.ack"
    },
    "payload": {
     "type": "object",
     "properties": {
      "acceptedSeq": {
       "type": "integer",
       "minimum": 0,
       "maximum": 281474976710655
      },
      "executedSeq": {
       "type": "integer",
       "minimum": 0,
       "maximum": 281474976710655
      }
     },
     "required": [
      "acceptedSeq",
      "executedSeq"
     ],
     "additionalProperties": false
    },
    "sid": {
     "type": "string",
     "minLength": 22,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "epoch": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "sid",
    "epoch"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "flow.credit"
    },
    "payload": {
     "type": "object",
     "properties": {
      "consumedSeq": {
       "type": "integer",
       "minimum": 0,
       "maximum": 281474976710655
      },
      "creditBytes": {
       "type": "integer",
       "minimum": 0,
       "maximum": 9007199254740991
      }
     },
     "required": [
      "consumedSeq",
      "creditBytes"
     ],
     "additionalProperties": false
    },
    "sid": {
     "type": "string",
     "minLength": 22,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "epoch": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "sid",
    "epoch"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "session.close"
    },
    "payload": {
     "type": "object",
     "properties": {
      "reason": {
       "enum": [
        "user",
        "logout",
        "client_shutdown"
       ]
      }
     },
     "required": [
      "reason"
     ],
     "additionalProperties": false
    },
    "rid": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "sid": {
     "type": "string",
     "minLength": 22,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "epoch": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "rid",
    "sid",
    "epoch"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "session.exit"
    },
    "payload": {
     "type": "object",
     "properties": {
      "code": {
       "type": "integer",
       "minimum": 0,
       "maximum": 255
      },
      "reason": {
       "enum": [
        "closed",
        "logout",
        "worker_failure",
        "quota",
        "shutdown",
        "expired"
       ]
      }
     },
     "required": [
      "code",
      "reason"
     ],
     "additionalProperties": false
    },
    "sid": {
     "type": "string",
     "minLength": 22,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    },
    "epoch": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "sid",
    "epoch"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "heartbeat.ping"
    },
    "payload": {
     "type": "object",
     "properties": {
      "nonce": {
       "type": "string",
       "minLength": 16,
       "maxLength": 64,
       "pattern": "^[A-Za-z0-9_-]+$"
      }
     },
     "required": [
      "nonce"
     ],
     "additionalProperties": false
    },
    "rid": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "rid"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "heartbeat.pong"
    },
    "payload": {
     "type": "object",
     "properties": {
      "nonce": {
       "type": "string",
       "minLength": 16,
       "maxLength": 64,
       "pattern": "^[A-Za-z0-9_-]+$"
      }
     },
     "required": [
      "nonce"
     ],
     "additionalProperties": false
    },
    "rid": {
     "type": "string",
     "minLength": 16,
     "maxLength": 64,
     "pattern": "^[A-Za-z0-9_-]+$"
    }
   },
   "required": [
    "v",
    "type",
    "payload",
    "rid"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "service.draining"
    },
    "payload": {
     "type": "object",
     "properties": {
      "deadlineMs": {
       "type": "integer",
       "minimum": 0,
       "maximum": 300000
      },
      "reason": {
       "enum": [
        "deploy",
        "shutdown",
        "maintenance",
        "capacity"
       ]
      }
     },
     "required": [
      "deadlineMs",
      "reason"
     ],
     "additionalProperties": false
    }
   },
   "required": [
    "v",
    "type",
    "payload"
   ],
   "additionalProperties": false
  },
  {
   "type": "object",
   "properties": {
    "v": {
     "const": 2
    },
    "type": {
     "const": "error"
    },
    "payload": {
     "type": "object",
     "properties": {
      "code": {
       "enum": [
        "UNAUTHORIZED",
        "FORBIDDEN",
        "BAD_MESSAGE",
        "LIMIT_EXCEEDED",
        "UNSUPPORTED",
        "NOT_READY",
        "STALE_EPOCH",
        "OUTCOME_UNKNOWN",
        "CREDIT_VIOLATION",
        "INTERNAL"
       ]
      },
      "message": {
       "type": "string",
       "maxLength": 256
      },
      "retryable": {
       "type": "boolean"
      }
     },
     "required": [
      "code",
      "message",
      "retryable"
     ],
     "additionalProperties": false
    }
   },
   "required": [
    "v",
    "type",
    "payload"
   ],
   "additionalProperties": false
  }
 ]
};
export const HERMIT_META = {
 "protocol": "hermit.vws.v2",
 "status": "IMPLEMENTED_IN_CANDIDATE",
 "max_envelope_bytes": 65536,
 "directions": {
  "client_to_server": [
   "session.open",
   "terminal.resize",
   "terminal.signal",
   "session.close",
   "flow.credit",
   "heartbeat.ping",
   "heartbeat.pong"
  ],
  "server_to_client": [
   "hello",
   "session.reset",
   "session.opened",
   "request.ack",
   "input.ack",
   "session.exit",
   "heartbeat.ping",
   "heartbeat.pong",
   "service.draining",
   "error"
  ]
 },
 "binary": {
  "header_bytes": 7,
  "layout": "byte0 kind | bytes1..6 uint48 big-endian seq | bytes7.. raw terminal bytes",
  "kinds": {
   "input": 1,
   "output": 2
  },
  "direction": {
   "input": "client_to_server",
   "output": "server_to_client"
  },
  "payload_caps": {
   "input": 8192,
   "output": 16384
  },
  "zero_length": "rejected as BAD_MESSAGE (a data message always carries at least one byte; end of session is session.exit/Close, never an empty payload)",
  "seq": "starts at 1, strictly +1 per direction per session; uint48 is exactly representable in an ECMAScript Number (2^48 < 2^53); the connection is ended before 2^48-1"
 },
 "kit_kind_map": {
  "OPEN": "session.open",
  "INPUT": "binary kind 1",
  "OUTPUT": "binary kind 2",
  "RESIZE": "terminal.resize",
  "SIGNAL": "terminal.signal",
  "CLOSE": "session.close",
  "CREDIT": "flow.credit",
  "ACK": "input.ack (ACK_ACCEPTED/ACK_EXECUTED), request.ack, flow.credit.consumedSeq (ACK_CONSUMED)",
  "ERROR": "error",
  "SESSION_RESET": "session.reset"
 },
 "ack_semantics": {
  "acceptedSeq": "highest input seq accepted into this process's bounded RAM \u2014 not executed, not durable",
  "executedSeq": "highest input seq that had been delivered to the shell when a command line last COMPLETED under this epoch",
  "consumedSeq": "highest contiguous output seq the client has handed to its renderer"
 },
 "credit": {
  "creditBytes": "cumulative total of output payload bytes the client has authorized for this session; the server sends output only while sentBytes + next <= creditBytes",
  "rules": [
   "monotone non-decreasing",
   "creditBytes - consumedBytes(consumedSeq) <= limits.maxCreditWindowBytes",
   "consumedSeq <= last output seq sent",
   "violations -> error CREDIT_VIOLATION and close 1008"
  ]
 },
 "not_schema_enforced": [
  "authentication",
  "Origin policy",
  "sid/epoch ownership",
  "sequence monotonicity",
  "credit arithmetic",
  "rate limits",
  "ledger admission",
  "open-before-output ordering",
  "single exit"
 ]
};
export const SOURCE_VERSION = "2.0.0-ramws.1";
export function createHermitCodec(){return createCodec(HERMIT_SCHEMA,HERMIT_META);}
