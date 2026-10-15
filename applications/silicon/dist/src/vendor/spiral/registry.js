// @ts-nocheck


/**
 * SPIRAL — Command Registry
 * ---------------------------------------------------------------------------
 * The extension surface. A command is a plain descriptor:
 *
 *   {
 *     name: 'ls',
 *     summary: 'list directory contents',
 *     usage: 'ls [-l] [-a] [path...]',
 *     flags: { l: 'long listing', a: 'include dotfiles' },   // for help + parsing
 *     complete?: (ctx, partial) => string[],                 // tab-completion hook
 *     run: async (ctx) => number                             // returns exit code
 *   }
 *
 * `ctx` (built by the kernel per invocation) provides:
 *   ctx.argv     string[]  raw args after the command name
 *   ctx.args     string[]  positional args (flags removed)
 *   ctx.flags    object    parsed flags (see parseFlags)
 *   ctx.stdin    Readable-ish { read(): string }
 *   ctx.stdout   { write(str) }
 *   ctx.stderr   { write(str) }
 *   ctx.env      Environment
 *   ctx.session  session handle (cwd, etc.)
 *   ctx.vfs      VFS
 *   ctx.host     host bridge (browser control, titles…)
 *   ctx.registry this registry (for help/introspection)
 *   ctx.signal   AbortSignal for the running pipeline
 *
 * Register third-party command packs with `registry.install(pack)` where a pack
 * is an array of descriptors or a `{ commands: [...] }` object.
 */

class CommandRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.commands = new Map();
    /** @type {Map<string, string>} */
    this.aliases = new Map();
  }

  register(descriptor) {
    if (!descriptor || !descriptor.name || typeof descriptor.run !== 'function') {
      throw new Error('registry.register: descriptor needs { name, run }');
    }
    this.commands.set(descriptor.name, descriptor);
    for (const a of descriptor.aka || []) this.aliases.set(a, descriptor.name);
    return this;
  }

  install(pack) {
    const list = Array.isArray(pack) ? pack : pack && pack.commands;
    if (!Array.isArray(list)) throw new Error('registry.install: expected array or { commands: [] }');
    for (const d of list) this.register(d);
    return this;
  }

  alias(name, target) {
    this.aliases.set(name, target);
    return this;
  }

  resolve(name) {
    if (this.commands.has(name)) return this.commands.get(name);
    if (this.aliases.has(name)) return this.commands.get(this.aliases.get(name));
    return null;
  }

  has(name) {
    return this.commands.has(name) || this.aliases.has(name);
  }

  list() {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Names + alias names, for completion. */
  names() {
    return [...this.commands.keys(), ...this.aliases.keys()].sort();
  }
}

/**
 * Minimal getopt-style flag parser.
 *  - `-abc`     -> boolean flags a, b, c
 *  - `-o value` -> only when the flag is declared as taking a value
 *  - `--long`   -> boolean; `--key=val` -> value
 *  - `--`       -> end of options; everything after is positional
 *
 * `spec.valued` lists short flags that consume the next token as a value.
 */
function parseFlags(argv, spec = {}) {
  const valued = new Set(spec.valued || []), flags = Object.create(null), args = [];
  let ended = false;
  const take = (i, key) => { if (i + 1 >= argv.length) throw new Error(`missing value for ${key}`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (typeof tok !== 'string') throw new TypeError('argument must be a string');
    if (ended || tok === '-' || !tok.startsWith('-') || /^-(?:\d|\.\d)/.test(tok)) { args.push(tok); continue; }
    if (tok === '--') { ended = true; continue; }
    const body = tok.replace(/^--?/, '');
    if (tok.startsWith('--')) {
      const eq = body.indexOf('=');
      if (eq >= 0) flags[body.slice(0, eq)] = body.slice(eq + 1);
      else if (valued.has(body)) { flags[body] = take(i, body); i++; }
      else flags[body] = true;
    } else if (valued.has(body)) { flags[body] = take(i, body); i++; }
    else for (let j = 0; j < body.length; j++) {
      const key = body[j];
      if (valued.has(key)) { flags[key] = body.slice(j + 1) || take(i++, key); break; }
      flags[key] = true;
    }
  }
  return { flags, args };
}

export { CommandRegistry, parseFlags };
