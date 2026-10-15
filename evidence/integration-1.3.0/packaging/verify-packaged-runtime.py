"""Verify the exact sealed native startup closure extracted from final ZIP bytes.

This intentionally reports a narrow native preflight, not live WebView2 or a
full extraction of historical corpus trees. Neither baseline ZIP is changed.
"""
import concurrent.futures, hashlib, json, os, subprocess, zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=ROOT/'outputs'
ARCHIVE=OUT/'JA21_Semi_Sili_XPU_Console_1.3.0.zip'
PREFIX='JA21-Semi-Sili-XPU-Console-1.3.0/'
TARGET=HERE/'packaged-native-runtime-1.3.0'
assert not TARGET.exists(),'Use a fresh destination and preserve earlier runs'
TARGET.mkdir()
sha=lambda b:hashlib.sha256(b).hexdigest()
with zipfile.ZipFile(ARCHIVE) as z:
    manifest=json.loads(z.read(PREFIX+'engine/ja21/runtime.integrity.json'))
    contents={e['path']:z.read(PREFIX+e['path']) for e in manifest['files']}
    contents['engine/ja21/runtime.integrity.json']=z.read(PREFIX+'engine/ja21/runtime.integrity.json')
for e in manifest['files']:
    assert len(contents[e['path']])==e['bytes'] and sha(contents[e['path']])==e['sha256'],e['path']
def put(item):
    relative,data=item
    assert '..' not in relative.split('/') and not relative.startswith(('/','\\'))
    file=TARGET/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
    assert sha(file.read_bytes())==sha(data),relative
with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
    list(pool.map(put,contents.items()))
environment=os.environ.copy();environment['JA21_NO_PAUSE']='1'
temp=HERE/'preflight-temp';temp.mkdir(exist_ok=True)
environment['TEMP']=str(temp);environment['TMP']=str(temp)
logs=[];modes={}
for mode in ['default','blank']:
    command=[str(TARGET/'JA21-Silicon-Console.exe'),'--root',str(TARGET),'--preflight']
    if mode=='blank':command.append('--blank')
    try:
        run=subprocess.run(command,cwd=TARGET,env=environment,stdout=subprocess.PIPE,
          stderr=subprocess.STDOUT,timeout=60)
        current=run.stdout.decode('utf-8',errors='replace')
        ok=run.returncode==0 and 'preflight PASS' in current
        modes[mode]={'status':'PASS' if ok else 'FAIL','exitCode':run.returncode}
    except subprocess.TimeoutExpired as exc:
        current=(exc.stdout or b'').decode('utf-8',errors='replace')+'\nTIMEOUT after 60 seconds'
        modes[mode]={'status':'TIMEOUT','exitCode':None}
    logs.append(mode+'\n'+current)
    print(mode+': '+modes[mode]['status'],flush=True)
status='PASS' if all(e['status']=='PASS' for e in modes.values()) else 'FAIL'
record=dict(schema='JA21/PACKAGED_NATIVE_PREFLIGHT/1',status=status,archive=ARCHIVE.name,
  archiveSha256=sha(ARCHIVE.read_bytes()),consoleVersion='1.3.0',engineVersion='2.3.0',
  testedUTC=datetime.now(timezone.utc).isoformat(),runtimeFilesChecked=len(manifest['files']),
  preflightModes=modes,liveBrowserTested=False,browserPersistenceVerified=False,
  scope='Fresh exact native runtime closure extracted from final full ZIP. Native Main/preflight checks sealed files, configuration, mapping and pinned SDK. Does not initialize WebView2 or test persistence. Not a full historical-tree extraction test.')
(OUT/'JA21_Semi_Sili_XPU_Console_1.3.0_NATIVE_PREFLIGHT.log').write_text('\n'.join(logs),encoding='utf-8')
(OUT/'JA21_Semi_Sili_XPU_Console_1.3.0_NATIVE_PREFLIGHT.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps(record,indent=2))
raise SystemExit(0 if status=='PASS' else 1)
