// @ts-nocheck
import { isolatedGrep } from '../safe-regex.js';
import { Buffer } from '../buffer.js';
import { gatherInput, toLines, fail } from './util.js';

/** SPIRAL built-ins — text & stream utilities (the coreutils family). */



export default [
  {
    name: 'echo',
    summary: 'write arguments to standard output',
    usage: 'echo [-n] [-e] [args...]',
    parse: {},
    async run(ctx) {
      const noNewline = ctx.flags.n === true;
      let text = ctx.args.join(' ');
      if (ctx.flags.e) {
        text = text
          .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r').replace(/\\e/g, '\x1b').replace(/\\\\/g, '\\');
      }
      ctx.stdout.write(text + (noNewline ? '' : '\n'));
      return 0;
    }
  },

  {
    name: 'printf',
    summary: 'format and print data',
    usage: 'printf FORMAT [args...]',
    async run(ctx) {
      if (!ctx.args.length) return fail(ctx, 'printf', 'usage: printf FORMAT [args...]');
      const fmt = ctx.args[0]
        .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\e/g, '\x1b').replace(/\\r/g, '\r');
      const rest = ctx.args.slice(1);
      let i = 0;
      const out = fmt.replace(/%[-0-9.]*[sdxfc%]/g, (spec) => {
        if (spec === '%%') return '%';
        const v = rest[i++];
        const conv = spec[spec.length - 1];
        if (conv === 'd') return String(parseInt(v, 10) || 0);
        if (conv === 'x') return (parseInt(v, 10) || 0).toString(16);
        if (conv === 'f') return String(Number(v) || 0);
        return v == null ? '' : String(v);
      });
      ctx.stdout.write(out);
      return 0;
    }
  },

  {
    name: 'cat',
    summary: 'concatenate files and print',
    usage: 'cat [-n] [file...]',
    parse: {},
    async run(ctx) {
      const text = await gatherInput(ctx);
      if (ctx.flags.n) {
        const lines = toLines(text);
        const w = String(lines.length).length;
        ctx.stdout.write(lines.map((l, i) =>
          `\x1b[2m${String(i + 1).padStart(w)}\x1b[0m  ${l}`).join('\n') + (lines.length ? '\n' : ''));
      } else {
        ctx.stdout.write(text);
      }
      return 0;
    }
  },

  {
    name: 'head',
    summary: 'output the first part of files',
    usage: 'head [-n count] [file...]',
    parse: { valued: ['n'] },
    async run(ctx) {
      const n = ctx.flags.n === undefined ? 10 : Number(ctx.flags.n);
      if (!Number.isSafeInteger(n) || n < 0 || n > 100000) return fail(ctx, 'count', 'count must be 0..100000');
      const lines = toLines(await gatherInput(ctx)).slice(0, n);
      ctx.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
      return 0;
    }
  },

  {
    name: 'tail',
    summary: 'output the last part of files',
    usage: 'tail [-n count] [file...]',
    parse: { valued: ['n'] },
    async run(ctx) {
      const n = ctx.flags.n === undefined ? 10 : Number(ctx.flags.n);
      if (!Number.isSafeInteger(n) || n < 0 || n > 100000) return fail(ctx, 'count', 'count must be 0..100000');
      const all = toLines(await gatherInput(ctx));
      const lines = all.slice(Math.max(0, all.length - n));
      ctx.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
      return 0;
    }
  },

  {
    name: 'wc',
    summary: 'count lines, words and bytes',
    usage: 'wc [-l] [-w] [-c] [file...]',
    async run(ctx) {
      const text = await gatherInput(ctx);
      const lines = (text.match(/\n/g) || []).length;
      const words = (text.match(/\S+/g) || []).length;
      const bytes = Buffer.byteLength(text);
      const only = ctx.flags.l || ctx.flags.w || ctx.flags.c;
      const parts = [];
      if (!only || ctx.flags.l) parts.push(String(lines).padStart(6));
      if (!only || ctx.flags.w) parts.push(String(words).padStart(6));
      if (!only || ctx.flags.c) parts.push(String(bytes).padStart(6));
      ctx.stdout.write(parts.join(' ').trim() + '\n');
      return 0;
    }
  },

  {
    name: 'grep',
    summary: 'search for a pattern',
    usage: 'grep [-i] [-v] [-n] [-c] PATTERN [file...]',
    parse: {},
    async run(ctx) {
      if (!ctx.args.length) return fail(ctx, 'grep', 'usage: grep PATTERN [file...]');
      const pattern = ctx.args[0];
      ctx.args = ctx.args.slice(1); // remaining are files
      const text = await gatherInput(ctx);
      try {
        const result = await isolatedGrep({ pattern, text, ignoreCase: !!ctx.flags.i, invert: !!ctx.flags.v, numbers: !!ctx.flags.n, count: !!ctx.flags.c }, ctx.signal);
        ctx.stdout.write(result.output); return result.matched ? 0 : 1;
      } catch (e) { return fail(ctx, 'grep', e.message, 2); }

    }
  },

  {
    name: 'sort',
    summary: 'sort lines of text',
    usage: 'sort [-r] [-n] [-u] [file...]',
    async run(ctx) {
      let lines = toLines(await gatherInput(ctx));
      lines.sort(ctx.flags.n
        ? (a, b) => parseFloat(a) - parseFloat(b)
        : (a, b) => a.localeCompare(b));
      if (ctx.flags.r) lines.reverse();
      if (ctx.flags.u) lines = [...new Set(lines)];
      ctx.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
      return 0;
    }
  },

  {
    name: 'uniq',
    summary: 'report or omit repeated adjacent lines',
    usage: 'uniq [-c] [file...]',
    async run(ctx) {
      const lines = toLines(await gatherInput(ctx));
      const out = [];
      let prev = null, count = 0;
      const flush = () => { if (prev !== null) out.push(ctx.flags.c ? `${String(count).padStart(4)} ${prev}` : prev); };
      for (const l of lines) {
        if (l === prev) count++;
        else { flush(); prev = l; count = 1; }
      }
      flush();
      ctx.stdout.write(out.join('\n') + (out.length ? '\n' : ''));
      return 0;
    }
  },

  {
    name: 'rev',
    summary: 'reverse characters of each line',
    usage: 'rev [file...]',
    async run(ctx) {
      const lines = toLines(await gatherInput(ctx)).map((l) => [...l].reverse().join(''));
      ctx.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
      return 0;
    }
  },

  {
    name: 'tr',
    summary: 'translate or delete characters',
    usage: 'tr [-d] SET1 [SET2]',
    async run(ctx) {
      if (ctx.args.length !== (ctx.flags.d ? 1 : 2)) return fail(ctx, 'tr', 'usage: tr [-d] SET1 [SET2]');
      const text = await gatherInput_stdinOnly(ctx);
      if (ctx.flags.d) {
        const set = new Set(ctx.args[0] || '');
        ctx.stdout.write([...text].filter((c) => !set.has(c)).join(''));
        return 0;
      }
      const from = [...ctx.args[0]], to = [...ctx.args[1]];
      if (!to.length) return fail(ctx, 'tr', 'SET2 must not be empty');
      const map = Object.create(null);
      for (let i = 0; i < from.length; i++) map[from[i]] = to[i] != null ? to[i] : to[to.length - 1] || '';
      ctx.stdout.write([...text].map((c) => (c in map ? map[c] : c)).join(''));
      return 0;
    }
  },

  {
    name: 'seq',
    summary: 'print a sequence of numbers',
    usage: 'seq [first [incr]] last',
    async run(ctx) {
      const nums = ctx.args.map(Number);
      let first = 1, incr = 1, last;
      if (nums.length === 1) [last] = nums;
      else if (nums.length === 2) [first, last] = nums;
      else if (nums.length === 3) [first, incr, last] = nums;
      else return fail(ctx, 'seq', 'usage: seq [first [incr]] last');
      if (![first, incr, last].every(Number.isFinite)) return fail(ctx, 'seq', 'arguments must be finite numbers');
      const max = (ctx.limits && ctx.limits.seqItems) || 1000000;
      if (incr === 0 || (first !== last && first + incr === first)) return fail(ctx, 'seq', 'increment is zero or not representable');
      const count = Math.max(0, Math.floor((last - first) / incr) + 1);
      if (count > max) return fail(ctx, 'seq', `sequence of ${count} items exceeds the limit of ${max}`);
      // Stream in bounded batches instead of building one string of the whole sequence (RAMWS kit R12/R15):
      // memory is O(batch), and a paused consumer pauses the producer between batches.
      let out = [];
      const flush = async () => { if (out.length) { ctx.stdout.write(out.join('\n') + '\n'); out = []; if (ctx.yield) await ctx.yield(); } if (ctx.signal && ctx.signal.aborted) throw new Error('interrupted'); };
      for (let i = 0; i < count; i++) { out.push(first + i * incr); if (out.length >= 1000) await flush(); }
      await flush();
      return 0;
    }
  },

  { name: 'true', summary: 'do nothing, successfully', usage: 'true', async run() { return 0; } },
  { name: 'false', summary: 'do nothing, unsuccessfully', usage: 'false', async run() { return 1; } },

  {
    name: 'sleep',
    summary: 'delay for a number of seconds',
    usage: 'sleep SECONDS',
    async run(ctx) {
      const secs = Number(ctx.args[0]);
      if (ctx.args.length !== 1 || !Number.isFinite(secs) || secs < 0 || secs > 3600) return fail(ctx, 'sleep', 'seconds must be 0..3600');
      await new Promise((res, rej) => {
        if (ctx.signal.aborted) { rej(new Error('interrupted')); return; }
        const finish = () => { ctx.signal.removeEventListener('abort', abort); res(); };
        const t = setTimeout(finish, secs * 1000);
        const abort = () => { clearTimeout(t); ctx.signal.removeEventListener('abort', abort); rej(new Error('interrupted')); };
        ctx.signal.addEventListener('abort', abort, { once: true });
      });
      return 0;
    }
  }
];

// tr should only read stdin (its args are the SETs, not files)
async function gatherInput_stdinOnly(ctx) { return gatherInput({ ...ctx, args: [] }); }
