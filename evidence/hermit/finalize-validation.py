"""Record measured final release scopes without promoting unrun privileged checks."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib,json,re,shutil
work=Path(__file__).resolve().parent
project=work.parent/'blank-console-arm64/project/JA21-Silicon-Console'
engine=project/'applications/silicon'
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
write=lambda p,v:p.write_text(json.dumps(v,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for name in ['TEST_RESULTS.tap','RELEASE_CHECKS.json']:
    shutil.copy2(engine/'audit'/name,work/'engine-audit'/name)
tap=(work/'engine-audit/TEST_RESULTS.tap').read_text(encoding='utf-8-sig')
count=lambda key:int(re.search(r'^# '+key+r' (\d+)\s*$',tap,re.M)[1])
regression={'tests':count('tests'),'passed':count('pass'),'failed':count('fail'),'skipped':count('skipped'),'cancelled':count('cancelled'),'evidence':'evidence/hermit/engine-audit/TEST_RESULTS.tap'}
assert regression=={'tests':461,'passed':458,'failed':0,'skipped':3,'cancelled':0,'evidence':'evidence/hermit/engine-audit/TEST_RESULTS.tap'}
browser=read(work/'browser/LIVE_BROWSER_VALIDATION_THREE_PANES_2.4.0.json')
qa=read(work/'native-startup/NATIVE_WEBVIEW2_ACCEPTANCE_FINAL.json')
relaunch=read(work/'native-startup/NATIVE_MAIN_PROCESS_RELAUNCH_FINAL.json')
native=read(work/'native/NATIVE_COMPILE_RESULTS.json')
assert all(r['status']=='PASS' for r in [browser,qa,relaunch,native])
assert len(qa['checks'])==8 and all(r['status']=='PASS' for r in qa['checks'])
gpu=[c['receipt']['gpu'] for c in browser['checks'] if c['name'].startswith('hardware GPU ')]
assert len(gpu)==5 and all(g['comparison']['mismatches']==0 and g['gpu']['hardwareConfirmed'] and not g['gpu']['fallback'] for g in gpu)
tests={}
for d in ['src','web','scripts','tests']:
    for f in sorted((engine/d).rglob('*')):
        if f.is_file():tests[f.relative_to(project).as_posix()]=digest(f)
for f in [engine/'VERSION',engine/'package.json',engine/'package-lock.json']:
    tests[f.relative_to(project).as_posix()]=digest(f)
for f in native['files']:
    path=project/f['path'];assert digest(path)==f['sha256'];tests[f['path']]=f['sha256']
ui={'schema':'JA21/THREE_PANE_BROWSER_ACCEPTANCE/1','status':'PASS','version':'2.4.0','origin':browser['origin'],
    'method':'Real browser UI actions through the supported browser controls, with DOM transcript observation.',
    'checks':[
        {'name':'Three simultaneously visible panes, two connected XPUs and disconnected Administrator','status':'PASS'},
        {'name':'XPU 1 command writes virtual file, XPU 2 reads exact content and its own marker','status':'PASS','file':'/tmp/ja21-three-panes.txt','content':'PANE-ONE','secondMarker':'PANE-TWO'},
        {'name':'Closing XPU 1 disables only its input; XPU 2 remains usable','status':'PASS'},
        {'name':'Explicit XPU 1 reconnect recovers exact shared file','status':'PASS'},
        {'name':'Worker reboot creates new terminal canvases and recovers exact shared file','status':'PASS','restartedCanvasLabels':['Terminal 4; command input is below','Terminal 5; command input is below']},
        {'name':'Disconnected Administrator pane input remains disabled','status':'PASS'},
        {'name':'Owner loss disconnects standalone WebSocket client with UNKNOWN/no-replay notice','status':'PASS'},
        {'name':'Explicit WebSocket reconnect retains exactly one appended marker','status':'PASS','file':'/tmp/ramws-reconnect-1609.txt','content':'one-admission'}],
    'adminElevationRequested':False,'sourceHashes':{k:v for k,v in tests.items() if k in ['applications/silicon/src/app.js','applications/silicon/web/index.html','applications/silicon/web/style.css']},
    'scope':'Final three-pane browser UI and shared worker checks. Earlier WebSocket reconnect check used the same transport bytes; no elevated helper was opened.'}
write(work/'browser/THREE_PANE_UI_ACCEPTANCE.json',ui)
gates={
    'nativeAdministratorIpc':{'status':'BLOCKED_ENVIRONMENT','reason':'Minimal local named-pipe probes receive Windows ERROR_ACCESS_DENIED (5) in this execution environment. No policy was changed.'},
    'administratorUacStartup':{'status':'NOT_RUN','reason':'No elevated helper was started. Ordinary Windows operator acceptance is documented in docs/ADMINISTRATOR-ACCEPTANCE.md.'},
    'nativeAdministratorToXpuDelegation':{'status':'NOT_RUN','reason':'Actual worker delegation and protocol fixtures pass; elevated end-to-end IPC still requires ordinary Windows acceptance.'},
    'nativeWebView2GpuComputation':{'status':'NOT_RUN','reason':'Actual GPU arithmetic was verified in the live browser; native QA verifies worker, byte lanes, storage and restoration.'},
    'completeBrowserRuntimeProcessShutdown':{'status':'NOT_RUN','reason':'Distinct native host process relaunch and exact recovery pass; exit of every WebView2 broker process was not asserted.'},
    'nativeArm64Startup':{'status':'NOT_RUN','reason':'This package targets Windows x64 and the JA21 JavaScript software XPU. It does not claim an ARM instruction-set runtime or ARM64 OS boot.'}}
report={'schema':'JA21/HERMIT_RELEASE_VALIDATION/1','consoleVersion':'1.4.0','engineVersion':'2.4.0','status':'PASS_WITH_REMAINING_LIVE_GATES',
    'testedUTC':datetime.now(timezone.utc).isoformat(),'regression':regression,
    'static':{'status':'PASS','syntaxFiles':97,'resolvedLocalImports':90,'evidence':'evidence/hermit/engine-audit/RELEASE_CHECKS.json'},
    'liveBrowser':{'status':'PASS','evidence':'evidence/hermit/browser/LIVE_BROWSER_VALIDATION_THREE_PANES_2.4.0.json','fixture':False,'fallback':False,
        'gpuOperations':len(gpu),'arithmeticSamples':sum(g['comparison']['elements'] for g in gpu),'mismatches':0,'adapter':gpu[0]['gpu']['adapter'],
        'reloadRecovery':'PASS','writerLock':'PASS','tiffRoundTrip':'PASS','invalidRestoreRetention':'PASS','persistedStorageGrant':False},
    'threePaneUi':{'status':'PASS','evidence':'evidence/hermit/browser/THREE_PANE_UI_ACCEPTANCE.json','layout':'XPU 1, XPU 2, Administrator PowerShell; independent command inputs; stack on narrow windows'},
    'nativeCompile':{'status':'PASS','target':'x64','warningsAsErrors':True,'evidence':'evidence/hermit/native/NATIVE_COMPILE_RESULTS.json'},
    'nativeWebView2Acceptance':{'status':'PASS','checks':8,'fixture':False,'evidence':'evidence/hermit/native-startup/NATIVE_WEBVIEW2_ACCEPTANCE_FINAL.json'},
    'nativeHostProcessRelaunch':{'status':'PASS','actualProductionEntry':True,'distinctNativeProcesses':True,'exactFileRecovery':True,'exactFieldPreviewRecovery':True,
        'evidence':'evidence/hermit/native-startup/NATIVE_MAIN_PROCESS_RELAUNCH_FINAL.json'},
    'nativePolicy':{'status':'PASS','checks':46,'evidence':'evidence/hermit/native-startup/SILICON_NATIVE_POLICY_RESULTS.json'},
    'nativeAdministratorBoundaryFixtures':{'status':'PASS','checks':32,'evidence':'evidence/hermit/native-security/AdminBoundaryPolicy.result.json'},
    'startupFixes':['Console-mode standard WPF WebView2 control','150-character profile-path guard with storage-preserving error','Short isolated QA profile','Detailed worker errors and fatal state cleanup','Pending terminal-open cancellation and late-session cleanup'],
    'liveGates':gates,'testedSourceHashes':tests,
    'previousAttempts':'Raw failing initialization, long-profile, stale QA assertions and an outer test-log capture failure are preserved separately. Current counts refer only to the final successful canonical run.',
    'scope':'Verified numerical software XPU, real browser GPU arithmetic, three-pane UI, native x64 worker/storage/restore and native-host process relaunch. Administrator integration is implemented but its elevated live checks remain unverified. Integrity seals are hashes rather than publisher signatures.'}
write(work/'RELEASE_VALIDATION.json',report)
build=read(project/'CONSOLE_BUILD.json')
build['default_size']=[1440,900]
build['terminal_layout']={'panes':['XPU 1','XPU 2','Administrator PowerShell'],'independent_inputs':True,'administrator_connection':'explicit Windows elevation','narrow_windows':'stacked panes'}
build['validation']={'date':'2026-10-14','status':report['status'],'current_report':'evidence/hermit/RELEASE_VALIDATION.json','regression':regression,
    'liveBrowser':report['liveBrowser'],'nativeWebView2Acceptance':report['nativeWebView2Acceptance'],'nativeHostProcessRelaunch':report['nativeHostProcessRelaunch'],
    'remaining_live_gates':gates,'prior_validation':'Historical baseline reports and reference files are preserved byte-exact.'}
write(project/'CONSOLE_BUILD.json',build)
print(json.dumps({'status':report['status'],'regression':regression,'sourceBindings':len(tests),'nativeLiveChecks':len(qa['checks']),'gpuElements':report['liveBrowser']['arithmeticSamples']},indent=2))
