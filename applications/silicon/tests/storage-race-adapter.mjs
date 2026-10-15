/** Test-only deterministic scheduling around Web Crypto; storage still uses the explicit IDB double. */
import { parentPort } from 'node:worker_threads';
let delay = false;
const waiting = new Set();
const digest = crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest = async (...args) => {
  if (delay) {
    parentPort.postMessage({ kind: 'digest-paused' });
    await new Promise(resolve => waiting.add(resolve));
  }
  return digest(...args);
};
parentPort.on('message', message => {
  if (message.kind === 'digest-delay') {
    delay = message.enabled;
    if (!delay) { for (const resolve of waiting) resolve(); waiting.clear(); }
  }
});
await import('./worker-adapter.mjs');
