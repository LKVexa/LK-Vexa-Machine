/** Bounded shell grammar. No eval, process execution, substitution or glob expansion. */
const OPS = ['&&', '||', '>>', ';', '|', '>', '<'];
const MAX_LINE = 4096;
export function tokenize(line) {
  if (typeof line !== 'string' || line.length > MAX_LINE || /[\0\r\n]/.test(line)) throw new SyntaxError('invalid or overlong command line');
  const tokens = []; let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i])) { i++; continue; }
    if (line[i] === '#') break;
    const op = OPS.find(o => line.startsWith(o, i));
    if (op) { tokens.push({type:'op', value:op}); if (tokens.length > 512) throw new SyntaxError('too many tokens'); i += op.length; continue; }
    const parts = []; let started = false;
    const add = (text, expand, quoted) => { parts.push({text, expand, quoted}); started = true; };
    while (i < line.length && !/\s/.test(line[i]) && !OPS.some(o => line.startsWith(o, i))) {
      const c = line[i++];
      if (c === '\\') {
        if (i === line.length) throw new SyntaxError('unfinished escape');
        add(line[i++], false, true);
      } else if (c === "'" || c === '"') {
        const q = c; let s = ''; let closed = false;
        while (i < line.length) {
          const ch = line[i++];
          if (ch === q) { closed = true; break; }
          if (q === '"' && ch === '\\' && '"\\$`'.includes(line[i] || '\0')) {
            if (s) add(s, true, true);
            s = ''; add(line[i++], false, true);
          } else s += ch;
        }
        if (!closed) throw new SyntaxError('unclosed quote');
        add(s, q === '"', true);
      } else add(c, true, false);
    }
    if (started) {
      // Merge adjacent fragments with identical quote/expansion semantics.
      const merged = [];
      for (const p of parts) {
        const last = merged[merged.length-1];
        if (last && last.expand === p.expand && last.quoted === p.quoted) last.text += p.text;
        else merged.push({...p});
      }
      tokens.push({type:'word', value:parts.map(p=>p.text).join(''), quoted:parts.some(p=>p.quoted), parts:merged});
    }
    if (tokens.length > 512) throw new SyntaxError('too many tokens');
  }
  return tokens;
}
export function expandWord(token, env) {
  const parts = token.parts || [{text:token.value, expand:!token.quoted, quoted:!!token.quoted}];
  const encoder = new TextEncoder(); let result = '', size = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]; let s = p.text;
    if (i === 0 && !p.quoted && (s === '~' || s.startsWith('~/'))) s = (env.get('HOME') || '/home/operator') + s.slice(1);
    if (p.expand) {
      // Expand incrementally: a repeated variable must not allocate an unbounded intermediate string.
      let expanded = '', cursor = 0, expandedBytes = 0;
      const append = text => { expandedBytes += encoder.encode(text).length; if (size + expandedBytes > 16384) throw new Error('expanded word exceeds 16384 bytes'); expanded += text; };
      for (const match of s.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*|\?)\}|\$([A-Za-z_][A-Za-z0-9_]*|\?)/g)) {
        append(s.slice(cursor, match.index)); append(String(env.get(match[1] || match[2]) ?? '')); cursor = match.index + match[0].length;
      }
      append(s.slice(cursor)); s = expanded;
    }
    size += encoder.encode(s).length;
    if (size > 16384) throw new Error('expanded word exceeds 16384 bytes');
    result += s;
  }
  return result;
}
export function parse(line, env, {deferExpansion = false} = {}) {
  const tokens = tokenize(line); const segments = [];
  let seg = {op:null, pipeline:[]}; let cmd = {argv:[], redirects:[]};
  const word = t => deferExpansion ? t : expandWord(t, env);
  const command = () => {
    if (!cmd.argv.length) throw new SyntaxError('missing command');
    seg.pipeline.push(cmd); cmd = {argv:[], redirects:[]};
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'word') { cmd.argv.push(word(t)); continue; }
    if (['>', '>>', '<'].includes(t.value)) {
      const target = tokens[++i];
      if (!target || target.type !== 'word') throw new SyntaxError('missing redirect target');
      const type = t.value === '<' ? 'in' : t.value === '>>' ? 'append' : 'out';
      if (cmd.redirects.some(r => (r.type === 'in') === (type === 'in'))) throw new SyntaxError('duplicate redirection');
      cmd.redirects.push({type, target:word(target)}); continue;
    }
    command();
    if (t.value !== '|') { segments.push(seg); seg = {op:t.value === ';' ? null : t.value, pipeline:[]}; }
    if (i === tokens.length-1 && t.value !== ';') throw new SyntaxError('trailing operator');
  }
  if (cmd.argv.length || cmd.redirects.length) command();
  if (seg.pipeline.length) segments.push(seg);
  return segments;
}
