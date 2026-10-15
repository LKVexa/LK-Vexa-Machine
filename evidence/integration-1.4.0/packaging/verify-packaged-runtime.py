"""Extract and hash-check the exact final native runtime before startup preflight.

The already verified archive is immutable. --sha256 binds the archive to the packager output. Every extracted native runtime byte
is rechecked before preflight. No browser UI or protection settings are used.
"""
import argparse, concurrent.futures, hashlib, json, os, subprocess, zipfile
from datetime import datetime, timezone
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=ROOT/'outputs'
ARCHIVE=OUT/'JA21_Semi_Sili_XPU_Console_1.4.0.zip'
parser=argparse.ArgumentParser();parser.add_argument('--sha256',required=True);arguments=parser.parse_args()
EXPECTED=arguments.sha256
assert len(EXPECTED)==64 and all(c in '0123456789abcdef' for c in EXPECTED), 'Expected SHA-256 is required'
PREFIX='JA21-Semi-Sili-XPU-Console-1.4.0/'
VALIDATION_ROOT=Path(r'D:\Codex\hermit-native-validation')
assert VALIDATION_ROOT.is_dir(),'Prepare the owned short validation root before running native preflight'
TARGET=VALIDATION_ROOT/('preflight-1.4.0-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S'))
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(ARCHIVE.read_bytes())==EXPECTED
assert not TARGET.exists(),'Preserve previous attempts'
TARGET.mkdir()
with zipfile.ZipFile(ARCHIVE) as z:
    manifest=json.loads(z.read(PREFIX+'engine/ja21/runtime.integrity.json'))
    contents={e['path']:z.read(PREFIX+e['path']) for e in manifest['files']}
    contents['engine/ja21/runtime.integrity.json']=z.read(PREFIX+'engine/ja21/runtime.integrity.json')
for e in manifest['files']:
    assert len(contents[e['path']])==e['bytes'] and sha(contents[e['path']])==e['sha256'],e['path']
directories=set()
for relative in contents:
    assert '..' not in relative.split('/') and not relative.startswith(('/','\\'))
    folder=(TARGET/relative).parent
    while folder!=TARGET:
        directories.add(folder);folder=folder.parent
for folder in sorted(directories,key=lambda f:(len(f.parts),str(f))):folder.mkdir(exist_ok=True)
print('Runtime closure directories prepared sequentially.',flush=True)
def put(item):
    relative,data=item;file=TARGET/relative
    file.write_bytes(data);assert sha(file.read_bytes())==sha(data),relative
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:list(pool.map(put,contents.items()))
print('All '+str(len(manifest['files']))+' extracted runtime hashes passed.',flush=True)
environment=os.environ.copy();environment['JA21_NO_PAUSE']='1'
temp=HERE/'preflight-temp-retry';temp.mkdir(exist_ok=True)
environment['TEMP']=str(temp);environment['TMP']=str(temp)
logs=[];modes={}
for mode in ['default','blank']:
    command=[str(TARGET/'JA21-Silicon-Console.exe'),'--root',str(TARGET),'--preflight']
    if mode=='blank':command.append('--blank')
    try:
        run=subprocess.run(command,cwd=TARGET,env=environment,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
        current=run.stdout.decode('utf-8',errors='replace')
        modes[mode]={'status':'PASS' if run.returncode==0 and 'preflight PASS' in current else 'FAIL','exitCode':run.returncode}
    except subprocess.TimeoutExpired as exc:
        current=(exc.stdout or b'').decode('utf-8',errors='replace')+'\nTIMEOUT after60seconds'
        modes[mode]={'status':'TIMEOUT','exitCode':None}
    logs.append(mode+'\n'+current);print(mode+': '+modes[mode]['status'],flush=True)
status='PASS' if all(e['status']=='PASS' for e in modes.values()) else 'FAIL'
record=dict(schema='JA21/PACKAGED_NATIVE_PREFLIGHT/1',status=status,archive=ARCHIVE.name,archiveSha256=EXPECTED,
  consoleVersion='1.4.0',engineVersion='2.4.0',testedUTC=datetime.now(timezone.utc).isoformat(),
  runtimeFilesChecked=len(manifest['files']),preflightModes=modes,
  extraction={'directory':str(TARGET),'directoryCreation':'sequential','fileWrites':'12 bounded parallel workers','helperSha256':sha(Path(__file__).read_bytes())},
  liveBrowserTested=False,browserPersistenceVerified=False,
  scope='Fresh exact native runtime closure extracted from final full ZIP. Native Main/preflight checks sealed files, configuration, mapping and pinned SDK. Does not initialize WebView2, request administrator elevation, launch the administrator console or test persistence. Not a full historical-tree extraction test.')
(OUT/'JA21_Semi_Sili_XPU_Console_1.4.0_NATIVE_PREFLIGHT.log').write_text('\n'.join(logs),encoding='utf-8')
(OUT/'JA21_Semi_Sili_XPU_Console_1.4.0_NATIVE_PREFLIGHT.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps(record,indent=2))
raise SystemExit(0 if status=='PASS' else 1)
