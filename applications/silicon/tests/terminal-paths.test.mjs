import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTerminalCommand } from '../src/lib/terminal-paths.js';

test('File Explorer Copy as path invokes a literal executable in PowerShell', () => {
  assert.equal(prepareTerminalCommand('"C:\\Program Files\\LK Vexa\\tool.exe"', 'admin'), "& 'C:\\Program Files\\LK Vexa\\tool.exe'");
  assert.equal(prepareTerminalCommand('C:\\Program Files\\LK Vexa\\tool.exe', 'admin'), "& 'C:\\Program Files\\LK Vexa\\tool.exe'");
  assert.equal(prepareTerminalCommand('"C:\\O\'Brien\\$cash; & data.exe"', 'admin'), "& 'C:\\O''Brien\\$cash; & data.exe'");
  assert.equal(prepareTerminalCommand('C:\\O\'Brien\\tool.exe', 'admin'), "& 'C:\\O''Brien\\tool.exe'");
  assert.equal(prepareTerminalCommand("'C:\\O''Brien\\tool.exe'", 'admin'), "& 'C:\\O''Brien\\tool.exe'");
  assert.equal(prepareTerminalCommand('"\\\\server\\share name\\tool.exe"', 'admin'), "& '\\\\server\\share name\\tool.exe'");
  assert.equal(prepareTerminalCommand('.\\tool.exe', 'admin'), "& '.\\tool.exe'");
  assert.equal(prepareTerminalCommand('./tool.exe', 'admin'), "& './tool.exe'");
  assert.throws(() => prepareTerminalCommand('./example.txt', 'xpu'), e => e.code === 'VIRTUAL_PATH_WITHOUT_COMMAND');
});

test('a complete command, arguments and PowerShell expressions retain their meaning', () => {
  for (const text of ["& 'C:\\Program Files\\tool.exe' --flag", 'C:\\tools\\tool.exe other.exe', "C:\\tools\\to'ol.exe' other.exe", 'C:\\a.exe; C:\\b.exe', 'C:\\a.exe & C:\\b.exe', 'Get-Item -LiteralPath "C:\\A B"', 'echo done; Get-Date', '"C:\\tool.exe" "argument"', '$env:TEMP', 'xpu info', 'cat /tmp/example.txt']) {
    assert.equal(prepareTerminalCommand(text, text.startsWith('xpu') || text.startsWith('cat') ? 'xpu' : 'admin'), text);
  }
});

test('neither XPU pane silently launches or forwards a Windows path', () => {
  for (const text of ['"C:\\Program Files\\tool.exe"', 'C:\\tools\\run.ps1', '\\\\server\\share\\tool.exe']) {
    assert.throws(() => prepareTerminalCommand(text, 'xpu'), e => e.code === 'WINDOWS_PATH_IN_XPU' && /Administrator PowerShell/.test(e.message));
  }
  assert.throws(() => prepareTerminalCommand('/tmp/demo.sh', 'xpu'), e => e.code === 'VIRTUAL_PATH_WITHOUT_COMMAND');
});

test('embedded PowerShell quote fragments do not turn a command with arguments into one path', () => {
  for (const text of ["C:\\tools\\tool.ex'e' argument.exe", "C:\\'Program Files'\\tool.exe other.exe", "C:\\tools\\to'ol.ex'e output.ps1"]) {
    assert.equal(prepareTerminalCommand(text, 'admin'), text);
  }
});

test('pasted control characters and oversized commands cannot be submitted', () => {
  for (const text of ['echo first\necho second', 'a\r', 'a\0', 'a\x1b', 'x'.repeat(4097)]) {
    assert.throws(() => prepareTerminalCommand(text, 'admin'), /one command line/);
  }
  assert.throws(() => prepareTerminalCommand('help', 'unknown'), /Unknown terminal/);
});
