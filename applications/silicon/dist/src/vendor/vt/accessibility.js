/**
 * Adapted from HERMIT RAMWS 2.0.0-ramws.1 client/accessibility.js.
 * Copyright (c) 2026 David Paul Russell. See the retained HERMIT LICENSE.
 * The owner supplies the status and screen elements; terminal data is never HTML.
 */
const MAX_ROWS = 200, MAX_COLS = 400, MAX_STATUS = 300;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;

export function accessibility({ status = null, screen: screenElement = null } = {}) {
  let last = '';
  return {
    announce(text) {
      if (!status) return;
      const value = String(text).slice(0, MAX_STATUS).replace(CONTROLS, '');
      if (value === last) status.textContent = '';
      last = value;
      status.textContent = value;
    },
    mirror(screen) {
      if (!screenElement || !screen || !Array.isArray(screen.grid)) return;
      const count = Number.isInteger(screen.rows) ? Math.min(MAX_ROWS, Math.max(0, screen.rows)) : 0;
      const lines = [];
      for (let y = 0; y < count; y++) {
        const row = screen.grid[y];
        if (!Array.isArray(row)) { lines.push(''); continue; }
        let line = '';
        for (let x = 0; x < Math.min(MAX_COLS, row.length); x++) {
          const cell = row[x];
          // A Screen cell contains one Unicode code point, at most two UTF-16 units.
          const ch = cell?.hidden ? ' ' : String(cell?.ch ?? ' ').slice(0, 2).replace(CONTROLS, '');
          line += ch;
        }
        lines.push(line.replace(/\s+$/, ''));
      }
      while (lines.length && lines.at(-1) === '') lines.pop();
      const text = lines.join('\n');
      if (screenElement.textContent !== text) screenElement.textContent = text;
    }
  };
}
