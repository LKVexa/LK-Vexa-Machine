import concurrent.futures,hashlib,json,zipfile
from pathlib import Path
root=Path(__file__).resolve().parent
source=Path('D:/downloads/hermit-ramws_2.0.0-ramws.1(3).zip')
target=root/'source/hermit-ramws'
with zipfile.ZipFile(source) as z:
    entries={i.filename:z.read(i) for i in z.infolist() if not i.is_dir()}
    # The separate inspection script already validates archive names. Repeat containment before writes.
    for name in entries:
        resolved=(target/name).resolve()
        if not resolved.is_relative_to(target.resolve()):raise ValueError('archive path escape')
    folders=sorted({(target/n).parent for n in entries},key=lambda p:len(p.parts))
    for folder in folders:folder.mkdir(parents=True,exist_ok=True)
    def put(item):
        name,data=item;(target/name).write_bytes(data)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:list(pool.map(put,entries.items()))
    manifest={'source':str(source),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'files':[{'path':n,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in entries.items()],'archiveCrc':'PASS' if z.testzip() is None else 'FAIL'}
    for n,b in entries.items():assert (target/n).read_bytes()==b,n
    (root/'INPUT_ARCHIVE_CHECK_FAST.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'status':'PASS','files':len(entries),'bytes':sum(map(len,entries.values())),'sha256':manifest['sha256']}))
