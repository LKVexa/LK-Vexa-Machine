import test from 'node:test';
import assert from 'node:assert/strict';
import { accessibility } from '../src/vendor/vt/accessibility.js';

function element() {
  let text = '', writes = 0;
  return { get textContent() { return text; }, set textContent(value) { text = value; writes++; }, get writes() { return writes; }, set innerHTML(_) { throw new Error('HTML is forbidden'); } };
}
const row = text => [...text].map(ch => ({ ch, hidden: false }));

test('HERMIT accessibility: supplementary Unicode, literal markup, and concealed text mirror safely', () => {
  const target = element(), a11y = accessibility({ screen: target });
  const cells = row('<img>😀 '); cells.push({ ch: 's', hidden: true }, { ch: 'e', hidden: true });
  a11y.mirror({ rows: 3, grid: [cells, row('  next  '), row('  ')] });
  assert.equal(target.textContent, '<img>😀\n  next');
  assert(!target.textContent.includes('se'));
  const writes = target.writes;
  a11y.mirror({ rows: 3, grid: [cells, row('  next  '), row('  ')] });
  assert.equal(target.writes, writes);
});

test('HERMIT accessibility: announcements are bounded plain text and repeated status can be reannounced', () => {
  const status = element(), a11y = accessibility({ status });
  a11y.announce('\x1b[31m<img onerror=alert(1)>' + 'x'.repeat(500));
  assert(status.textContent.length <= 300);
  assert(!/[\x00-\x1f\x7f-\x9f]/.test(status.textContent));
  assert(status.textContent.includes('<img onerror=alert(1)>'));
  const prior = status.textContent, writes = status.writes;
  a11y.announce(prior);
  assert.equal(status.textContent, prior);
  assert.equal(status.writes, writes + 2);
});

test('HERMIT accessibility: hostile model dimensions and overlong cells cannot grow an unbounded transcript', () => {
  const target = element(), a11y = accessibility({ screen: target });
  const grid = Array.from({ length: 220 }, () => Array.from({ length: 450 }, () => ({ ch: 'X'.repeat(1024) })));
  a11y.mirror({ rows: 999999, grid });
  const lines = target.textContent.split('\n');
  assert.equal(lines.length, 200);
  assert(lines.every(line => line.length === 800));
  assert(target.textContent.length <= 160200);
  a11y.mirror({ rows: Infinity, grid });
  assert.equal(target.textContent, '');
});

test('HERMIT accessibility: absent optional elements and damaged rows do not crash the terminal', () => {
  assert.doesNotThrow(() => { const a11y = accessibility(); a11y.announce('ready'); a11y.mirror(null); });
  const target = element(), a11y = accessibility({ screen: target });
  a11y.mirror({ rows: 3, grid: [null, [{ hidden: true, ch: 'secret' }, null], row('ok')] });
  assert.equal(target.textContent, '\n\nok');
});
