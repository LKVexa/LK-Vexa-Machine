/** Optional QA: real Chromium/Edge, served production CSP, workers, IndexedDB, Web Locks.
 * Uses a fresh temporary browser context; never opens the user's browser profile.
 * Requires separately supplied Playwright and a browser; neither is an app dependency.
 * PLAYWRIGHT_MODULE may point to playwright/index.mjs; CHROMIUM_PATH selects a browser.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../scripts/build.mjs';
import { createServer } from '../scripts/serve.mjs';
import { VERSION } from '../src/version.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = { version: VERSION, status: 'RUNNING', fixture: false, scope: 'Real browser production UI, module worker, MessageChannel, IndexedDB, Web Locks and served CSP', tests: [], errors: [], startedUtc: new Date().toISOString() };
const out = path.join(root, 'audit/BROWSER_PRODUCTION_RESULTS.json');
const save = () => fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
await fs.mkdir(path.dirname(out), { recursive: true });
await save();
let browser, context, server, profile;
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  await build();
  server = await createServer({ port: 0 });
  const url = `http://127.0.0.1:${server.address().port}/`;
  profile = await fs.mkdtemp(path.join(root, '..', 'browser-profile-'));
  context = await chromium.launchPersistentContext(profile, { headless: true, chromiumSandbox: true, timeout: 20000, viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  browser = context.browser();
  report.browser = browser.version(); report.platform = process.platform; report.node = process.version;
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(String(error)));
  const passed = name => { report.tests.push({ test: name, status: 'PASS' }); console.log('PASS:', name); };
  const waitText = async (id, text) => page.waitForFunction(([id, text]) => document.getElementById(id).textContent.includes(text), [id, text]);
  const online = () => page.waitForFunction(() => document.querySelector('#connection').textContent === 'Online' && document.querySelector('#transcript').textContent.includes('›'));
  let serial = 0;
  async function command(line, { capture = false } = {}) {
    const id = ++serial, marker = `qa_done_${id}`, begin = `qa_begin_${id}`;
    await page.locator('#command').fill(`${capture ? `echo ${begin}; ` : ''}${line}; printf '\\n'; echo ${marker}`);
    await page.locator('#command-form button[type=submit]').click();
    await page.waitForFunction(marker => {
      const lines = document.querySelector('#transcript').textContent.split('\n');
      const end = lines.findIndex(line => line.trim() === marker);
      return end >= 0 && lines.slice(end + 1).some(line => line.includes('›'));
    }, marker);
    if (!capture) return;
    const lines = (await page.locator('#transcript').textContent()).split('\n');
    const first = lines.findIndex(line => line.trim() === begin);
    const last = lines.findIndex(line => line.trim() === marker);
    assert(first >= 0 && last > first, `checkpoint ${id} output markers missing from current screen`);
    return lines.slice(first + 1, last).join('\n');
  }
  const fileContent = () => command('cat /tmp/persist.txt', { capture: true });
  const fieldPreview = () => page.evaluate(() => ['phase', 'intensity'].map(id =>
    [...document.getElementById(id).getContext('2d').getImageData(0, 0, 64, 64).data]));
  const readStagedSite = async (revision, value) => {
    await page.locator('[data-view=russl]').click();
    await page.waitForFunction(revision => {
      try { const info = JSON.parse(document.querySelector('#russl-summary').textContent); return info.present && info.revision === revision; }
      catch { return false; }
    }, revision);
    await page.locator('#russl-site-form button[type=submit]').click();
    await page.waitForFunction(value => {
      try { return JSON.parse(document.querySelector('#russl-site-output').textContent).value === value; }
      catch { return false; }
    }, value);
    assert.equal(JSON.parse(await page.locator('#russl-site-output').textContent()).value, value);
  };
  const response = await page.goto(url); await online();
  assert.equal(await page.locator('#version').textContent(), VERSION);
  assert(response.headers()['content-security-policy'].includes("connect-src 'none'"));
  passed('Production boot under served CSP with real module worker');
  const quotedOutput = await command("export A=hello; echo '$A' \"$A\"; printf '😀a😀' | tr '😀a' '🙂b'", { capture: true });
  assert(quotedOutput.includes('$A hello'));
  assert(quotedOutput.includes('🙂b🙂'));
  passed('Real MessageChannel terminal quoting and Unicode pipeline');
  await command('hpu bytes'); await waitText('operation', 'byte chip');
  const committedPreview = await fieldPreview();
  passed('Software byte lanes publish real worker field previews');
  await command('write /tmp/persist.txt production_saved');
  await page.locator('[data-view=storage]').click();
  await page.locator('#sync').click(); await waitText('notice', 'committed');
  const downloadEvent = page.waitForEvent('download'); await page.locator('#backup').click();
  const download = await downloadEvent;
  const backupPath = path.join(root, 'audit/production-backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  assert.equal(backup.v, 2); assert.equal(backup.version, VERSION);
  assert(backup.sha256 && backup.snap && backup.revision > 0);
  passed('Real IndexedDB transaction and validated full backup export');
  const second = await context.newPage();
  await second.goto(url);
  await second.waitForFunction(() => document.querySelector('#connection').textContent === 'Blocked');
  assert((await second.locator('#notice').textContent()).includes('writer'));
  await second.close();
  passed('Second browser window refused by the real single-writer Web Lock');
  await page.reload(); await online();
  assert.equal((await fileContent()).trim(), 'production_saved');
  await waitText('operation', 'byte chip');
  assert.deepEqual(await fieldPreview(), committedPreview);
  passed('Browser reload restores committed files and HPU state');
  const oldTab = await page.locator('#tabs .current').textContent();
  await page.locator('#reboot').click();
  await page.waitForFunction(old => {
    const current = document.querySelector('#tabs .current')?.textContent;
    return current && current !== old && !current.includes('closed') && document.querySelector('#connection').textContent === 'Online';
  }, oldTab);
  await online();
  assert.equal((await fileContent()).trim(), 'production_saved');
  await waitText('operation', 'byte chip');
  assert.deepEqual(await fieldPreview(), committedPreview);
  passed('Production reboot releases and reacquires the writer lock with data intact');
  await page.locator('[data-view=russl]').click(); await waitText('russl-summary', 'absent');
  await page.locator('#russl-capture').click(); await waitText('russl-summary', '16384');
  await page.locator('#russl-value').fill('0.5'); await page.locator('#russl-edit').click();
  await waitText('russl-site-output', 'effective');
  assert.equal(JSON.parse(await page.locator('#russl-site-output').textContent()).effective, 0.5);
  passed('Production TIFF capture and revision-checked staged pixel edit');
  const stagedRevision = JSON.parse(await page.locator('#russl-summary').textContent()).revision;
  await page.reload(); await online();
  await waitText('operation', 'byte chip');
  assert.deepEqual(await fieldPreview(), committedPreview);
  await readStagedSite(stagedRevision, 0.5);
  passed('Browser reload restores the exact staged TIFF revision and edited scalar');
  await page.locator('#power').click();
  await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Stopped');
  await page.locator('#power').click(); await online();
  await waitText('operation', 'byte chip');
  assert.deepEqual(await fieldPreview(), committedPreview);
  await readStagedSite(stagedRevision, 0.5);
  passed('Power off/on restores HPU previews and the exact staged TIFF revision and scalar');
  await page.locator('[data-view=console]').click();
  await command('russl set 0 0 0 0 0 0.75');
  await page.locator('[data-view=russl]').click();
  await page.waitForFunction(revision => {
    try { const info = JSON.parse(document.querySelector('#russl-summary').textContent); return info.present && info.revision !== revision; }
    catch { return false; }
  }, stagedRevision);
  const fieldDownload = page.waitForEvent('download'); await page.locator('#russl-export').click();
  await (await fieldDownload).saveAs(path.join(root, 'audit/PRODUCTION_FIELD.tif'));
  page.once('dialog', dialog => dialog.accept()); await page.locator('#russl-apply').click();
  await waitText('operation', 'RUSSL field apply');
  passed('Production field TIFF download and explicit apply to live XPU');
  await page.locator('[data-view=storage]').click();
  // Malformed import must leave the running volume intact.
  page.once('dialog', dialog => dialog.accept('RESTORE'));
  await page.locator('#restore-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"v":2,"snap":{}}') });
  await waitText('notice', 'checksum');
  await page.locator('[data-view=console]').click();
  assert.equal((await fileContent()).trim(), 'production_saved');
  passed('Malformed backup restore rejected without losing the active volume');
  await command('write /tmp/persist.txt changed_after_backup');
  await page.locator('[data-view=storage]').click();
  page.once('dialog', dialog => dialog.accept('RESTORE'));
  await page.locator('#restore-file').setInputFiles(backupPath);
  await waitText('notice', 'restored'); await online();
  await page.locator('[data-view=console]').click();
  assert.equal((await fileContent()).trim(), 'production_saved');
  passed('Validated backup restore restarts the real worker and restores exact file content');
  await page.locator('[data-view=storage]').click();
  const previousDownload = page.waitForEvent('download'); await page.locator('#previous-backup').click();
  const previous = await previousDownload; const previousPath = path.join(root, 'audit/production-previous-backup.json');
  await previous.saveAs(previousPath);
  const previousRecord = JSON.parse(await fs.readFile(previousPath, 'utf8'));
  assert.equal(previousRecord.v, 2); assert(JSON.stringify(previousRecord.snap).includes('changed_after_backup'));
  passed('Previous committed revision remains exportable after restore');
  await page.locator('[data-view=console]').click();
  await page.locator('#command').fill('echo \x1b[2J'); await page.locator('#command-form button[type=submit]').click();
  await waitText('notice', 'terminal control characters');
  passed('Command form rejects embedded terminal control bytes');
  await page.screenshot({ path: path.join(root, 'audit/PRODUCTION_UI_DESKTOP.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(root, 'audit/PRODUCTION_UI_MOBILE.png'), fullPage: true });
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  passed('Desktop/mobile layout renders without page exceptions');
  report.status = 'PASS';
} catch (error) {
  report.status = context ? 'FAIL' : 'BLOCKED_ENVIRONMENT'; report.error = error.stack || String(error); process.exitCode = 1;
  console.error(report.error);
} finally {
  await context?.close();
  await browser?.close();
  if (profile && path.dirname(profile) === path.dirname(root) && path.basename(profile).startsWith('browser-profile-')) await fs.rm(profile, { recursive: true, force: true });
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  report.finishedUtc = new Date().toISOString(); await save();
}
