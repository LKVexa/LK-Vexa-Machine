import { evaluateGrep } from './regex-evaluator.js';
self.onmessage = e => { try { postMessage(evaluateGrep(e.data)); } catch (error) { postMessage({ error: error.message }); } };
