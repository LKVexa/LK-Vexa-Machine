// SPDX-License-Identifier: GPL-3.0-only
/** Clipboard gestures stay in the page. Pasting never writes to a terminal socket. */
export const COMMAND_LIMIT = 4096;
export const OUTPUT_LIMIT = 262144;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;

export function commandPaste(text) {
  if (typeof text !== 'string') throw new TypeError('Clipboard text is unavailable.');
  if (text.length > COMMAND_LIMIT) throw new Error('Paste up to 4096 characters at a time.');
  return text.replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(CONTROLS, '');
}

export function insertCommandPaste(input, text) {
  if (!input || input.disabled || input.readOnly) throw new Error('The command box is not editable.');
  const line = commandPaste(text);
  if (!line) return false;
  const value = String(input.value ?? '');
  const start = Number.isInteger(input.selectionStart) ? Math.max(0, Math.min(value.length, input.selectionStart)) : value.length;
  const end = Number.isInteger(input.selectionEnd) ? Math.max(start, Math.min(value.length, input.selectionEnd)) : start;
  const next = value.slice(0, start) + line + value.slice(end);
  if (next.length > COMMAND_LIMIT) throw new Error('The command would exceed 4096 characters. Select text to replace or shorten it.');
  input.value = next;
  input.setSelectionRange?.(start + line.length, start + line.length);
  return true;
}

export function shouldInterruptCopy(event, document = globalThis.document) {
  if (!event?.ctrlKey || event.altKey || event.metaKey || event.shiftKey || String(event.key).toLowerCase() !== 'c') return false;
  const target = event.target ?? document?.activeElement;
  if (Number.isInteger(target?.selectionStart) && Number.isInteger(target?.selectionEnd) && target.selectionEnd > target.selectionStart) return false;
  try { if (document?.getSelection?.()?.toString()) return false; } catch { }
  return true;
}

/** Plain, bounded, concealment-aware output snapshot, including retained scrollback. */
export function terminalOutput(screen, limit = OUTPUT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > OUTPUT_LIMIT) throw new RangeError('Invalid output snapshot limit.');
  if (!screen || !Array.isArray(screen.grid)) return { text: '', truncated: false };
  const rows = Number.isInteger(screen.rows) ? Math.max(0, Math.min(200, screen.rows)) : 0;
  const history = Array.isArray(screen.scrollback) ? screen.scrollback : [];
  const all = history.slice(-5000).concat(screen.grid.slice(0, rows));
  const lines = []; let length = 0, truncated = history.length > 5000, trailing = true;
  for (let y = all.length - 1; y >= 0; y--) {
    const row = all[y]; let line = '';
    if (Array.isArray(row)) for (let x = 0; x < Math.min(400, row.length); x++) {
      const cell = row[x];
      line += cell?.hidden ? ' ' : String(cell?.ch ?? ' ').slice(0, 2).replace(CONTROLS, '');
    }
    line = line.replace(/\s+$/, '');
    if (trailing && !line) continue;
    trailing = false;
    const remaining = limit - length - (lines.length ? 1 : 0);
    if (remaining <= 0) { truncated = true; break; }
    if (line.length > remaining) {
      let tail = line.slice(-remaining);
      if (/^[\udc00-\udfff]/.test(tail)) tail = tail.slice(1);
      lines.push(tail); truncated = true; break;
    }
    lines.push(line); length += line.length + (lines.length > 1 ? 1 : 0);
  }
  return { text: lines.reverse().join('\n'), truncated };
}

/** Called only by an explicit Copy output gesture; denial leaves manual selection usable. */
export async function copyPlainText(text, { document = globalThis.document, clipboard = globalThis.navigator?.clipboard } = {}) {
  if (typeof text !== 'string' || text.length > OUTPUT_LIMIT) throw new RangeError('Output snapshot exceeds its copy limit.');
  let temporary = null, previous = null, start = null, end = null;
  try {
    previous = document?.activeElement;
    start = previous?.selectionStart; end = previous?.selectionEnd;
    if (document?.body && typeof document.execCommand === 'function') {
      temporary = document.createElement('textarea');
      temporary.value = text; temporary.readOnly = true; temporary.tabIndex = -1;
      temporary.setAttribute('aria-hidden', 'true');
      Object.assign(temporary.style, { position: 'fixed', left: '-10000px', top: '0', width: '1px', height: '1px' });
      document.body.append(temporary); temporary.focus({ preventScroll: true }); temporary.select();
      // Keep this synchronous within the trusted click, before an async permission request.
      if (document.execCommand('copy') === true) return true;
    }
  } catch { }
  finally {
    temporary?.remove();
    if (previous?.isConnected !== false) {
      previous?.focus?.({ preventScroll: true });
      if (Number.isInteger(start) && Number.isInteger(end)) previous?.setSelectionRange?.(start, end);
    }
  }
  try {
    if (typeof clipboard?.writeText === 'function') { await clipboard.writeText(text); return true; }
  } catch { }
  return false;
}
