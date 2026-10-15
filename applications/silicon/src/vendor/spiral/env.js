// @ts-nocheck


/**
 * SPIRAL — Environment
 * ---------------------------------------------------------------------------
 * A scoped variable store with copy-on-write child scopes, used for both shell
 * variables and per-command environments. Values are always strings, mirroring
 * POSIX environment semantics.
 */

const MAX_VARS = 256, MAX_ENV_BYTES = 65536;
const encoder = new TextEncoder();

class Environment {
  /** @param {Record<string,string>} [seed] @param {Environment|null} [parent] */
  constructor(seed = {}, parent = null) {
    this.parent = parent;
    /** @type {Map<string,string>} */
    this.vars = new Map();
    this.bytes = 0;
    for (const [k, v] of Object.entries(seed)) this.set(k, v);
  }

  get(name) {
    if (this.vars.has(name)) return this.vars.get(name);
    return this.parent ? this.parent.get(name) : undefined;
  }

  _store(name, value) {
    if (typeof name !== 'string' || !name.length || name.length > 256) throw new Error('invalid environment name');
    if (name === '?' && value !== undefined && value.length > 32) throw new Error('exit status value limit');
    // The shell's reserved status slot stays writable even at the user byte quota.
    const size = name === '?' ? 0 : encoder.encode(name).length + (value === undefined ? 0 : encoder.encode(value).length);
    const old = this.vars.has(name) && name !== '?' ? encoder.encode(name).length + (this.vars.get(name) === undefined ? 0 : encoder.encode(this.vars.get(name)).length) : 0;
    if ((!this.vars.has(name) && this.vars.size >= MAX_VARS) || this.bytes - old + size > MAX_ENV_BYTES) throw new Error('environment quota exceeded');
    this.vars.set(name, value); this.bytes += size - old;
    return this;
  }

  set(name, value) {
    value = value == null ? '' : String(value);
    if (value.length > MAX_ENV_BYTES) throw new Error('environment quota exceeded');
    return this._store(name, value);
  }

  unset(name) {
    const existed = this.has(name); this._store(name, undefined); return existed;
  }

  has(name) {
    return this.get(name) !== undefined;
  }

  /** Flattened view (child values shadow parent). */
  toObject() {
    const base = this.parent ? this.parent.toObject() : Object.create(null);
    for (const [k, v] of this.vars) { if (v === undefined) delete base[k]; else base[k] = v; }
    return base;
  }

  /** A child scope for a subshell / command invocation. */
  child(seed = {}) {
    return new Environment(seed, this);
  }
}

export { Environment };
