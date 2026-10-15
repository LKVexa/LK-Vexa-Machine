import test from 'node:test';
import assert from 'node:assert/strict';
import { Screen } from '../src/vendor/vt/screen.js';
import { Parser } from '../src/vendor/vt/parser.js';
import { CanvasRenderer } from '../src/vendor/vt/renderer-canvas.js';
import { SpiralKernel } from '../src/vendor/spiral/kernel.js';

test('VT: restoring a cursor saved before shrinking cannot crash later output', () => {
  const s = new Screen(100, 30), p = new Parser(s);
  p.write('\x1b[30;100H\x1b7');
  s.resize(10, 2);
  p.write('\x1b8X');
  assert.equal(s.grid[1][9].ch, 'X');
  assert.equal(s.cursor.y, 1);
});

test('VT: reset discards pending autowrap and the old saved cursor', () => {
  const s = new Screen(4, 2), p = new Parser(s);
  p.write('abcd\x1b7\x1bc\x1b8X');
  assert.equal(s.grid[0][0].ch, 'X');
  assert.equal(s.cursor.y, 0);
});

test('VT: clear scrollback resets its cell budget before later scrolling', () => {
  const s = new Screen(4, 2), p = new Parser(s);
  p.write('a\r\nb\r\nc\r\n');
  assert(s.scrollbackCells > 0);
  p.write('\x1b[3J');
  assert.equal(s.scrollbackCells, 0);
  p.write('d\r\ne\r\n');
  assert.equal(s.scrollbackCells, s.scrollback.reduce((n, row) => n + row.length, 0));
});

test('VT: unsupported escape forms cannot alias erase, cursor, or color operations', () => {
  const s = new Screen(10, 2), p = new Parser(s);
  p.write('visible');
  const grid = structuredClone(s.grid), cursor = { ...s.cursor };
  p.write('\x1b[?2J\x1b[2$J\x1b[1:2H\x1b(7');
  assert.deepEqual(s.grid, grid);
  assert.deepEqual(s.cursor, cursor);
  assert.equal(s.saved, null);
});

test('VT: malformed extended colors preserve the preceding valid pen', () => {
  const s = new Screen(10, 2), p = new Parser(s);
  p.write('\x1b[31m\x1b[38;5;999mX\x1b[38;2;1;2mY');
  assert.equal(s.grid[0][0].fg, 1);
  assert.equal(s.grid[0][1].fg, 1);
});

test('VT: conceal never draws its glyph under the block cursor', () => {
  const s = new Screen(4, 2), p = new Parser(s);
  p.write('\x1b[8msecret\x1b[1;1H');
  const glyphs = [];
  const ctx = new Proxy({}, { get: (o, k) => o[k] ?? (k === 'measureText' ? () => ({ width: 80 }) : k === 'fillText' ? text => glyphs.push(text) : () => {}) });
  const prior = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const renderer = new CanvasRenderer({ getContext: () => ctx, style: {}, width: 40, height: 40 }, s);
    renderer.render();
    assert.deepEqual(glyphs, []);
    renderer.scrollOffset = 100;
    s.eraseInDisplay(3);
    assert.equal(renderer._viewportRows(), s.grid);
    assert.equal(renderer.scrollOffset, 0);
  } finally { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; }
});

async function shell(line) {
  const k = new SpiralKernel();
  let output = '';
  k.on('data', e => { output += e.chunk; });
  const { sessionId } = k.openSession({ deferStart: true });
  try { return { code: await k._executeLine(k.sessions.get(sessionId), line), output, vfs: k.vfs }; }
  finally { k.closeSession(sessionId); }
}

test('commands: translation handles supplementary Unicode code points', async () => {
  assert.equal((await shell('printf "😀a😀" | tr "😀a" "🙂b"')).output, '🙂b🙂');
  for (const line of ['printf x | tr x', 'printf x | tr x ""', 'printf x | tr -d x y']) assert.notEqual((await shell(line)).code, 0);
});

test('commands: unsupported extra copy/move operands cannot silently mutate files', async () => {
  for (const command of ['cp', 'mv']) {
    const r = await shell(`write /tmp/a kept; ${command} /tmp/a /tmp/b /tmp/c`);
    assert.notEqual(r.code, 0);
    assert.equal(r.vfs.readFile('/tmp/a'), 'kept\n');
    assert.equal(r.vfs.exists('/tmp/b'), false);
  }
});

test('commands: find matches its root file and reports absent roots', async () => {
  const r = await shell('write /tmp/a kept; find /tmp/a -name a -type f');
  assert.equal(r.output, '/tmp/a\r\n');
  assert.notEqual((await shell('find /tmp/missing')).code, 0);
  assert.notEqual((await shell('rmdir')).code, 0);
  assert.equal((await shell('write /tmp/😀 kept; find /tmp/😀 -name 😀 -type f')).output, '/tmp/😀\r\n');
  assert.equal((await shell('write /tmp/😀 kept; find /tmp/😀 -name ? -type f')).output, '/tmp/😀\r\n');
});

test('VT: consecutive escapes restart the control sequence', () => {
  const s = new Screen(10, 2), p = new Parser(s);
  p.write('visible\x1b\x1b[2J');
  assert(s.grid.every(row => row.every(cell => cell.ch === ' ')));
});

test('commands: repeated alias definitions have an atomic count and UTF-8 storage bound', async () => {
  const k = new SpiralKernel(), { sessionId } = k.openSession({ deferStart: true }), s = k.sessions.get(sessionId);
  try {
    for (let i = 0; i < 128; i++) assert.equal(await k._executeLine(s, `alias a${i}='echo ok'`), 0);
    assert.notEqual(await k._executeLine(s, 'alias overflow=echo'), 0);
    assert.equal(Object.keys(s.aliases).length, 128);
    assert.equal(await k._executeLine(s, 'alias a0="echo replaced"'), 0);
    assert.equal(s.aliases.a0, 'echo replaced');
    await k._executeLine(s, 'unalias ' + Object.keys(s.aliases).join(' '));
    for (let i = 0; i < 17; i++) await k._executeLine(s, `alias b${i}='${'x'.repeat(4000)}'`);
    assert(Object.keys(s.aliases).length <= 16);
    assert.equal(s.aliases.b16, undefined);
  } finally { k.closeSession(sessionId); }
});
