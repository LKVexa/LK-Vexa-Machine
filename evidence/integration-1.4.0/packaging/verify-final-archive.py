"""Independently reopen the exact final ZIP and verify coverage, hashes and preservation."""
import argparse,hashlib,json,re,zipfile
from pathlib import Path
from datetime import datetime,timezone
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2];OUT=ROOT/'outputs'
parser=argparse.ArgumentParser();parser.add_argument('--sha256',required=True);args=parser.parse_args()
archive=OUT/'JA21_Semi_Sili_XPU_Console_1.4.0.zip';prefix='JA21-Semi-Sili-XPU-Console-1.4.0/'
sha=lambda content:hashlib.sha256(content).hexdigest()
assert re.fullmatch('[0-9a-f]{64}',args.sha256) and sha(archive.read_bytes())==args.sha256
with zipfile.ZipFile(archive) as z:
    names=z.namelist();assert len(names)==len(set(name.casefold() for name in names));assert z.testzip() is None
    assert all(name.startswith(prefix) and not name.endswith('/') for name in names)
    data={name[len(prefix):]:z.read(name) for name in names}
for name in data:
    assert not name.startswith(('/','\\')) and '\\' not in name
    for part in name.split('/'):
        assert part not in {'','.','..'} and not part.endswith((' ','.')) and not re.search(r'[<>:"|?*\x00-\x1f]',part),name
        assert not re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?',part),name
manifest_counts={}
def manifest(name,anchor='',coverage=None):
    report=json.loads(data[name]);entries=report['files'];assert len(entries)==len({e['path'].casefold() for e in entries})
    if coverage is not None:assert {e['path'] for e in entries}==coverage,name
    for e in entries:
        content=data[anchor+e['path']];assert isinstance(e['bytes'],int) and len(content)==e['bytes'] and sha(content)==e['sha256'],name+':'+e['path']
    manifest_counts[name]=len(entries);return report
outer=manifest('FILES_MANIFEST.json',coverage=set(data)-{'FILES_MANIFEST.json','SHA256SUMS.txt'})
component='applications/silicon/';manifest(component+'FILES_MANIFEST.json',component,{name[len(component):] for name in data if name.startswith(component)}-{'FILES_MANIFEST.json','SHA256SUMS.txt'})
manifest('package.integrity.json');runtime=manifest('engine/ja21/runtime.integrity.json')
for sums,anchor,covered in [('SHA256SUMS.txt','',set(data)-{'SHA256SUMS.txt'}),(component+'SHA256SUMS.txt',component,{n[len(component):] for n in data if n.startswith(component)}-{'SHA256SUMS.txt'})]:
    lines=[line.split('  ',1) for line in data[sums].decode('utf-8').splitlines()];assert len(lines)==len(covered) and {line[1] for line in lines}==covered
    for digest,name in lines:assert sha(data[anchor+name])==digest
assert data['CONSOLE_VERSION'].decode().strip()=='1.4.0' and data[component+'VERSION'].decode().strip()=='2.4.0'
assert json.loads(data[component+'dist/release.json'])['version']=='2.4.0'
assert sha(data[component+'references/hermit-ramws_2.0.0-ramws.1(3).zip'])=='4577a4c720fcd2769acf53ca462f3f9534144ca523e104a33b7e201720f90a6e'
baseline=OUT/'JA21_Semi_Sili_XPU_Console_1.3.0.zip';assert sha(baseline.read_bytes())=='d5b1561175609cd1b7adfae15bce384c1cb0887aa8b96d1295e79cbe09b1febc'
with zipfile.ZipFile(baseline) as z:
    oldprefix='JA21-Semi-Sili-XPU-Console-1.3.0/';oldnames={name[len(oldprefix):]:name for name in z.namelist()};assert set(oldnames)<=set(data)
    retained=[name for name in oldnames if name.startswith(('evidence/',component+'audit/',component+'references/'))]
    for name in retained:assert data[name]==z.read(oldnames[name]),name
comparison=json.loads(data['evidence/integration-1.4.0/RUNTIME_COMPARISON_TO_TESTED.json']);assert comparison['status'] in {'PASS_EXACT','PASS_METADATA_ONLY'}
result=dict(schema='JA21/FINAL_ARCHIVE_INDEPENDENT_VERIFICATION/1',status='PASS',archive=archive.name,archiveSha256=args.sha256,archiveBytes=archive.stat().st_size,testedUTC=datetime.now(timezone.utc).isoformat(),files=len(data),zipCrc='PASS',windowsPaths='PASS',manifestEntries=manifest_counts,baselinePathsPreserved=len(oldnames),historicalEvidenceAndReferencesByteExact=len(retained),runtimeComparison=comparison,scope='Independent fresh ZIP reader, complete outer/component coverage and every manifest hash, checksum lists, Windows paths, baseline path preservation and byte-exact historical evidence/reference comparison. No extraction, browser, UAC or privileged process launched.')
(OUT/'JA21_Semi_Sili_XPU_Console_1.4.0_ARCHIVE_VERIFY.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,indent=2))
