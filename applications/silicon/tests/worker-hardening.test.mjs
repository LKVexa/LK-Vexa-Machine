import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker, MessageChannel } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { encodeData, decodeData, KIND_INPUT } from '../src/vendor/vws/frame.js';
import { VFS } from '../src/vendor/spiral/vfs.js';
import { MAX_BACKUP_BYTES } from '../src/vendor/spiral/volume-format.js';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function wait(predicate) {
  const start = Date.now();
  while (Date.now() - start < 5000) { if (predicate()) return; await delay(5); }
  throw new Error('worker hardening test timed out');
}
async function client(t, records = []) {
  const worker = new Worker(new URL('./storage-race-adapter.mjs', import.meta.url), { workerData: { records } });
  const messages = [], commits = [];
  let paused = 0, sequence = 0;
  worker.on('message', message => {
    if (message.kind === 'lock') worker.postMessage({ kind: 'lock-result', id: message.id, result: true });
    else if (message.kind === 'app') messages.push(message.data);
    else if (message.kind === 'commit') commits.push(message.records);
    else if (message.kind === 'digest-paused') paused++;
  });
  t.after(() => worker.terminate());
  await wait(() => messages.some(m => m.type === 'ready' || m.type === 'error'));
  const ready = messages.find(m => m.type === 'ready' || m.type === 'error');
  assert.equal(ready.type, 'ready');
  return { worker, messages, commits, epoch: ready.epoch, get paused() { return paused; }, async rpc(op, options = {}) {
    const id = `test${++sequence}`;
    worker.postMessage({ kind: 'message', data: { type: 'rpc', id, op, ...options } });
    await wait(() => messages.some(m => m.type === 'rpc' && m.id === id));
    const response = messages.find(m => m.type === 'rpc' && m.id === id);
    if (response.error) throw new Error(response.error);
    return response.result;
  } };
}
async function terminal(t, client) {
  const { port1, port2 } = new MessageChannel(); let sid, sequence = 0, consumed = 0, text = '';
  const messages = [];
  const send = (type, payload = {}, rid) => port1.postMessage({ v: 3, epoch: client.epoch, sid: sid || null, type, payload, rid });
  port1.on('message', m => {
    if (m instanceof Uint8Array) { const frame = decodeData(m); text += new TextDecoder().decode(frame.payload); consumed += frame.payload.length; send('flow.ack', { consumedBytes: consumed }); }
    else { messages.push(m); if (m.type === 'hello') send('session.open', { cols: 80, rows: 24 }); else if (m.type === 'session.opened') { sid = m.sid; send('session.start'); } }
  });
  client.worker.postMessage({ kind: 'message', data: { type: 'attach' }, ports: [port2] }, [port2]);
  t.after(() => port1.close());
  await wait(() => sid !== undefined);
  let statusSequence = 0;
  return { get text() { return text; }, messages, send, write(line) { port1.postMessage(encodeData(KIND_INPUT, ++sequence, new TextEncoder().encode(line + '\r'))); }, async status() {
    const rid = `status${++statusSequence}`; send('session.status', {}, rid);
    await wait(() => messages.some(m => m.rid === rid)); return messages.find(m => m.rid === rid).payload;
  } };
}

test('shell poweroff cannot abort another session and lose its in-flight work', async t => {
  const c = await client(t), first = await terminal(t, c), second = await terminal(t, c);
  first.write('sleep 1');
  await delay(25);
  assert.equal((await first.status()).busy, true);
  second.write('poweroff');
  await wait(() => second.text.includes('wait for other running commands'));
  assert.equal(c.messages.some(m => m.type === 'halt'), false);
  assert((await c.rpc('commands')).length > 40);
  assert.equal((await first.status()).busy, true);
  first.send('terminal.signal', { signal: 'SIGINT' });
  await wait(() => first.text.includes('^C') || first.text.includes('\r\n'));
  for (let i = 0; i < 20 && (await first.status()).busy; i++) await delay(10);
  assert.equal((await first.status()).busy, false);
  await c.rpc('power');
  assert.equal(c.messages.some(m => m.type === 'halt'), true);
});

test('SIGINT during the shell power delay cancels the power operation', async t => {
  const c = await client(t), term = await terminal(t, c);
  term.write('poweroff');
  await wait(() => term.text.includes('cutting power'));
  term.send('terminal.signal', { signal: 'SIGINT' });
  await delay(80);
  assert.equal(c.messages.some(m => m.type === 'halt'), false);
  assert((await c.rpc('commands')).length > 40);
  assert.equal((await term.status()).busy, false);
});

test('TIFF management digest and commit exclude a command arriving during validation', async t => {
  const c = await client(t), term = await terminal(t, c);
  await term.status(); // Populate the read-only image digest before delaying subsequent digests.
  const absent = await c.rpc('russl', { action: 'info' });
  const start = c.commits.length;
  c.worker.postMessage({ kind: 'digest-delay', enabled: true });
  const captured = c.rpc('russl', { action: 'capture', args: { expected: absent.revision } });
  await wait(() => c.paused > 0);
  term.write('echo late > /tmp/race');
  await delay(30);
  c.worker.postMessage({ kind: 'digest-delay', enabled: false });
  assert.equal((await captured).sites, 16384);
  await wait(() => c.commits.length > start);
  const firstCommit = c.commits[start].find(([key]) => key === 'nvme0n1')[1];
  const committed = JSON.stringify(firstCommit.snap);
  assert.equal(committed.includes('"race"'), false);
  assert.equal(committed.includes('russl-field.tif'), true);
  for (let i = 0; i < 30; i++) { if (!(await term.status()).busy) break; await delay(10); }
  const file = await c.rpc('file', { path: '/tmp/race' });
  assert.equal(new TextDecoder().decode(file.bytes), 'late\n');
});

test('legal escaped-control content boots, exports and restores above the former 4 MiB cap', async t => {
  const vfs = new VFS(); vfs.writeFile('/tmp/control-text', '\x1b'.repeat(1024 * 1024));
  const snap = vfs.exportSnapshot();
  const record = { v: 2, revision: 1, snap, sha256: createHash('sha256').update(JSON.stringify(snap)).digest('hex') };
  assert(JSON.stringify(record).length > 4 * 1024 * 1024);
  const c = await client(t, [['nvme0n1', record]]);
  const backup = await c.rpc('backup');
  assert(Buffer.byteLength(backup) > 4 * 1024 * 1024);
  assert(Buffer.byteLength(backup) < MAX_BACKUP_BYTES);
  const before = (await c.rpc('file', { path: '/tmp/control-text' })).bytes;
  assert.equal(before.length, 1024 * 1024); assert(before.every(byte => byte === 27));
  await assert.rejects(() => c.rpc('restore', { text: '😀'.repeat(MAX_BACKUP_BYTES / 4 + 1) }), /32 MiB/);
  assert.equal((await c.rpc('file', { path: '/tmp/control-text' })).bytes.length, before.length);
  assert.equal((await c.rpc('restore', { text: backup })).restart, true);
  const recovered = await client(t, c.commits.at(-1));
  const after = (await recovered.rpc('file', { path: '/tmp/control-text' })).bytes;
  assert.deepEqual(after, before);
});
