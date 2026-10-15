export function evaluateGrep(o) {
  if (!o || typeof o.pattern !== 'string' || o.pattern.length > 256 || typeof o.text !== 'string' || o.text.length > 524288) throw new Error('grep input limit');
  const re = new RegExp(o.pattern, o.ignoreCase ? 'i' : '');
  const lines = o.text.split('\n'); if (lines.at(-1) === '') lines.pop();
  const out = []; let matched = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 16384) throw new Error('grep line exceeds 16384 characters');
    if (re.test(lines[i]) !== !!o.invert) { matched++; if (!o.count) out.push((o.numbers ? `${i + 1}:` : '') + lines[i]); }
  }
  const output = o.count ? `${matched}\n` : out.join('\n') + (out.length ? '\n' : '');
  if (output.length > 524288) throw new Error('grep output limit');
  return { output, matched };
}
