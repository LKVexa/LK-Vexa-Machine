/** Arbitrary JS regexes execute only in a disposable worker, never on the shell thread. */
export async function isolatedGrep(options, signal) {
  if (typeof options.pattern !== 'string' || options.pattern.length > 256 || typeof options.text !== 'string' || options.text.length > 524288) throw new Error('grep input limit');
  if (signal?.aborted) throw new Error('interrupted');
  if (typeof Worker === 'undefined') {
    // Node verification uses an equally killable worker_threads instance.
    const { Worker: NodeWorker } = await import('node:worker_threads');
    return runWorker(new NodeWorker(new URL('./regex-worker-node.js', import.meta.url)), options, signal, true);
  }
  return runWorker(new Worker(new URL('./regex-worker.js', import.meta.url), { type: 'module' }), options, signal, false);
}
function runWorker(worker, options, signal, node) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(result); };
    const abort = () => finish(new Error('interrupted'));
    const timer = setTimeout(() => finish(new Error('regular expression timed out (750 ms)')), 750);
    const receive = (data) => {
      if (data?.error) finish(new Error(String(data.error).slice(0,512)));
      else if (!data || typeof data.output !== 'string' || data.output.length > 524288 || !Number.isSafeInteger(data.matched) || data.matched < 0) finish(new Error('invalid regex worker result'));
      else finish(null, data);
    };
    if (node) { worker.on('message', receive); worker.on('error', e => finish(e)); worker.on('exit', () => { if (!settled) finish(new Error('regex worker exited before replying')); }); }
    else { worker.onmessage = e => receive(e.data); worker.onerror = () => finish(new Error('regex worker failed')); worker.onmessageerror = () => finish(new Error('regex worker message decode failure')); }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage(options); } catch(error) { finish(error); }
  });
}
