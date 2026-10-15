// SPDX-License-Identifier: GPL-3.0-only
import { fail } from './util.js';
import { configuration } from '../../../lib/semisili-model.js';

const OPERATIONS = Object.freeze(['add', 'sub', 'mul', 'negate', 'complement']);
const PUBLIC_OPTIONS = Object.freeze(['prime', 'precision', 'operation', 'operand', 'steps', 'source', 'requireGpu']);
const USAGE = 'xpu info | run [add|sub|mul|negate|complement] [operand] [prime] [precision] [steps] [gpu|cpu] [field|bank] | save <preview-token> | help';
const HELP = [
  USAGE,
  'Run defaults: add 1 2 8 4 gpu field.',
  'The operand must be a decimal integer in 0..(prime^precision - 1).',
  'Prime must be prime; precision is 1..16 and prime^precision must be at most 65536.',
  'Neuron steps are 1..32. GPU mode requires hardware confirmation of finite ring arithmetic.',
  'CPU mode validates the numerical phase and neuron model without a hardware GPU confirmation.',
  'Run creates a detached preview and prints its receipt, coverage, token, and canApply status.',
  'Review the preview, then explicitly save its token. A failed or stale preview cannot be saved.',
  'Field samples the live field; bank continues a previously saved neuron bank.',
  'Examples: xpu run add 1 2 8 4 gpu field; xpu run mul 3 3 5 4 cpu field.',
].join('\n') + '\n';

function decimal(text, name) {
  if (typeof text !== 'string' || !/^\d{1,16}$/.test(text)) throw new Error(name + ' must be a decimal integer');
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new Error(name + ' must be a safe decimal integer');
  return value;
}
function runOptions(args) {
  if (args.length > 7) throw new Error('run accepts at most 7 positional arguments');
  const [operation = 'add', operand = '1', prime = '2', precision = '8', steps = '4', mode = 'gpu', source = 'field'] = args;
  if (!OPERATIONS.includes(operation)) throw new Error('unsupported operation; run xpu help');
  if (!['gpu', 'cpu'].includes(mode)) throw new Error('confirmation mode must be gpu or cpu');
  if (!['field', 'bank'].includes(source)) throw new Error('source must be field or bank');
  const checked = configuration({operation, operand: decimal(operand, 'operand'), prime: decimal(prime, 'prime'),
    precision: decimal(precision, 'precision'), steps: decimal(steps, 'steps'), requireGpu: mode === 'gpu', source});
  return Object.fromEntries(PUBLIC_OPTIONS.map(key => [key, checked[key]]));
}

export default [{
  name: 'xpu',
  summary: 'validate semi-sili phase arithmetic and explicitly save a reviewed neuron preview',
  usage: USAGE,
  async run(ctx) {
    try {
      if (Object.keys(ctx.flags ?? {}).length) throw new Error('unsupported flag; run xpu help');
      const [sub = 'info', ...args] = ctx.args;
      let action, options;
      if (sub === 'help') {
        if (args.length) throw new Error('help accepts no arguments');
        ctx.stdout.write(HELP); return 0;
      }
      if (sub === 'info') {
        if (args.length) throw new Error('info accepts no arguments');
        action = 'info'; options = {};
      } else if (sub === 'run') {
        action = 'run'; options = runOptions(args);
      } else if (sub === 'save') {
        if (args.length !== 1 || typeof args[0] !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args[0])) {
          throw new Error('save requires the UUID token printed by a new XPU preview');
        }
        action = 'apply'; options = {token: args[0]};
      } else throw new Error('unknown subcommand; run xpu help');
      if (typeof ctx.host?.xpuTerminal !== 'function') throw new Error('the XPU terminal bridge is unavailable on this host');
      if (ctx.signal?.aborted) throw new Error('interrupted before XPU operation');
      const result = await ctx.host.xpuTerminal(action, options, ctx.signal);
      // The host owns the save commit boundary. Do not report a committed save as cancelled.
      if (action !== 'apply' && ctx.signal?.aborted) throw new Error('interrupted before XPU preview publication');
      // Keep the save token visible without streaming thousands of preview pixels into the shell.
      const output=action==='run'?{receipt:result.receipt,canApply:result.canApply,token:result.token}:result;
      ctx.stdout.write(JSON.stringify(output, null, 2) + '\n');
      return action === 'run' && result?.canApply === false ? 1 : 0;
    } catch (error) { return fail(ctx, 'xpu', error?.message || String(error)); }
  },
}];
