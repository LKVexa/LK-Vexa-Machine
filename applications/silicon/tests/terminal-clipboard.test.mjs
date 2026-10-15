import test from 'node:test';
import assert from 'node:assert/strict';
import { commandPaste, insertCommandPaste, shouldInterruptCopy, terminalOutput, copyPlainText } from '../src/lib/terminal-clipboard.js';

function input(value, start = value.length, end = start) {
  return { value, selectionStart: start, selectionEnd: end, disabled: false,
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
}
const row = text => [...text].map(ch => ({ ch, hidden: false }));

test('pasted Windows paths remain literal editable text; multiline/control input cannot submit', () => {
  const box = input('before AFTER', 7, 12);
  assert.equal(insertCommandPaste(box, '"C:\\Program Files\\tool.exe"\r\n--help\t\x1b\x00'), true);
  assert.equal(box.value, 'before "C:\\Program Files\\tool.exe" --help ');
  assert.equal(box.selectionStart, box.value.length);
  assert.equal(box.selectionEnd, box.value.length);
  assert(!/[\r\n\t\x00-\x1f]/.test(box.value));
  assert.equal(commandPaste('alpha\u2028beta\u2029gamma'), 'alpha beta gamma');
});

test('oversized or noneditable paste is rejected without changing a draft or selection', () => {
  const box = input('x'.repeat(4095), 3, 3), before = { ...box };
  assert.throws(() => insertCommandPaste(box, '12'), /exceed/);
  assert.equal(box.value, before.value); assert.equal(box.selectionStart, 3);
  assert.throws(() => commandPaste('x'.repeat(4097)), /4096/);
  box.disabled = true;
  assert.throws(() => insertCommandPaste(box, 'new'), /editable/);
  assert.equal(box.value, before.value);
  box.disabled = false; box.readOnly = true;
  assert.throws(() => insertCommandPaste(box, 'new'), /editable/);
});

test('Ctrl+C copies selected input or document text; unselected Ctrl+C remains an interrupt', () => {
  const e = { ctrlKey: true, key: 'c', target: input('selected', 0, 8) };
  const doc = { getSelection: () => ({ toString: () => '' }) };
  assert.equal(shouldInterruptCopy(e, doc), false);
  e.target = input('draft'); assert.equal(shouldInterruptCopy(e, doc), true);
  assert.equal(shouldInterruptCopy(e, { getSelection: () => ({ toString: () => 'terminal result' }) }), false);
  assert.equal(shouldInterruptCopy({ ...e, shiftKey: true }, doc), false);
  assert.equal(shouldInterruptCopy({ ...e, key: 'v' }, doc), false);
  assert.equal(shouldInterruptCopy({ ...e, altKey: true }, doc), false);
});

test('output snapshots include earlier returned lines, preserve literal Unicode, and conceal hidden cells', () => {
  const secret = row('secret').map(cell => ({ ...cell, hidden: true }));
  const snapshot = terminalOutput({ rows: 3, scrollback: [row('earlier result')], grid: [row('<tag>😀'), secret, row('')] });
  assert.equal(snapshot.text, 'earlier result\n<tag>😀');
  assert.equal(snapshot.truncated, false);
  assert(!snapshot.text.includes('secret'));
  const bounded = terminalOutput({ rows: 1, scrollback: [row('older')], grid: [row('newest')] }, 6);
  assert.equal(bounded.text, 'newest'); assert.equal(bounded.truncated, true);
});

test('output snapshot dimensions, individual cells, and total retained text are bounded', () => {
  const screen = { rows: 999999, scrollback: Array.from({ length: 5100 }, () => row('a'.repeat(500))),
    grid: [Array.from({ length: 999 }, () => ({ ch: 'x'.repeat(1000) }))] };
  const snapshot = terminalOutput(screen);
  assert(snapshot.text.length <= 262144); assert.equal(snapshot.truncated, true);
  assert.throws(() => terminalOutput(screen, Infinity), /limit/);
  assert.deepEqual(terminalOutput(null), { text: '', truncated: false });
});

function copyDocument(accepted) {
  const draft = input('unchanged draft', 0, 9); draft.focus = () => {}; draft.isConnected = true;
  let temporary = null, removed = false;
  const document = { activeElement: draft,
    body: { append(t) { temporary = t; } },
    createElement() { return { style: {}, setAttribute() {}, focus() {}, select() {}, remove() { removed = true; } }; },
    execCommand(command) { assert.equal(command, 'copy'); assert.equal(temporary.value, '<literal output>'); return accepted; } };
  return { document, draft, removed: () => removed };
}

test('trusted copy fallback preserves the draft and selection without requesting clipboard read', async () => {
  const state = copyDocument(true);
  const clipboard = { writeText() { throw new Error('should not run'); }, readText() { throw new Error('forbidden'); } };
  assert.equal(await copyPlainText('<literal output>', { document: state.document, clipboard }), true);
  assert(state.removed()); assert.equal(state.draft.value, 'unchanged draft');
  assert.equal(state.draft.selectionStart, 0); assert.equal(state.draft.selectionEnd, 9);
});

test('copy API denial reports failure for manual selectable output; modern write is an independent fallback', async () => {
  const state = copyDocument(false);
  assert.equal(await copyPlainText('<literal output>', { document: state.document, clipboard: { async writeText() { throw new Error('denied'); } } }), false);
  let written = null;
  assert.equal(await copyPlainText('<literal output>', { document: state.document, clipboard: { async writeText(text) { written = text; } } }), true);
  assert.equal(written, '<literal output>'); assert(state.removed());
});
