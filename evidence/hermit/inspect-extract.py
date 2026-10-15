import hashlib,json,re,stat,zipfile
from pathlib import Path,PurePosixPath
root=Path(__file__).resolve().parent
source=Path('D:/downloads/hermit-ramws_2.0.0-ramws.1(3).zip')
target=root/'source/hermit-ramws'
data=source.read_bytes()
with zipfile.ZipFile(source) as z:
    infos=z.infolist();seen=set();total=0;files=[]
    for i in infos:
        name=i.filename.rstrip('/');p=PurePosixPath(name)
        if not name or p.is_absolute() or '..' in p.parts or '\\' in name or any(re.search(r'[<>:"|?*\x00-\x1f]|[. ]$',s) or re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)',s) for s in p.parts):raise ValueError('unsafe archive path '+i.filename)
        if name.casefold() in seen:raise ValueError('duplicate archive path '+name)
        seen.add(name.casefold())
        if stat.S_ISLNK(i.external_attr>>16) or i.flag_bits&1:raise ValueError('linked or encrypted archive member')
        total+=i.file_size
        if total>64*1024*1024 or i.file_size>16*1024*1024:raise ValueError('archive size exceeds audit bound')
        if not i.is_dir():files.append(i)
    for i in sorted(infos,key=lambda i:len(PurePosixPath(i.filename).parts)):
        p=target/i.filename
        if i.is_dir():p.mkdir(parents=True,exist_ok=True)
        else:p.parent.mkdir(parents=True,exist_ok=True)
    for i in files:(target/i.filename).write_bytes(z.read(i))
    manifest={'source':str(source),'sha256':hashlib.sha256(data).hexdigest(),'compressedBytes':len(data),'expandedBytes':total,'files':[{'path':i.filename,'bytes':i.file_size,'sha256':hashlib.sha256(z.read(i)).hexdigest()} for i in files],'archiveCrc':'PASS' if z.testzip() is None else 'FAIL'}
(root/'INPUT_ARCHIVE_CHECK.json').write_text(json.dumps(manifest,indent=2)+'\n')
for name in ['package.json','LICENSE','README.md','docs/RAMWS.md','docs/vws200/ARCHITECTURE.md']:
    print('\nFILE '+name+'\n'+(target/name).read_text(encoding='utf8')[:18000])
