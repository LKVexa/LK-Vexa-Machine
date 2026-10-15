"""Immutable, hash-pinned merge of the shared XPU / HERMIT RAMWS release.

--prepare snapshots the proposed overlay and references. --package requires a
fresh reviewed snapshot and RELEASE_READY.json. The baseline is never modified.
Every seal is rebuilt from the exact full merged byte map; a partial worktree
seal is never used as a package proof. Original references remain outside dist.
"""
import argparse, copy, hashlib, io, json, struct, sys, unicodedata, zipfile
from datetime import datetime, timezone
from difflib import unified_diff
from pathlib import Path, PurePosixPath

HERE=Path(__file__).resolve().parent
WORK=HERE.parent
ROOT=HERE.parents[2]
OUT=ROOT/'outputs'
PROJECT=ROOT/'work/blank-console-arm64/project/JA21-Silicon-Console'
BASE=OUT/'JA21_Semi_Sili_XPU_Console_1.3.0.zip'
BASE_SHA='d5b1561175609cd1b7adfae15bce384c1cb0887aa8b96d1295e79cbe09b1febc'
OLD_PREFIX='JA21-Semi-Sili-XPU-Console-1.3.0/'
PREFIX='JA21-Semi-Sili-XPU-Console-1.4.0/'
RELEASE=OUT/'JA21_Semi_Sili_XPU_Console_1.4.0.zip'
ENGINE='applications/silicon/'
HERMIT_NAME='hermit-ramws_2.0.0-ramws.1(3).zip'
HERMIT_SHA='4577a4c720fcd2769acf53ca462f3f9534144ca523e104a33b7e201720f90a6e'
sha=lambda b:hashlib.sha256(b).hexdigest()
encoded=lambda o:(json.dumps(o,indent=2,ensure_ascii=False)+'\n').encode('utf-8')
GENERATED={'FILES_MANIFEST.json','SHA256SUMS.txt','package.integrity.json','engine/ja21/runtime.integrity.json',
 ENGINE+'FILES_MANIFEST.json',ENGINE+'SHA256SUMS.txt',
 'evidence/integration-1.4.0/SOURCE_CHANGES.json','evidence/integration-1.4.0/SOURCE_PATCH.diff',
 'evidence/integration-1.4.0/RUNTIME_COMPARISON_TO_TESTED.json'}

def canonical(name):
    p=PurePosixPath(name)
    assert isinstance(name,str) and name and '\\' not in name
    assert not p.is_absolute() and all(x not in {'','.','..'} for x in name.split('/')),name
    return name

def package_path(name):
    parts=PurePosixPath(name).parts;leaf=parts[-1];lower=leaf.lower()
    return not (any(p in {'.git','.hg','.svn','__pycache__','.pytest_cache','logs'} for p in parts)
      or parts[0] in {'workspace','runtime','work'} or parts[:2]==('substrate','runtime')
      or name in {'package.integrity.json','console.json','FILES_MANIFEST.json','SHA256SUMS.txt'}
      or leaf.endswith(('.pyc','.tmp')) or leaf=='.vec1.lock'
      or lower.endswith(('.log','_log.json')) or '.log.' in lower)

def verify_manifest(data,name,anchor='',exact=None):
    manifest=json.loads(data[name]);entries=manifest['files']
    assert len(entries)==len({e['path'].casefold() for e in entries}),name
    if exact is not None:assert {e['path'] for e in entries}==exact,name
    for e in entries:
        canonical(e['path']);b=data[anchor+e['path']]
        assert isinstance(e['bytes'],int) and not isinstance(e['bytes'],bool)
        assert len(b)==e['bytes'] and sha(b)==e['sha256'],name+':'+e['path']
    return manifest

def load_base():
    raw=BASE.read_bytes();assert sha(raw)==BASE_SHA,'Baseline archive changed'
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names=z.namelist()
        assert len(names)==len({n.casefold() for n in names})
        assert all(n.startswith(OLD_PREFIX) and not n.endswith('/') for n in names)
        assert z.testzip() is None
        data={n[len(OLD_PREFIX):]:z.read(n) for n in names}
        info={i.filename[len(OLD_PREFIX):]:i for i in z.infolist()}
    verify_manifest(data,'FILES_MANIFEST.json',exact=set(data)-{'FILES_MANIFEST.json','SHA256SUMS.txt'})
    component={n[len(ENGINE):] for n in data if n.startswith(ENGINE)}
    verify_manifest(data,ENGINE+'FILES_MANIFEST.json',ENGINE,component-{'FILES_MANIFEST.json','SHA256SUMS.txt'})
    verify_manifest(data,'package.integrity.json',exact={n for n in data if package_path(n)})
    runtime=verify_manifest(data,'engine/ja21/runtime.integrity.json')
    assert {n for n in data if n.startswith(ENGINE+'dist/')}<= {e['path'] for e in runtime['files']}
    assert {'applications/silicon/VERSION','applications/silicon/package.json'}<={e['path'] for e in runtime['files']}
    return raw,data,info

def project_candidates():
    names=set()
    for d in ['src','web','dist','test','tests','scripts','docs']:
        p=PROJECT/ENGINE/d
        if p.exists():names.update(f.relative_to(PROJECT).as_posix() for f in p.rglob('*') if f.is_file())
    names.update(ENGINE+n for n in ['VERSION','package.json','package-lock.json','Start-Console.cmd',
      'CHANGELOG.md','COMMANDS.md','README.md','SECURITY.md','BROWSER_VALIDATION.md','SEMISILI_XPU.md'])
    names.update(['README.md','THIRD_PARTY_NOTICES.md','CONSOLE_VERSION','CONSOLE_BUILD.json','console.json','JA21-Silicon-Console.exe',
      'host/SiliconConsoleEntry.cs','host/Start-Console.ps1','tools/SiliconWebView2Acceptance.cs',
      'host/Build-SiliconConsole.cmd','host/JA21VirtualBrowser.cs','host/Vec1Substrate.cs','host/PortableDesktop.cs',
      'host/LiveWebContracts.cs','host/SiliconApp.cs','host/LiveWebBridge.cs',
      'tools/Build-Silicon-Acceptance.cmd','tools/SiliconPolicyAcceptance.cs',
      'tools/silicon_package.py','tools/Test-SoftwareConsoleLauncher.ps1','tools/Test-Silicon-WebView2.exe','tools/JA21-Admin-Terminal.exe'])
    names.update(f.relative_to(PROJECT).as_posix() for f in PROJECT.glob('*.cmd') if f.is_file())
    names.update(f.relative_to(PROJECT).as_posix() for f in (PROJECT/ENGINE).glob('*.cmd') if f.is_file())
    for folder in [PROJECT,PROJECT/ENGINE]:
        for pattern in ['LICENSE*','NOTICE*','THIRD_PARTY*']:
            names.update(f.relative_to(PROJECT).as_posix() for f in folder.glob(pattern) if f.is_file())
    for directory in ['docs','host']:
        folder=PROJECT/directory
        if folder.exists():
            names.update(f.relative_to(PROJECT).as_posix() for f in folder.rglob('*') if f.is_file() and f.suffix.lower() in {'.md','.cs','.cmd','.ps1','.exe','.dll'})
    return names

def inherited_references(data):
    manifest=json.loads(data[ENGINE+'references/semisili/REFERENCE_MANIFEST.json'])
    sources=manifest['sources']
    assert manifest['sourceFiles']==26 and manifest['pdfFiles']==25
    assert len(sources)==26
    for e in sources:
        name=canonical(e['target']);content=data[name]
        assert len(content)==e['bytes'] and sha(content)==e['sha256'],name
    return {'sourceFiles':26,'pdfFiles':25,'pdfPages':sum(e['pages'] or 0 for e in sources)}

def reference_sources():
    source=PROJECT/ENGINE/'references'/HERMIT_NAME
    content=source.read_bytes();assert sha(content)==HERMIT_SHA,'Attached HERMIT archive changed'
    return [{'source':str(source),'target':ENGINE+'references/'+HERMIT_NAME,
      'bytes':len(content),'sha256':HERMIT_SHA,'group':'hermit','documentInstructionsExecuted':False}]

def evidence_candidates():
    candidates=[]
    def add(file,target):
        assert file.is_file(),file
        candidates.append({'source':str(file),'target':canonical(target)})
    for name in ['package-hermit-release.py','verify-packaged-runtime.py','write-readiness.py','run-draft-check.py','make-short-native-closure.py','verify-final-archive.py']:
        add(HERE/name,'evidence/integration-1.4.0/packaging/'+name)
    allowed={'.md','.json','.tap','.txt','.log','.js','.cjs','.mjs','.py','.cs','.png','.tif','.tiff','.bin'}
    excluded={'__pycache__','tmp','node_modules','profile','user-data','User Data','runtime','.git'}
    for f in sorted(WORK.iterdir()):
        if f.is_file() and f.suffix.lower() in allowed:
            add(f,'evidence/hermit/'+f.name)
    for directory in ['implementation','native','native-security','engine-audit','browser','xpu-terminal-evidence']:
        folder=WORK/directory
        if not folder.exists():continue
        for f in sorted(folder.rglob('*')):
            if not f.is_file() or f.suffix.lower() not in allowed:continue
            relative=f.relative_to(folder)
            if any(part in excluded for part in relative.parts):continue
            add(f,'evidence/hermit/'+directory+'/'+relative.as_posix())
    # Native startup probes contain real browser profiles. Retain only intended evidence,
    # never browser profile/cache/SDK directories or compiled diagnostic executables.
    startup=WORK/'native-startup'
    if startup.exists():
        for f in sorted(startup.iterdir()):
            if f.is_file() and (f.suffix.lower() in {'.json','.md','.cs'} or (f.suffix.lower()=='.png' and f.name.startswith('NATIVE_DOCUMENT_'))):
                add(f,'evidence/hermit/native-startup/'+f.name)
        for f in sorted(startup.glob('*/RESULT.json')):
            add(f,'evidence/hermit/native-startup/'+f.relative_to(startup).as_posix())
    if (HERE/'EXTRA_FILES.json').exists():
        for e in json.loads((HERE/'EXTRA_FILES.json').read_text(encoding='utf-8-sig')):
            add(Path(e['source']),e['target'])
    targets=[e['target'].casefold() for e in candidates]
    assert len(targets)==len(set(targets)),'Evidence paths collide'
    for e in candidates:
        content=Path(e['source']).read_bytes();e.update(bytes=len(content),sha256=sha(content))
    return candidates

def prepare():
    _,base,_=load_base();files=[]
    for name in sorted(project_candidates()):
        f=PROJECT/name
        if not f.is_file():continue
        content=f.read_bytes()
        if content==base.get(name):continue
        files.append({'source':str(f),'target':name,'bytes':len(content),'sha256':sha(content),
          'beforeSha256':sha(base[name]) if name in base else None})
    inherited=inherited_references(base);refs=reference_sources();evidence=evidence_candidates()
    review={'schema':'JA21/SEMISILI_OVERLAY_REVIEW/1','consoleVersion':'1.4.0','siliconVersion':'2.4.0',
      'createdUTC':datetime.now(timezone.utc).isoformat(),'baselineSha256':BASE_SHA,'files':files,
      'references':refs,'inheritedReferences':inherited,'evidence':evidence,'removals':[],
      'policy':'Only these exact bytes may be merged; missing or changed files abort packaging.'}
    target=HERE/'OVERLAY_1.4.0.json';target.write_bytes(encoded(review))
    print(json.dumps({'status':'REVIEW_READY','snapshot':str(target),'snapshotSha256':sha(target.read_bytes()),
      'projectOverlayFiles':len(files),'referenceFiles':len(refs),'evidenceFiles':len(evidence),
      'projectOverlayPaths':[e['target'] for e in files]},indent=2))

def merge_review(base,review):
    assert review['baselineSha256']==BASE_SHA
    data=base.copy();seen=set()
    for group in ['files','references','evidence']:
        for e in review[group]:
            name=canonical(e['target']);assert name.casefold() not in seen,name;seen.add(name.casefold())
            assert name not in GENERATED,'Reviewed file cannot replace generated seal'
            content=Path(e['source']).read_bytes()
            assert len(content)==e['bytes'] and sha(content)==e['sha256'],'Input changed: '+name
            if group=='files':
                assert e['beforeSha256']==(sha(base[name]) if name in base else None),name
            data[name]=content
    for name in review.get('removals',[]):
        canonical(name);assert name.startswith(ENGINE+'dist/'),name
        assert name in data;del data[name]
    data['evidence/integration-1.4.0/REVIEWED_OVERLAY.json']=encoded(review)
    return data

def seal(data,base,review,ready):
    assert data['CONSOLE_VERSION'].decode().strip()=='1.4.0'
    assert data[ENGINE+'VERSION'].decode().strip()=='2.4.0'
    assert json.loads(data[ENGINE+'package.json'])['version']=='2.4.0'
    assert json.loads(data[ENGINE+'dist/release.json'])['version']=='2.4.0'
    native_record=json.loads(data['evidence/hermit/native/NATIVE_COMPILE_RESULTS.json'])
    assert native_record['status']=='PASS' and native_record['consoleVersion']=='1.4.0' and native_record['engineVersion']=='2.4.0'
    assert native_record['warningsAsErrors'] is True and native_record['target']=='x64'
    for e in native_record['files']:
        name=canonical(e['path']);assert len(data[name])==e['bytes'] and sha(data[name])==e['sha256'], 'Compiled native input changed: '+name
    for e in ready.get('validationEvidence',[]):
        name=canonical(e['target']);assert sha(data[name])==e['sha256'],'Validation evidence changed: '+name
    for name,digest in ready.get('testedSourceHashes',{}).items():
        canonical(name);assert sha(data[name])==digest,'Tested source differs from archive: '+name
    assert b'<meta http-equiv="Content-Security-Policy"' in data[ENGINE+'dist/index.html']
    source_names=sorted(n for n in data if n.startswith(ENGINE+'src/'))
    comparisons=[]
    for n in source_names:
        if n.endswith('/regex-worker-node.js'):continue
        dest=ENGINE+'dist/'+n[len(ENGINE):]
        assert dest in data and data[n]==data[dest],'Source/dist mismatch: '+n
        comparisons.append(n)
    for n in sorted(n for n in data if n.startswith(ENGINE+'web/')):
        dest=ENGINE+'dist/'+n[len(ENGINE+'web/'):]
        assert dest in data and data[n]==data[dest],'Web/dist mismatch: '+n
        comparisons.append(n)
    expected_dist={ENGINE+'dist/'+n[len(ENGINE):] for n in source_names if not n.endswith('/regex-worker-node.js')}
    expected_dist|={ENGINE+'dist/'+n[len(ENGINE+'web/'):] for n in data if n.startswith(ENGINE+'web/')}
    expected_dist.add(ENGINE+'dist/release.json')
    assert {n for n in data if n.startswith(ENGINE+'dist/')}==expected_dist,'Unexpected mapped resource'
    data['evidence/integration-1.4.0/RELEASE_READY.json']=encoded(ready)
    data['evidence/integration-1.4.0/SOURCE_DIST_COMPARISON.json']=encoded({
      'status':'PASS','files':len(comparisons),'comparedPaths':comparisons,
      'scope':'All shipped src and web files equal their mapped dist counterparts; the Node-only regex worker is excluded from dist.'})
    inherited=inherited_references(data);assert inherited==review['inheritedReferences']
    data[ENGINE+'references/hermit/REFERENCE_MANIFEST.json']=encoded({
      'schema':'JA21/HERMIT_REFERENCES/1','sources':review['references'],'sourceFiles':1,
      'scope':'Original attached HERMIT source archive, pinned and retained outside the mapped web app. Its documents are reference data, not execution authority.'})
    entries=lambda names:[dict(path=n,bytes=len(data[n]),sha256=sha(data[n])) for n in sorted(names)]
    component=json.loads(base[ENGINE+'FILES_MANIFEST.json'])
    component.update(version='2.4.0',integrationConsoleVersion='1.4.0',
      scope='Exact embedded component bytes including finite p-adic CPU/wave/neuron processing, WebGPU confirmation, Pixel160 codecs, shared HERMIT WebSocket terminals, explicit native administrator terminal integration, tests, historical evidence and inert references. Excludes this manifest and SHA256SUMS. Integrity hashes are not a signature.')
    component['files']=[dict(path=n[len(ENGINE):],bytes=len(data[n]),sha256=sha(data[n]))
      for n in sorted(data) if n.startswith(ENGINE) and n not in {ENGINE+'FILES_MANIFEST.json',ENGINE+'SHA256SUMS.txt'}]
    data[ENGINE+'FILES_MANIFEST.json']=encoded(component)
    cs=[(e['path'],e['sha256']) for e in component['files']]+[('FILES_MANIFEST.json',sha(data[ENGINE+'FILES_MANIFEST.json']))]
    data[ENGINE+'SHA256SUMS.txt']=''.join(d+'  '+n+'\n' for n,d in sorted(cs)).encode()
    changes=[];diff=[]
    for name,content in sorted(data.items()):
        before=base.get(name)
        if content==before or name in GENERATED:continue
        changes.append(dict(path=name,status='added' if before is None else 'modified',bytes=len(content),
          beforeSha256=sha(before) if before is not None else None,afterSha256=sha(content)))
        if before is not None and name.endswith(('.js','.mjs','.py','.ps1','.cmd','.cs','.css','.html','.md','.txt','.json')):
            try:
                diff.extend(unified_diff(before.decode('utf-8-sig').splitlines(True),content.decode('utf-8-sig').splitlines(True),
                  fromfile='1.3.0/'+name,tofile='1.4.0/'+name))
            except UnicodeDecodeError:pass
    source_changes=sum(base.get(n)!=data[n] for n in source_names)
    data['evidence/integration-1.4.0/SOURCE_CHANGES.json']=encoded({
      'consoleVersion':'1.4.0','engineVersion':'2.4.0','baselineSha256':BASE_SHA,
      'engineModulesChanged':source_changes,'scope':'Final merged bytes before generated integrity seals; all previous audit evidence preserved.',
      'changes':changes,'removals':review.get('removals',[])})
    data['evidence/integration-1.4.0/SOURCE_PATCH.diff']=''.join(diff).encode()
    runtime=json.loads(base['engine/ja21/runtime.integrity.json'])
    runtime_names={e['path'] for e in runtime['files'] if not e['path'].startswith(ENGINE+'dist/')}
    runtime_names|={n for n in data if n.startswith((ENGINE+'dist/',ENGINE+'src/',ENGINE+'scripts/'))}
    # Program.Run constructs DF_Small before creating the native window; seal its full inherited payload.
    runtime_names|={n for n in data if n.startswith('helper/DF_Small/')}
    assert {'helper/DF_Small/node/NODE_DESCRIPTOR.json','helper/DF_Small/node/PAYLOAD_DIGEST.json'}<=runtime_names
    runtime_names|={n for n in data if '/' not in n and n.lower().endswith('.cmd')}
    runtime_names|={n for n in data if n.startswith('host/') and PurePosixPath(n).suffix.lower() in {'.cs','.cmd','.ps1','.exe','.dll'}}
    runtime_names|={'tools/JA21-Admin-Terminal.exe','tools/Test-Silicon-WebView2.exe','tools/SiliconWebView2Acceptance.cs','tools/SiliconPolicyAcceptance.cs','tools/Build-Silicon-Acceptance.cmd'}
    assert all(n in data for n in runtime_names)
    runtime.update(consoleVersion='1.4.0',siliconVersion='2.4.0',files=entries(runtime_names))
    tested_path='evidence/hermit/native-startup/NATIVE_RUNTIME_MANIFEST_TESTED.json'
    if ready.get('status')=='READY_FOR_PACKAGING':assert tested_path in data,'Live-tested native runtime proof required for final packaging'
    if tested_path in data:
        tested=json.loads(data[tested_path]);before={e['path']:e for e in tested['files']};after={e['path']:e for e in runtime['files']}
        assert set(before)==set(after),'Final runtime closure differs from live-tested closure paths'
        differences=[{'path':name,'tested':before[name],'final':after[name]} for name in sorted(before) if before[name]!=after[name]]
        code_changes={e['path'] for e in differences}-{'CONSOLE_BUILD.json'}
        revalidating=ready.get('status')=='DRAFT_NATIVE_REVALIDATION_ONLY'
        assert not code_changes or revalidating,'Production runtime bytes changed after live native validation'
        data['evidence/integration-1.4.0/RUNTIME_COMPARISON_TO_TESTED.json']=encoded({
          'schema':'JA21/RUNTIME_LIVE_TEST_COMPARISON/1','status':'PENDING_NATIVE_REVALIDATION' if code_changes else 'PASS_METADATA_ONLY' if differences else 'PASS_EXACT',
          'testedManifestSha256':sha(data[tested_path]),'runtimeEntriesCompared':len(after),
          'allowedMetadataChanges':['CONSOLE_BUILD.json'],'differences':differences,
          'scope':'Every final production runtime entry matches the exact native live-tested closure except the explicitly listed final build/validation metadata. Native configuration/preflight and the final-archive process relaunch are separately verified.'})

    data['engine/ja21/runtime.integrity.json']=encoded(runtime)
    package=json.loads(base['package.integrity.json']);package['files']=entries(n for n in data if package_path(n))
    data['package.integrity.json']=encoded(package)
    outer=dict(schema='JA21/CONSOLE_DISTRIBUTION/1',consoleVersion='1.4.0',siliconVersion='2.4.0',
      scope='Exact full shipped bytes including preserved historical evidence and inert literature. Excludes this manifest and SHA256SUMS; mutable workspace omitted. Integrity hashes are not a signature.',
      files=entries(n for n in data if n not in {'FILES_MANIFEST.json','SHA256SUMS.txt'}))
    data['FILES_MANIFEST.json']=encoded(outer)
    sums=[(e['path'],e['sha256']) for e in outer['files']]+[('FILES_MANIFEST.json',sha(data['FILES_MANIFEST.json']))]
    data['SHA256SUMS.txt']=''.join(d+'  '+n+'\n' for n,d in sorted(sums)).encode()
    sys.path.insert(0,str(PROJECT/'tools'))
    from windows_archive_preflight import scan_relative_paths
    assert not scan_relative_paths(list(data))
    assert len(data)==len({n.casefold() for n in data})
    keys={unicodedata.normalize('NFC',n).casefold() for n in data}
    for n in data:
        parts=n.split('/')
        for i in range(1,len(parts)):
            assert unicodedata.normalize('NFC','/'.join(parts[:i])).casefold() not in keys,'File/directory collision: '+n
    assert all(n in data for n in base),'Baseline file removed without explicit preservation'
    historical=[n for n in base if n.startswith(('evidence/',ENGINE+'audit/',ENGINE+'references/'))]
    assert all(data[n]==base[n] for n in historical),'Historical audit or reference bytes changed'
    verify_manifest(data,'FILES_MANIFEST.json',exact=set(data)-{'FILES_MANIFEST.json','SHA256SUMS.txt'})
    verify_manifest(data,ENGINE+'FILES_MANIFEST.json',ENGINE,{n[len(ENGINE):] for n in data if n.startswith(ENGINE)}-{'FILES_MANIFEST.json','SHA256SUMS.txt'})
    verify_manifest(data,'package.integrity.json',exact={n for n in data if package_path(n)})
    verify_manifest(data,'engine/ja21/runtime.integrity.json',exact=runtime_names)
    return runtime,package,source_changes,len(comparisons),sums

def archive(data,base,raw,infos):
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for name,content in sorted(data.items()):
            if name not in base or content!=base[name]:
                z.writestr(PREFIX+name,content);continue
            info=copy.copy(infos[name]);assert not info.flag_bits & 9
            assert info.file_size<2**32 and info.compress_size<2**32
            local=info.header_offset;assert raw[local:local+4]==b'PK\x03\x04'
            nlen,xlen=struct.unpack_from('<HH',raw,local+26);start=local+30+nlen+xlen
            compressed=raw[start:start+info.compress_size];assert len(compressed)==info.compress_size
            info.filename=PREFIX+name;info.orig_filename=info.filename
            info.header_offset=z.fp.tell();info._end_offset=None
            z._writecheck(info);z._didModify=True;z.fp.write(info.FileHeader(zip64=False));z.fp.write(compressed)
            z.filelist.append(info);z.NameToInfo[info.filename]=info;z.start_dir=z.fp.tell()
    with zipfile.ZipFile(buffer) as z:
        assert z.testzip() is None
        assert set(z.namelist())=={PREFIX+n for n in data}
        for name,content in data.items():
            shipped=z.read(PREFIX+name);assert len(shipped)==len(content) and sha(shipped)==sha(content),name
    return buffer.getvalue()

def package():
    assert not RELEASE.exists(),'Existing release must be preserved'
    snapshot=HERE/'OVERLAY_1.4.0.json';review=json.loads(snapshot.read_text(encoding='utf-8-sig'))
    ready=json.loads((HERE/'RELEASE_READY.json').read_text(encoding='utf-8-sig'))
    assert ready['status']=='READY_FOR_PACKAGING'
    assert ready['reviewedOverlaySha256']==sha(snapshot.read_bytes()),'Overlay is not the reviewed freeze'
    assert ready['consoleVersion']=='1.4.0' and ready['engineVersion']=='2.4.0'
    assert ready['baselineSha256']==BASE_SHA
    assert ready.get('testedSourceHashes') and ready.get('validationEvidence'),'Fresh validation source bindings required'
    raw,base,info=load_base();data=merge_review(base,review)
    runtime,inner,changed,compared,sums=seal(data,base,review,ready)
    payload=archive(data,base,raw,info);digest=sha(payload)
    RELEASE.write_bytes(payload);assert sha(RELEASE.read_bytes())==digest
    result=dict(schema='JA21/SEMISILI_RELEASE_PACKAGE/1',status='PASS',file=RELEASE.name,bytes=len(payload),sha256=digest,
      baselineSha256=BASE_SHA,files=len(data),runtimeSealedFiles=len(runtime['files']),packageIntegrityFiles=len(inner['files']),
      originalReferences=26,originalPDFs=25,referencePDFPages=review['inheritedReferences']['pdfPages'],hermitSourceArchives=1,hermitArchiveSha256=HERMIT_SHA,sourceDistFilesCompared=compared,engineModulesChanged=changed,
      crc='PASS',allShippedHashes='PASS',innerManifestHashes='PASS',windowsPaths='PASS',
      baselinePathsPreserved=len(base),historicalAuditBytes='UNCHANGED',reviewedOverlaySha256=sha(snapshot.read_bytes()),
      validation=ready.get('validation',{}),
      scope='Full immutable release bytes verified. Runtime measurements and remaining live gates are stated separately in validation and release evidence.')
    (OUT/(RELEASE.name+'.sha256')).write_text(digest+'  '+RELEASE.name+'\n',encoding='utf-8')
    (OUT/'JA21_Semi_Sili_XPU_Console_1.4.0_PACKAGE_CHECK.json').write_bytes(encoded(result))
    print(json.dumps(result,indent=2))

def draft_native_runtime(revalidate=False):
    # This creates no release ZIP and issues no RELEASE_READY record.
    snapshot=HERE/'OVERLAY_1.4.0.json';review=json.loads(snapshot.read_text(encoding='utf-8-sig'))
    _,base,_=load_base();data=merge_review(base,review)
    runtime,inner,changed,compared,_=seal(data,base,review,{'status':'DRAFT_NATIVE_REVALIDATION_ONLY' if revalidate else 'DRAFT_NATIVE_VALIDATION_ONLY'})
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
    target=HERE/('DRAFT_NATIVE_RUNTIME-'+stamp)
    assert not target.exists(),'Previous draft closure must be preserved'
    target.mkdir()
    contents={entry['path']:data[entry['path']] for entry in runtime['files']}
    contents['engine/ja21/runtime.integrity.json']=data['engine/ja21/runtime.integrity.json']
    directories=set()
    for relative in contents:
        canonical(relative);folder=(target/relative).parent
        while folder!=target:
            directories.add(folder);folder=folder.parent
    for folder in sorted(directories,key=lambda path:(len(path.parts),str(path))):folder.mkdir(exist_ok=True)
    import concurrent.futures
    def put(item):
        relative,content=item;file=target/relative;file.write_bytes(content)
        assert sha(file.read_bytes())==sha(content),relative
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:list(pool.map(put,contents.items()))
    result={'schema':'JA21/DRAFT_NATIVE_RUNTIME/1','status':'DRAFT_SEALED_CLOSURE_READY',
      'consoleVersion':'1.4.0','engineVersion':'2.4.0','target':str(target),'runtimeSealedFiles':len(runtime['files']),
      'baselineSha256':BASE_SHA,'reviewedOverlaySha256':sha(snapshot.read_bytes()),
      'runtimeManifestSha256':sha(data['engine/ja21/runtime.integrity.json']),
      'extractedRuntimeHashes':'PASS','helperIncluded':'tools/JA21-Admin-Terminal.exe' in contents,
      'qaIncluded':'tools/Test-Silicon-WebView2.exe' in contents,'archiveWritten':False,'releaseReadyIssued':False,
      'scope':'Native validation-only closure extracted directly from exact fully merged, regenerated sealed bytes. Source/evidence may change after this draft; final release requires a new root-approved freeze.'}
    (HERE/'DRAFT_NATIVE_RUNTIME.json').write_bytes(encoded(result));(target/'DRAFT_NATIVE_RUNTIME.json').write_bytes(encoded(result))
    print(json.dumps(result,indent=2))

def check(revalidate=False):
    snapshot=HERE/'OVERLAY_1.4.0.json';review=json.loads(snapshot.read_text(encoding='utf-8-sig'))
    _,base,_=load_base();data=merge_review(base,review)
    runtime,inner,changed,compared,_=seal(data,base,review,{'status':'DRAFT_NATIVE_REVALIDATION_ONLY' if revalidate else 'DRAFT_NOT_RELEASE_READY'})
    print(json.dumps({'status':'DRAFT_INTEGRITY_PASS','files':len(data),
      'runtimeSealedFiles':len(runtime['files']),'packageIntegrityFiles':len(inner['files']),
      'engineModulesChanged':changed,'sourceDistFilesCompared':compared,
      'archiveWritten':False,'liveValidationClaimed':False},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--prepare',action='store_true');p.add_argument('--package',action='store_true');p.add_argument('--check',action='store_true');p.add_argument('--draft-native',action='store_true');p.add_argument('--native-revalidation',action='store_true')
    args=p.parse_args();assert not args.native_revalidation or (args.check or args.draft_native),'Native revalidation applies only to draft checks/extraction'
    assert sum([args.prepare,args.package,args.check,args.draft_native])==1,'Choose exactly one phase'
    if args.prepare:prepare()
    elif args.check:check(args.native_revalidation)
    elif args.draft_native:draft_native_runtime(args.native_revalidation)
    else:package()
