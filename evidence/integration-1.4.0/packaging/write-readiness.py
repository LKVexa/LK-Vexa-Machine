"""Bind root-approved final tests to an immutable 1.4.0 overlay. Never launches UAC."""
import argparse,hashlib,json,re
from datetime import datetime,timezone
from pathlib import Path
HERE=Path(__file__).resolve().parent
WORK=HERE.parent
ROOT=HERE.parents[2]
PROJECT=ROOT/'work/blank-console-arm64/project/JA21-Silicon-Console'
BASE_SHA='d5b1561175609cd1b7adfae15bce384c1cb0887aa8b96d1295e79cbe09b1febc'
sha=lambda content:hashlib.sha256(content).hexdigest()
read_json=lambda file:json.loads(file.read_text(encoding='utf-8-sig'))
p=argparse.ArgumentParser()
p.add_argument('--confirm-root-ready',action='store_true',help='Use only after the root agent has supplied final evidence and explicitly authorized this freeze.')
args=p.parse_args()
assert args.confirm_root_ready,'Final root-ready signal is required; preparation alone does not authorize packaging'
validation=read_json(WORK/'RELEASE_VALIDATION.json')
assert validation['consoleVersion']=='1.4.0' and validation['engineVersion']=='2.4.0'
assert validation['status'] in {'PASS','PASS_WITH_REMAINING_LIVE_GATES'}
assert isinstance(validation.get('liveGates'),dict) and validation['liveGates'],'State the remaining native UI, process restart and UAC gates explicitly'
snapshot=HERE/'OVERLAY_1.4.0.json';review=read_json(snapshot)
assert review['baselineSha256']==BASE_SHA
inputs={}
for group in ['files','references','evidence']:
    for entry in review[group]:
        content=Path(entry['source']).read_bytes()
        assert len(content)==entry['bytes'] and sha(content)==entry['sha256'],entry['target']
        inputs[entry['target']]=entry
assert review['inheritedReferences']['sourceFiles']==26 and review['inheritedReferences']['pdfFiles']==25

def bound(target):
    assert target in inputs,'Fresh validation evidence is absent from reviewed overlay: '+target
    entry=inputs[target];content=Path(entry['source']).read_bytes()
    assert sha(content)==entry['sha256'],target
    return content

regression=validation['regression'];tap=bound(regression['evidence']).decode('utf-8-sig')
counts={'tests':regression['tests'],'pass':regression['passed'],'fail':regression['failed'],'skipped':regression['skipped'],'cancelled':regression['cancelled']}
assert counts['fail']==0 and counts['cancelled']==0 and counts['tests']==counts['pass']+counts['fail']+counts['skipped']
for key,count in counts.items():
    assert isinstance(count,int) and not isinstance(count,bool) and count>=0
    assert re.search(r'^# '+key+r' '+str(count)+r'\s*$',tap,re.M),(key,count)
static=json.loads(bound(validation['static']['evidence']))
assert static['version']=='2.4.0' and static['results'] and all(entry['status']=='PASS' for entry in static['results'])
native_target='evidence/hermit/native/NATIVE_COMPILE_RESULTS.json'
native=json.loads(bound(native_target))
assert native['status']=='PASS' and native['consoleVersion']=='1.4.0' and native['engineVersion']=='2.4.0'
assert native['warningsAsErrors'] is True and native['target']=='x64'
tested=dict(validation['testedSourceHashes']);assert tested
for entry in native['files']:
    name=entry['path'];assert isinstance(name,str) and ':' not in name and '\\' not in name and not name.startswith('/') and all(part not in {'','..','.'} for part in name.split('/'))
    file=PROJECT/name;content=file.read_bytes()
    assert len(content)==entry['bytes'] and sha(content)==entry['sha256'],entry['path']
    if entry['path'] in tested:assert tested[entry['path']]==entry['sha256'],entry['path']
    tested[entry['path']]=entry['sha256']
for name,digest in tested.items():
    assert isinstance(name,str) and ':' not in name and '\\' not in name and not name.startswith('/') and all(part not in {'','..','.'} for part in name.split('/'))
    assert sha((PROJECT/name).read_bytes())==digest,'Tested source changed: '+name
bindings=[{'target':target,'sha256':inputs[target]['sha256']} for target in [regression['evidence'],validation['static']['evidence'],native_target,'evidence/hermit/RELEASE_VALIDATION.json']]
result={'schema':'JA21/HERMIT_PACKAGING_READINESS/1','status':'READY_FOR_PACKAGING',
  'createdUTC':datetime.now(timezone.utc).isoformat(),'consoleVersion':'1.4.0','engineVersion':'2.4.0',
  'baselineSha256':BASE_SHA,'reviewedOverlaySha256':sha(snapshot.read_bytes()),
  'testedSourceHashes':tested,'validationEvidence':bindings,'validation':validation,
  'scope':'Root-approved current source/evidence freeze. Passed checks and remaining live gates retain their distinct statuses; fixture validation does not establish hardware GPU, UAC or browser durability.'}
(HERE/'RELEASE_READY.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'status':result['status'],'overlaySha256':result['reviewedOverlaySha256'],'sourceBindings':len(tested),'evidenceBindings':len(bindings),'regression':counts,'liveGates':validation['liveGates']},indent=2))
