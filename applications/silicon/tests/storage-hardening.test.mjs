import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { SpiralKernel } from '../src/vendor/spiral/kernel.js';
import { VFS, resolvePath } from '../src/vendor/spiral/vfs.js';
import { Environment } from '../src/vendor/spiral/env.js';
import { parse, expandWord, tokenize } from '../src/vendor/spiral/pipeline.js';
import { writeVolume, readVolume, DEVICE } from '../src/vendor/spiral/ssd.js';
import { fakeIndexedDB } from './fake-idb.mjs';
import { crc32, decodeState } from '../src/vendor/spiral/state-codec.js';
import { RamLink } from '../src/lib/ram-link.js';
import { PROTOCOL } from '../src/vendor/vws/frame.js';
import { assertBackupSize, MAX_BACKUP_BYTES } from '../src/vendor/spiral/volume-format.js';

function shell(limits) {
  const kernel = new SpiralKernel({ limits });
  const { sessionId } = kernel.openSession({ deferStart: true });
  const session = kernel.sessions.get(sessionId);
  let output = '';
  kernel.on('data', event => { output += event.chunk; });
  return { kernel, session, sessionId, get output() { return output; }, run: line => kernel._executeLine(session, line) };
}

test('SIGINT cancels later sequence and conditional commands', async () => {
  for (const operator of [';', '||', '&&']) {
    const s = shell();
    const result = s.run(`sleep 10 ${operator} echo unsafe > /tmp/after`);
    setTimeout(() => s.kernel.signal(s.sessionId, 'SIGINT'), 10);
    assert.equal(await result, 130);
    assert.equal(s.kernel.vfs.exists('/tmp/after'), false);
  }
});

test('exit ends a pipeline before another stage can mutate the filesystem', async () => {
  const s = shell();
  assert.equal(await s.run('exit | echo unsafe > /tmp/after'), 0);
  assert.equal(s.kernel.vfs.exists('/tmp/after'), false);
});

test('middle-stage redirection supplies empty input to its successor', async () => {
  const s = shell();
  assert.equal(await s.run('echo secret | echo redirected > /tmp/out | cat'), 0);
  assert.equal(s.kernel.vfs.readFile('/tmp/out'), 'redirected\n');
  assert.equal(s.output, '');
});

test('capture counts UTF-8 bytes and overflow never replaces a destination', async () => {
  const s = shell({ captureBytes: 7 });
  s.kernel.vfs.writeFile('/tmp/out', 'kept');
  assert.equal(await s.run('printf 😀😀 > /tmp/out'), 1);
  assert.equal(s.kernel.vfs.readFile('/tmp/out'), 'kept');
  assert.match(s.output, /7 bytes/);
});

test('stderr has the same bounded terminal budget as stdout', async () => {
  const s = shell({ captureBytes: 7 });
  s.kernel.registry.register({ name: 'flood', run(ctx) { ctx.stderr.write('😀😀'); return 0; } });
  assert.equal(await s.run('flood'), 1);
  assert.match(s.output, /capture limit/);
  assert.equal(s.output.includes('😀'), false);
});

test('management barrier delays mutations until the management commit completes', async () => {
  const s = shell();
  const resume = s.kernel.holdCommands();
  let completed = false;
  const result = s.run('echo later > /tmp/after').then(code => { completed = true; return code; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(s.kernel.vfs.exists('/tmp/after'), false);
  resume(); resume();
  assert.equal(await result, 0);
  assert.equal(s.kernel.vfs.readFile('/tmp/after'), 'later\n');
});

test('SIGINT cancels queued management-barrier work before it can mutate anything', async () => {
  for (const interrupt of ['signal', 'input']) {
    const s = shell(), resume = s.kernel.holdCommands();
    const result = s.run('echo unsafe > /tmp/after; echo unsafe > /tmp/later');
    assert.equal(s.kernel.status(s.sessionId).busy, true);
    if (interrupt === 'signal') s.kernel.signal(s.sessionId, 'SIGINT');
    else s.kernel.write(s.sessionId, '\x03');
    assert.equal(await result, 130); // Cancellation settles even while management still holds the barrier.
    resume(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.kernel.vfs.exists('/tmp/after'), false);
    assert.equal(s.kernel.vfs.exists('/tmp/later'), false);
    assert.equal(s.session.env.get('?'), '130');
    assert.equal(s.kernel.status(s.sessionId).busy, false);
  }
});

test('backup envelopes enforce their actual UTF-8 byte cap', () => {
  assert.doesNotThrow(() => assertBackupSize('x'.repeat(MAX_BACKUP_BYTES)));
  assert.throws(() => assertBackupSize('x'.repeat(MAX_BACKUP_BYTES + 1)), /32 MiB/);
  assert.throws(() => assertBackupSize('😀'.repeat(MAX_BACKUP_BYTES / 4 + 1)), /32 MiB/);
});

test('tab completion escapes shell syntax in virtual filenames', () => {
  const s = shell();
  const name = 'weird;$HOME "file"';
  s.kernel.vfs.writeFile(`/tmp/${name}`, 'kept');
  const completion = s.kernel._complete(s.session, 'cat /tmp/weird', 14);
  const plan = parse(completion.replace, s.session.env);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].pipeline[0].argv, ['cat', `/tmp/${name}`]);
  assert.equal(s.kernel._complete(s.session, 'cat /bad\\path', 13), null);
});

test('environment count, bytes and unset tombstones are bounded atomically', () => {
  const e = new Environment();
  e.set('A', 'x'.repeat(65535));
  assert.throws(() => e.set('A', 'x'.repeat(65536)), /quota/);
  assert.equal(e.get('A').length, 65535);
  e.set('?', '127');
  assert.equal(e.get('?'), '127');
  const names = new Environment();
  for (let i = 0; i < 256; i++) names.unset(`V${i}`);
  assert.throws(() => names.unset('extra'), /quota/);
  assert.equal(names.vars.size, 256);
});

test('shell status remains writable when export exhausts environment slots', async () => {
  const s = shell();
  for (let i = 0; i < 255; i++) s.session.env.set(`V${i}`, 'x');
  assert.equal(await s.run('export extra=value'), 1);
  assert.equal(s.session.env.get('?'), '1');
  assert.equal(await s.run('true'), 0);
});

test('word and command expansion reject amplification before command execution', async () => {
  const env = new Environment({ A: 'x'.repeat(4096) });
  assert.equal(expandWord(tokenize('$A')[0], env).length, 4096);
  assert.throws(() => expandWord(tokenize('$A'.repeat(5))[0], env), /expanded word/);
  const s = shell(); s.session.env.set('A', 'x'.repeat(4096));
  await assert.rejects(() => s.run('echo ' + Array(17).fill('$A').join(' ')), /command quota/);
  assert.equal(s.output, '');
  assert.throws(() => tokenize('|'.repeat(1025)), /too many tokens/);
});

test('snapshot paths must remain addressable and import failure preserves the tree', () => {
  const v = new VFS({ seed: false }); v.writeFile('/kept', 'kept');
  const directory = () => ({ k: 'd', m: 493, t: 1, ch: [] });
  const root = directory(); let node = root;
  for (let i = 0; i < 17; i++) { const child = directory(); node.ch.push(['x'.repeat(255), child]); node = child; }
  assert.throws(() => v.importSnapshot({ v: 1, root }), /path limit/);
  assert.equal(v.readFile('/kept'), 'kept');
  assert.throws(() => v.remove('/kept/child'), error => error.code === 'ENOTDIR');
  for (const limits of [{ maxBytes: -1 }, { maxBytes: 1.5 }, { maxNodes: 0 }, { maxNodes: Infinity }]) assert.throws(() => new VFS({ seed: false, ...limits }), /quota/);
});

test('moving into a deep directory never publishes an inaccessible combined path', () => {
  const v = new VFS({ seed: false });
  const destination = '/' + Array(16).fill('x'.repeat(255)).join('/');
  v.mkdir(destination, { recursive: true });
  v.writeFile('/source', 'kept');
  assert.throws(() => v.move('/source', destination), /path too long/);
  assert.equal(v.readFile('/source'), 'kept');
  assert.equal(v.readdir(destination).length, 0);
  assert.equal(resolvePath('/a/..', 'b'), '/b');
  assert.throws(() => resolvePath('relative', 'b'), /working directory/);
});

test('IndexedDB compare-and-swap rejects stale revisions without dropping previous data', async t => {
  const previous = globalThis.indexedDB;
  t.after(() => { globalThis.indexedDB = previous; });
  globalThis.indexedDB = fakeIndexedDB([], () => {});
  const first = { v: 2, revision: 1, marker: 'first' };
  await writeVolume(first, 0);
  await assert.rejects(() => writeVolume({ v: 2, revision: 1, marker: 'stale' }, 0), /concurrently/);
  assert.deepEqual(await readVolume(), first);
  await writeVolume({ v: 2, revision: 2, marker: 'next' }, 1);
  assert.deepEqual(await readVolume(true), first);
  assert.equal((await readVolume()).revision, 2);
  assert.throws(() => writeVolume({ v: 2, revision: Number.MAX_SAFE_INTEGER + 1 }, Number.MAX_SAFE_INTEGER), /revision/);
});

function forgedState(value) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const bytes = new Uint8Array(data.length + 12), header = new DataView(bytes.buffer);
  bytes.set([72, 80, 85, 50]); header.setUint32(4, data.length, true); header.setUint32(8, crc32(data), true); bytes.set(data, 12);
  return bytes;
}

test('checksummed hostile state containers fail their structural quotas', () => {
  assert.throws(() => decodeState(forgedState({ values: Array(25).fill(null) })), /list limit/);
  assert.throws(() => decodeState(forgedState(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`K${i}`, null])))), /key limit/);
  assert.throws(() => decodeState(forgedState({ bytes: { $type: 'Uint8Array', data: Buffer.alloc(4097).toString('base64') } })), /array limit/);
});

test('RamLink preserves RPC envelope, bounds pending requests and cleans clone failures', async t => {
  const link = new RamLink();
  const sent = [];
  link.worker = { postMessage(message) { sent.push(message); }, terminate() {} };
  t.after(() => link.destroy());
  const pending = link.rpc('commands', { type: 'wrong', id: 'wrong', op: 'wrong' });
  pending.catch(() => {});
  assert.deepEqual(sent[0], { type: 'rpc', id: 'r1', op: 'commands' });
  link.destroy(); await assert.rejects(pending, /stopped/);
  link.worker = { postMessage() { throw new Error('clone failed'); }, terminate() {} };
  await assert.rejects(() => link.rpc('commands'), /clone failed/);
  assert.equal(link.pending.size, 0);
  link.worker = { postMessage() {}, terminate() {} };
  const waits = Array.from({ length: 64 }, () => link.rpc('commands'));
  waits.forEach(p => p.catch(() => {}));
  await assert.rejects(() => link.rpc('commands'), /too many pending/);
  link.destroy(); await Promise.allSettled(waits);
});

test('RamLink rejects writes to closed terminals and isolates close callback errors', async t => {
  const previous = globalThis.MessageChannel; globalThis.MessageChannel = MessageChannel;
  t.after(() => { globalThis.MessageChannel = previous; });
  const link = new RamLink(); link.ready = Promise.resolve(); link.epoch = 'test';
  link.worker = { postMessage(message, ports) {
    const port = ports[0];
    port.on('message', m => { if (m.type === 'session.open') port.postMessage({ v: 3, epoch: 'test', sid: 's1', type: 'session.opened' }); });
    port.postMessage({ v: 3, epoch: 'test', sid: null, type: 'hello', payload: { protocol: PROTOCOL } });
    t.after(() => port.close());
  }, terminate() {} };
  let fault; link.addEventListener('fault', e => { fault = e.detail.message; });
  const terminal = await link.open({ onClose() { throw new Error('callback failed'); } });
  assert.doesNotThrow(() => terminal.close());
  assert.equal(fault, 'callback failed');
  assert.throws(() => terminal.write('x'), /closed/);
  assert.equal(link.sockets.size, 0);
  link.destroy();
});
