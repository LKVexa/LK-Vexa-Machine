"""Offline Chromium UI verification. No network navigation or policy modifications.
The production worker link is replaced by an explicit in-memory fixture. This does
NOT test browser IndexedDB, Web Locks, production CSP, or real MessageChannels.
Requires Python playwright and an installed Chromium executable.
"""
import asyncio,json,re,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
 results=[];errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1440,'height':1024},accept_downloads=True)
  page.on('pageerror',lambda e:errors.append(str(e)))
  html=(ROOT/'web/index.html').read_text()
  html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S)
  html=re.sub(r'<link\b[^>]*>','',html)
  await page.set_content(html)
  await page.add_style_tag(content=(ROOT/'web/style.css').read_text())
  modules={f.relative_to(ROOT).as_posix():f.read_text() for f in (ROOT/'src').rglob('*.js')}
  modules['src/lib/ram-link.js']=(ROOT/'tests/offline-ui-link.js').read_text()
  await page.evaluate('''async modules => {
    const urls = new Map();
    function moduleURL(name) {
      if (urls.has(name)) return urls.get(name);
      if (!Object.hasOwn(modules,name)) throw new Error('missing fixture module '+name);
      const source = modules[name].replace(/from\\s+(['"])(\\.[^'"]+)\\1/g, (all,q,relative) => {
        const dep = new URL(relative, 'https://offline.invalid/'+name).pathname.slice(1);
        return 'from '+q+moduleURL(dep)+q;
      });
      const url = URL.createObjectURL(new Blob([source],{type:'text/javascript'})); urls.set(name,url); return url;
    }
    await import(moduleURL('src/app.js'));
  }''',modules)
  await page.wait_for_function("document.querySelector('#connection').textContent === 'Online'")
  results.append({'test':'offline app startup / canvas renderer','status':'PASS'})
  async def command(text,expected):
   await page.locator('#command').fill(text)
   await page.locator('#command-form button[type=submit]').click()
   await page.wait_for_function('(text)=>document.querySelector("#transcript").textContent.includes(text)',arg=expected)
  await command("export A=hello; echo '$A' \"$A\"",'$A hello')
  results.append({'test':'form -> shell -> ANSI parser -> screen','status':'PASS'})
  await page.locator('[data-command="hpu bytes"]').click()
  await page.wait_for_function("document.querySelector('#operation').textContent === 'byte chip'")
  results.append({'test':'XPU control updates actual software field','status':'PASS'})
  await page.locator('nav [data-view="commands"]').click()
  await page.locator('#search-commands').fill('xpuinfo')
  assert await page.locator('.command-entry').count()==1
  await page.locator('.command-entry button').click()
  assert await page.locator('#command').input_value()=='xpuinfo'
  results.append({'test':'command library search and nonexecuting insertion','status':'PASS'})
  await page.locator('#add-tab').click()
  await page.wait_for_function("document.querySelectorAll('#tabs .close-tab').length===2")
  await command('echo second-terminal-ok','second-terminal-ok')
  results.append({'test':'independent terminal creation and selection','status':'PASS'})
  await page.locator('nav [data-view="storage"]').click()
  await page.wait_for_selector('.file-row')
  assert await page.locator('.file-row').count()>=7
  async with page.expect_download() as event:
   await page.locator('.file-row').filter(has_text='processor-1.tif').get_by_role('button').click()
  download=await event.value
  await download.save_as(ROOT/'audit'/'offline-ui-export.tif')
  results.append({'test':'virtual file list and explicit TIFF download','status':'PASS'})
  await page.locator('nav [data-view="russl"]').click()
  await page.wait_for_function("document.querySelector('#russl-summary').textContent.includes('absent')")
  await page.locator('#russl-capture').click()
  await page.wait_for_function("document.querySelector('#russl-summary').textContent.includes('16384')")
  assert await page.locator('#operation').text_content()=='byte chip'
  results.append({'test':'pixel lab captures all 16,384 samples without applying to live field','status':'PASS'})
  await page.locator('#russl-site-form button[type=submit]').click()
  await page.wait_for_function("document.querySelector('#russl-site-output').textContent.includes('ordinal')")
  await page.locator('#russl-value').fill('0.5')
  await page.locator('#russl-edit').click()
  await page.wait_for_function("document.querySelector('#russl-site-output').textContent.includes('effective')")
  assert json.loads(await page.locator('#russl-site-output').text_content())['effective']==0.5
  assert await page.locator('#operation').text_content()=='byte chip'
  results.append({'test':'pixel lab reads and edits a staged component; live field unchanged','status':'PASS'})
  # Derived intensity is not directly editable. Failed writes preserve the stage.
  revision=json.loads(await page.locator('#russl-summary').text_content())['revision']
  await page.locator('#russl-c4').fill('2')
  await page.locator('#russl-edit').click()
  await page.wait_for_function("document.querySelector('#notice').textContent.includes('derived')")
  assert json.loads(await page.locator('#russl-summary').text_content())['revision']==revision
  await page.locator('#russl-c4').fill('0')
  results.append({'test':'UI surfaces prohibited derived-plane edit without changing staged revision','status':'PASS'})
  page.once('dialog',lambda dialog:dialog.dismiss())
  await page.locator('#russl-apply').click()
  assert await page.locator('#operation').text_content()=='byte chip'
  page.once('dialog',lambda dialog:dialog.accept())
  await page.locator('#russl-apply').click()
  await page.wait_for_function("document.querySelector('#operation').textContent==='RUSSL field apply'")
  results.append({'test':'apply confirmation can cancel; accepted apply updates the live XPU','status':'PASS'})
  async with page.expect_download() as event:
   await page.locator('#russl-export').click()
  await (await event.value).save_as(ROOT/'audit'/'RUSSL_UI_EXPORT.tif')
  results.append({'test':'pixel lab exports the actual edited TIFF bytes','status':'PASS'})
  page.once('dialog',lambda dialog:dialog.accept())
  await page.locator('#russl-file').set_input_files(ROOT/'examples/tiffs/russl-field-big-endian.tif')
  await page.wait_for_function("document.querySelector('#notice').textContent.includes('TIFF validated and staged')")
  assert await page.locator('#operation').text_content()=='RUSSL field apply'
  good_revision=json.loads(await page.locator('#russl-summary').text_content())['revision']
  page.once('dialog',lambda dialog:dialog.accept())
  await page.locator('#russl-file').set_input_files({'name':'truncated.tif','mimeType':'image/tiff','buffer':b'II*\x00\x08\x00'})
  await page.wait_for_function("document.querySelector('#notice').textContent.includes('TIFF') && !document.querySelector('#notice').textContent.includes('validated and staged')")
  await page.locator('#russl-refresh').click()
  assert json.loads(await page.locator('#russl-summary').text_content())['revision']==good_revision
  results.append({'test':'local endian variant import succeeds; truncated replacement preserves valid stage','status':'PASS'})
  # A page served over the normal trusted local origin supplies Web Crypto.
  # This about:blank fixture does not pretend to test that secure-context API.
  await page.evaluate("() => { document.querySelector('#notice').hidden=false; document.querySelector('#notice').textContent='OFFLINE QA FIXTURE — real TIFF/field code; in-memory storage adapter, not native browser durability.'; }")
  await page.screenshot(path=str(ROOT/'audit'/'RUSSL_UI_DESKTOP.png'),full_page=True)
  await page.set_viewport_size({'width':430,'height':1000})
  await page.wait_for_timeout(100)
  assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  await page.screenshot(path=str(ROOT/'audit'/'RUSSL_UI_MOBILE.png'),full_page=True)
  results.append({'test':'TIFF pixel lab at 430px has no horizontal page overflow','status':'PASS'})
  await page.set_viewport_size({'width':1440,'height':1024})
  await page.locator('nav [data-view="console"]').click()
  await page.locator('#tabs button').first.click()
  await page.evaluate("() => { document.querySelector('#notice').hidden=false; document.querySelector('#notice').textContent='OFFLINE QA FIXTURE — in-memory storage adapter. Not a live IndexedDB durability test.'; }")
  await page.screenshot(path=str(ROOT/'audit'/'OFFLINE_UI_DESKTOP.png'),full_page=True)
  await page.set_viewport_size({'width':430,'height':1000})
  await page.wait_for_timeout(100)
  assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  await page.screenshot(path=str(ROOT/'audit'/'OFFLINE_UI_MOBILE.png'),full_page=True)
  results.append({'test':'430px layout has no horizontal overflow','status':'PASS'})
  await page.locator('#power').click()
  await page.wait_for_function("document.querySelector('#connection').textContent==='Stopped'")
  await page.wait_for_timeout(200)
  assert await page.locator('#connection').text_content()=='Stopped'
  await page.locator('#power').click()
  await page.wait_for_function("document.querySelector('#connection').textContent==='Online'")
  results.append({'test':'offline power-off stays stopped, power-on works','status':'PASS'})
  await browser.close()
 assert not errors, errors
 report={'mode':'OFFLINE_UI_FIXTURE','limitations':['No HTTP navigation; managed policy blocked it.','In-memory link adapter; real browser IndexedDB/Web Locks/production CSP/transport NOT verified.'],'tests':results,'page_errors':errors}
 (ROOT/'audit'/'BROWSER_OFFLINE_RESULTS.json').write_text(json.dumps(report,indent=2))
 print(json.dumps(report,indent=2))
if __name__=='__main__':asyncio.run(main())
