import { parentPort } from 'node:worker_threads';
import { evaluateGrep } from './regex-evaluator.js';
parentPort.on('message', o => { try { parentPort.postMessage(evaluateGrep(o)); } catch (error) { parentPort.postMessage({ error: error.message }); } });
