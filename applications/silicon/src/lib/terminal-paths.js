// A pasted path is data until the operator submits the command form.
// Only the Windows pane can invoke a host executable; never forward XPU input.
const WINDOWS_START = /^(?:[a-z]:[\\/]|\\\\|\.\.?\\)/i;
const HOST_EXECUTABLE = /\.(?:exe|com|cmd|bat|ps1)$/i;

function hasExecutableArguments(value) {
  // Recognize the first command word solely to avoid rewriting an existing
  // PowerShell invocation. Quoted fragments may occur inside that word.
  let word = '', quoted = false, i = 0;
  for (; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'") {
      if (quoted && value[i + 1] === "'") { word += "'"; i++; }
      else quoted = !quoted;
    } else if (!quoted && /\s/.test(ch)) break;
    else word += ch;
  }
  return !quoted && i < value.length && value.slice(i).trim().length > 0 && HOST_EXECUTABLE.test(word);
}

function literalPath(command) {
  const value = command.trim();
  if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    const inner = value.slice(1, -1);
    // File Explorer's Copy as path quotes a whole path. Do not mistake a
    // command with several quoted arguments for that single literal path.
    if (value[0] === "'") {
      if (inner.replaceAll("''", '').includes("'")) return null;
      return inner.replaceAll("''", "'");
    }
    if (inner.includes('"')) return null;
    return inner;
  }
  // Preserve existing PowerShell command lines and arguments. Ambiguous names
  // containing shell operators can still be pasted using Copy as path quotes.
  if (/["|<>;&$`{}()]/.test(value) || hasExecutableArguments(value) || /\.(?:exe|com|cmd|bat|ps1)'?\s+\S/i.test(value)) return null;
  return value;
}

function pathError(message, code) {
  const error = new Error(message);
  error.name = 'TerminalPathError';
  error.code = code;
  return error;
}

export function prepareTerminalCommand(command, kind) {
  if (typeof command !== 'string' || command.length > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(command)) {
    throw new Error('Enter one command line, up to 4096 characters, without terminal control characters.');
  }
  if (kind !== 'xpu' && kind !== 'admin') throw new Error('Unknown terminal kind.');
  const candidate = literalPath(command);
  if (candidate && (WINDOWS_START.test(candidate) || kind === 'admin' && /^\.\.?\//.test(candidate))) {
    if (kind === 'xpu') {
      throw pathError('This is a Windows path. Paste it in Administrator PowerShell and press Run after connecting. XPU 1 and XPU 2 use virtual files and XPU commands; they cannot launch Windows programs.', 'WINDOWS_PATH_IN_XPU');
    }
    if (HOST_EXECUTABLE.test(candidate) && !/["<>|]/.test(candidate)) {
      // A quoted path alone is a PowerShell string, not an invocation. Use the
      // call operator and single-quote escaping so spaces, $, ; and & stay data.
      const prepared = "& '" + candidate.replaceAll("'", "''") + "'";
      if (prepared.length > 4096) throw new Error('The quoted program path exceeds the 4096-character command limit.');
      return prepared;
    }
  }
  if (kind === 'xpu' && /^(?:\/(?!\/)|\.\.?\/)/.test(candidate ?? '') && !/[\s|;&]/.test(candidate)) {
    throw pathError('This is a virtual file path. Use a command such as cat /path/to/file, or the matching XPU load/import command. A file path alone is not an executable XPU command.', 'VIRTUAL_PATH_WITHOUT_COMMAND');
  }
  return command;
}
