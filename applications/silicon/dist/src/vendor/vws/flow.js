/** Cumulative, safe-integer byte acknowledgements; no signed-32-bit truncation. */
export const WINDOW = 262144, MAX_QUEUE = 1048576;
export class FlowWindow {
  constructor() { this.sent=0; this.consumed=0; }
  canSend(n) { return Number.isSafeInteger(n) && n > 0 && n <= WINDOW && this.sent+n <= this.consumed+WINDOW && Number.isSafeInteger(this.sent+n); }
  send(n) { if (!this.canSend(n)) throw new Error('output credit exhausted'); this.sent+=n; }
  acknowledge(n) { if (!Number.isSafeInteger(n) || n < this.consumed || n > this.sent) throw new Error('invalid cumulative byte acknowledgement'); this.consumed=n; }
}
