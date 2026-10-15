// @ts-nocheck
import { Buffer } from './buffer.js';

/**
 * SPIRAL — Virtual File System
 * ---------------------------------------------------------------------------
 * An in-memory POSIX-ish filesystem. Nodes are either directories (children map)
 * or files (string/Buffer contents). Paths are normalized with a small path
 * engine so `.`, `..`, absolute and relative forms all behave.
 *
 * The live tree is the page cache. Mutations notify `onMutate` so the host can
 * flush the snapshot onto the SSD volume. A host-backed provider can replace
 * this class later by implementing the same read/write/stat surface.
 */

const SEP = '/';
const MAX_DEPTH = 64;
function validName(n) { return typeof n === 'string' && n.length > 0 && n.length <= 255 && n !== '.' && n !== '..' && !/[\/\\\x00-\x1f\x7f]/.test(n); }
function normal(p) { if (typeof p !== 'string' || !p.startsWith('/')) throw new VFSError('EINVAL', 'absolute path required'); return resolvePath('/', p); }

/* --------------------------------------------------------------------------
 * path utilities
 * ------------------------------------------------------------------------ */

function splitPath(p) {
  return String(p).split(SEP).filter((seg) => seg.length > 0);
}

/** Resolve `input` against `cwd` into a normalized absolute path. */
function resolvePath(cwd, input) {
  const raw = String(input == null ? '' : input);
  if (raw.length > 4096 || /[\\\x00-\x1f\x7f]/.test(raw)) throw new VFSError('EINVAL', 'invalid path');
  const startAbs = raw.startsWith(SEP);
  if (!startAbs && (typeof cwd !== 'string' || !cwd.startsWith(SEP))) throw new VFSError('EINVAL', 'absolute working directory required');
  const parts = startAbs ? [] : splitPath(resolvePath('/', cwd));
  for (const seg of splitPath(raw)) {
    if (seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    if (!validName(seg)) throw new VFSError('EINVAL', 'invalid path component');
    parts.push(seg);
    if (parts.length > MAX_DEPTH) throw new VFSError('EINVAL', 'path too deep');
  }
  const resolved = SEP + parts.join(SEP);
  if (resolved.length > 4096) throw new VFSError('EINVAL', 'path too long');
  return resolved;
}

function basename(p) {
  const parts = splitPath(p);
  return parts.length ? parts[parts.length - 1] : '';
}

function dirname(p) {
  const parts = splitPath(p);
  parts.pop();
  return SEP + parts.join(SEP);
}

/* --------------------------------------------------------------------------
 * nodes
 * ------------------------------------------------------------------------ */

function dirNode() {
  return { type: 'dir', children: new Map(), mtime: Date.now(), mode: 0o755 };
}
function fileNode(contents = '') {
  return { type: 'file', contents, mtime: Date.now(), mode: 0o644 };
}

class VFSError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'VFSError';
  }
}

/** Content size of a file node's payload in bytes (string => UTF-8 length). */
function contentBytes(c) { return Buffer.isBuffer(c) ? c.length : Buffer.byteLength(String(c)); }

/** Byte-preserving concatenation: a Buffer on either side keeps raw bytes (series F09 / I028). */
function concatContents(a, b) {
  if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) {
    return Buffer.concat([Buffer.isBuffer(a) ? a : Buffer.from(String(a), 'utf8'), Buffer.isBuffer(b) ? b : Buffer.from(String(b), 'utf8')]);
  }
  return a + b;
}

function subtreeCost(node) {
  if (node.type === 'file') return { bytes: contentBytes(node.contents), nodes: 1 };
  let bytes = 0, nodes = 1;
  for (const c of node.children.values()) { const r = subtreeCost(c); bytes += r.bytes; nodes += r.nodes; }
  return { bytes, nodes };
}

class VFS {
  /**
   * @param {object} [limits]
   * @param {number} [limits.maxBytes]  total file-content bytes (default 2 MiB)
   * @param {number} [limits.maxNodes]  total files + directories, root included
   */
  constructor(limits = {}) {
    this.maxBytes = limits.maxBytes === undefined ? 2 * 1024 * 1024 : limits.maxBytes;
    this.maxNodes = limits.maxNodes === undefined ? 1500 : limits.maxNodes;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 0 || !Number.isSafeInteger(this.maxNodes) || this.maxNodes < 1) throw new VFSError('EINVAL', 'invalid filesystem quota');
    this.usedBytes = 0;
    this.nodeCount = 1;
    this.root = dirNode();
    this.onMutate = () => {};
    if (limits.seed !== false) this._seed();
  }

  /** Reserve quota or throw before any mutation happens (atomic accounting). */
  _reserve(deltaBytes, deltaNodes) {
    if (this.usedBytes + deltaBytes > this.maxBytes) throw new VFSError('EDQUOT', `workspace byte quota exceeded (${this.maxBytes} bytes)`);
    if (this.nodeCount + deltaNodes > this.maxNodes) throw new VFSError('EDQUOT', `workspace node quota exceeded (${this.maxNodes} nodes)`);
    this.usedBytes += deltaBytes;
    this.nodeCount += deltaNodes;
  }

  usage() { return { bytes: this.usedBytes, nodes: this.nodeCount, maxBytes: this.maxBytes, maxNodes: this.maxNodes }; }

  /* ---- traversal ------------------------------------------------------- */

  _walk(absPath, { parents = false } = {}) {
    const parts = splitPath(normal(absPath));
    let node = this.root;
    for (let i = 0; i < parts.length; i++) {
      if (node.type !== 'dir') throw new VFSError('ENOTDIR', `not a directory: ${parts[i - 1]}`);
      let next = node.children.get(parts[i]);
      if (!next) {
        if (parents) {
          // Reserve the entire missing suffix before committing any directory.
          this._reserve(0, parts.length - i);
          for (; i < parts.length; i++) { next = dirNode(); node.children.set(parts[i], next); node = next; }
          return node;
        }
        else throw new VFSError('ENOENT', `no such file or directory: ${absPath}`);
      }
      node = next;
    }
    return node;
  }

  stat(absPath) {
    const node = this._walk(absPath);
    return {
      path: absPath,
      type: node.type,
      size: node.type === 'file' ? contentBytes(node.contents) : node.children.size,
      mtime: node.mtime,
      mode: node.mode
    };
  }

  exists(absPath) {
    try { this._walk(absPath); return true; } catch { return false; }
  }

  isDir(absPath) {
    try { return this._walk(absPath).type === 'dir'; } catch { return false; }
  }

  /* ---- files ----------------------------------------------------------- */

  readFile(absPath) {
    const node = this._walk(absPath);
    if (node.type !== 'file') throw new VFSError('EISDIR', `is a directory: ${absPath}`);
    return Buffer.isBuffer(node.contents) ? Buffer.from(node.contents) : node.contents;
  }

  writeFile(absPath, contents, { append = false } = {}) {
    absPath = normal(absPath);
    if (absPath === '/') throw new VFSError('EPERM', 'cannot replace root');
    const parent = this._walk(dirname(absPath));
    if (parent.type !== 'dir') throw new VFSError('ENOTDIR', `not a directory: ${dirname(absPath)}`);
    const name = basename(absPath);
    const existing = parent.children.get(name);
    if (existing && existing.type === 'dir') throw new VFSError('EISDIR', `is a directory: ${absPath}`);
    if (contents instanceof Uint8Array) contents = Buffer.from(contents);
    else contents = String(contents == null ? '' : contents);
    if (existing && append && existing.type === 'file') {
      this._reserve(contentBytes(contents), 0);
      existing.contents = concatContents(existing.contents, contents);
      existing.mtime = Date.now();
    } else {
      const old = existing ? contentBytes(existing.contents) : 0;
      this._reserve(contentBytes(contents) - old, existing ? 0 : 1);
      parent.children.set(name, fileNode(contents));
    }
    this.onMutate();
    return true;
  }

  /* ---- directories ----------------------------------------------------- */

  mkdir(absPath, { recursive = false } = {}) {
    absPath = normal(absPath);
    if (absPath === '/' && !recursive) throw new VFSError('EEXIST', 'root exists');
    if (recursive) { const node = this._walk(absPath, { parents: true }); if (node.type !== 'dir') throw new VFSError('ENOTDIR', `not a directory: ${absPath}`); this.onMutate(); return true; }
    const parent = this._walk(dirname(absPath));
    if (parent.type !== 'dir') throw new VFSError('ENOTDIR', `not a directory: ${dirname(absPath)}`);
    const name = basename(absPath);
    if (parent.children.has(name)) throw new VFSError('EEXIST', `file exists: ${absPath}`);
    this._reserve(0, 1);
    parent.children.set(name, dirNode());
    this.onMutate();
    return true;
  }

  readdir(absPath) {
    const node = this._walk(absPath);
    if (node.type !== 'dir') throw new VFSError('ENOTDIR', `not a directory: ${absPath}`);
    return [...node.children.entries()].map(([name, n]) => ({
      name,
      type: n.type,
      size: n.type === 'file' ? contentBytes(n.contents) : n.children.size,
      mtime: n.mtime,
      mode: n.mode
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  remove(absPath, { recursive = false } = {}) {
    absPath = normal(absPath);
    if (absPath === SEP) throw new VFSError('EPERM', 'cannot remove root');
    const parent = this._walk(dirname(absPath));
    if (parent.type !== 'dir') throw new VFSError('ENOTDIR', `not a directory: ${dirname(absPath)}`);
    const name = basename(absPath);
    const node = parent.children.get(name);
    if (!node) throw new VFSError('ENOENT', `no such file or directory: ${absPath}`);
    if (node.type === 'dir' && node.children.size > 0 && !recursive) {
      throw new VFSError('ENOTEMPTY', `directory not empty: ${absPath}`);
    }
    const cost = subtreeCost(node);
    parent.children.delete(name);
    this.usedBytes -= cost.bytes;
    this.nodeCount -= cost.nodes;
    this.onMutate();
    return true;
  }

  move(fromAbs, toAbs) {
    fromAbs = normal(fromAbs); toAbs = normal(toAbs);
    if (fromAbs === "/") throw new VFSError("EPERM", "cannot move root");
    const node = this._walk(fromAbs);
    const destExistsDir = this.isDir(toAbs);
    const finalPath = destExistsDir ? resolvePath(toAbs, basename(fromAbs)) : toAbs;
    if (finalPath === fromAbs) return finalPath;
    if (node.type === 'dir' && (finalPath + SEP).startsWith(fromAbs + SEP)) throw new VFSError('EINVAL', 'cannot move a directory into itself');
    const destParent = this._walk(dirname(finalPath));
    if (destParent.type !== 'dir') throw new VFSError('ENOTDIR', `not a directory: ${dirname(finalPath)}`);
    const replaced = destParent.children.get(basename(finalPath));
    if (replaced && replaced.type !== node.type) throw new VFSError('EINVAL', 'incompatible destination type');
    if (replaced && replaced.type === 'dir' && replaced.children.size) throw new VFSError('ENOTEMPTY', 'destination directory not empty');
    if (replaced) { const c = subtreeCost(replaced); this.usedBytes -= c.bytes; this.nodeCount -= c.nodes; }
    destParent.children.set(basename(finalPath), node);
    const srcParent = this._walk(dirname(fromAbs));
    srcParent.children.delete(basename(fromAbs));
    this.onMutate();
    return finalPath;
  }

  touch(absPath) {
    absPath = normal(absPath);
    if (!this.exists(absPath)) return this.writeFile(absPath, '');
    const n = this._walk(absPath); n.mtime = Date.now(); this.onMutate(); return true;
  }

  canonicalSnapshot() {
    const scrub = (n) => { const o = { ...n }; delete o.t; if (o.ch) o.ch = o.ch.map(([k,v]) => [k,scrub(v)]).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); return o; };
    return { v: 1, root: scrub(this.exportSnapshot().root) };
  }

  /* ---- quiescent snapshot (series I038) -------------------------------- */

  /** Explicit, versioned, byte-exact serialization. Buffers and strings keep their kind. */
  exportSnapshot() {
    const enc = (node) => node.type === 'file'
      ? { k: 'f', m: node.mode, t: node.mtime, e: Buffer.isBuffer(node.contents) ? 'b64' : 'utf8', c: Buffer.isBuffer(node.contents) ? node.contents.toString('base64') : node.contents }
      : { k: 'd', m: node.mode, t: node.mtime, ch: [...node.children.entries()].map(([n, c]) => [n, enc(c)]) };
    return { v: 1, root: enc(this.root) };
  }

  /** Validate fully (shape, names, quotas) into a detached tree, then swap. Never partially applies. */
  importSnapshot(snap) {
    if (!snap || snap.v !== 1 || !snap.root || snap.root.k !== 'd') throw new VFSError('EINVAL', 'unsupported snapshot');
    let bytes = 0, nodes = 0;
    const dec = (o, depth, pathLength = 0) => {
      if (depth > MAX_DEPTH || pathLength > 4096) throw new VFSError('EINVAL', 'snapshot path limit');
      if (!o || !Number.isInteger(o.m) || o.m < 0 || o.m > 0o7777 || !Number.isSafeInteger(o.t) || o.t < 0) throw new VFSError('EINVAL', 'bad node metadata');
      nodes++;
      if (nodes > this.maxNodes) throw new VFSError('EDQUOT', 'snapshot node quota');
      if (o && o.k === 'f') {
        if (typeof o.c !== 'string' || (o.e !== 'utf8' && o.e !== 'b64')) throw new VFSError('EINVAL', 'bad file record');
        if (o.c.length > Math.ceil(this.maxBytes / 3) * 4 + 4) throw new VFSError('EDQUOT', 'encoded content quota');
        if (o.e === 'b64' && (o.c.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(o.c))) throw new VFSError('EINVAL', 'invalid base64');
        const contents = o.e === 'b64' ? Buffer.from(o.c, 'base64') : o.c;
        bytes += contentBytes(contents);
        if (bytes > this.maxBytes) throw new VFSError('EDQUOT', 'snapshot byte quota');
        const n = fileNode(contents); n.mode = o.m; n.mtime = o.t; return n;
      }
      if (o && o.k === 'd' && Array.isArray(o.ch)) {
        const n = dirNode(); n.mode = o.m; n.mtime = o.t;
        for (const pair of o.ch) {
          if (!Array.isArray(pair) || pair.length !== 2 || !validName(pair[0])) throw new VFSError('EINVAL', 'bad entry name');
          if (n.children.has(pair[0])) throw new VFSError('EINVAL', 'duplicate entry');
          n.children.set(pair[0], dec(pair[1], depth + 1, pathLength + pair[0].length + 1));
        }
        return n;
      }
      throw new VFSError('EINVAL', 'bad node record');
    };
    const root = dec(snap.root, 0);
    this.root = root; this.usedBytes = bytes; this.nodeCount = nodes;
    this.onMutate();
    return this.usage();
  }

  /* ---- seed content ---------------------------------------------------- */

  _seed() {
    this.mkdir('/home', { recursive: true });
    this.mkdir('/home/operator', { recursive: true });
    this.mkdir('/etc', { recursive: true });
    this.mkdir('/var/log', { recursive: true });
    this.mkdir('/tmp', { recursive: true });
    this.writeFile('/etc/hermit.conf',
      '# HERMIT runtime configuration\nbackend = SPIRAL\nvt = internal\nbrowser = host-browser\n');
    this.writeFile('/home/operator/README',
      'Welcome to HERMIT — a virtual terminal on the SPIRAL backend.\n' +
      'Type `help` for the command index, `about` for the architecture.\n');
    this.writeFile('/home/operator/.hermitrc',
      '# sourced at session start\nexport PS1="\\u@hermit:\\w$ "\nalias ll="ls -l"\n');
  }
}

export { VFS, VFSError, resolvePath, basename, dirname, splitPath, contentBytes };
