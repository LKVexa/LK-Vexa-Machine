"""A path-length control: copy only already sealed draft bytes into a shorter owned root."""
import argparse,concurrent.futures,hashlib,json
from pathlib import Path,PurePosixPath
parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--target',required=True)
args=parser.parse_args();source=Path(args.source).resolve();target=Path(args.target).resolve()
assert source.is_absolute() and source.is_dir()
assert target.is_absolute() and Path(r'D:\Codex') in target.parents,'Target must stay in the explicitly owned D:\\Codex project scope'
assert target.parent.is_dir(),'Prepare the owned parent directory first'
assert not target.exists(),'Preserve earlier validation attempts'
manifest=json.loads((source/'engine/ja21/runtime.integrity.json').read_text())
contents={}
sha=lambda b:hashlib.sha256(b).hexdigest()
assert len(manifest['files'])==len({entry['path'].casefold() for entry in manifest['files']}),'Runtime path collision'
for entry in manifest['files']:
    relative=entry['path'];parts=relative.split('/')
    assert isinstance(relative,str) and relative and '\\' not in relative and ':' not in relative and not PurePosixPath(relative).is_absolute() and all(part not in {'','.','..'} for part in parts),relative
    assert isinstance(entry['bytes'],int) and not isinstance(entry['bytes'],bool) and entry['bytes']>=0
    assert len(entry['sha256'])==64 and all(char in '0123456789abcdef' for char in entry['sha256'])
    content=(source/entry['path']).read_bytes();assert len(content)==entry['bytes'] and sha(content)==entry['sha256'],entry['path'];contents[entry['path']]=content
contents['engine/ja21/runtime.integrity.json']=(source/'engine/ja21/runtime.integrity.json').read_bytes()
target.mkdir(parents=True)
folders=set()
for relative in contents:
    folder=(target/relative).parent
    while folder!=target:folders.add(folder);folder=folder.parent
for folder in sorted(folders,key=lambda p:(len(p.parts),str(p))):folder.mkdir(exist_ok=True)
def put(pair):
    relative,content=pair;file=target/relative;file.write_bytes(content);assert sha(file.read_bytes())==sha(content),relative
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:list(pool.map(put,contents.items()))
record={'status':'EXACT_SEALED_COPY_PASS','source':str(source),'target':str(target),'files':len(manifest['files']),'runtimeManifestSha256':sha(contents['engine/ja21/runtime.integrity.json']),'purpose':'Compare native IndexedDB startup at a shorter isolated root; no user profile or volume reused'}
evidence=Path(__file__).resolve().parent
(evidence/('SHORT_NATIVE_CLOSURE-'+target.name+'.json')).write_text(json.dumps(record,indent=2)+'\n')
(evidence/'SHORT_NATIVE_CLOSURE.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
