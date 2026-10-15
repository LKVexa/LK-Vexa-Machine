"""Build the exact current native sources and capture bounded, non-elevating validation.

UAC is never started by this runner. The optional probes exercise the current
token's ConPTY/NamedPipe behavior and keep their status separate from compilation.
"""
import argparse, hashlib, json, os, subprocess
from datetime import datetime, timezone
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
PROJECT=ROOT/'work/blank-console-arm64/project/JA21-Silicon-Console'
sha=lambda b:hashlib.sha256(b).hexdigest()
def run(args,name,timeout=60):
    env=os.environ.copy();temp=HERE/'tmp';temp.mkdir(exist_ok=True);env['TEMP']=str(temp);env['TMP']=str(temp)
    try:
        p=subprocess.run(args,cwd=PROJECT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        text=p.stdout.decode('utf-8',errors='replace');code=p.returncode
    except subprocess.TimeoutExpired as e:text=(e.stdout or b'').decode('utf-8',errors='replace')+'\nTIMEOUT';code=None
    (HERE/(name+'.log')).write_text(text,encoding='utf-8')
    return {'status':'PASS' if code==0 else 'TIMEOUT' if code is None else 'FAIL','exitCode':code,'log':name+'.log'}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--probes',action='store_true');parser.add_argument('--acceptance-only',action='store_true');args=parser.parse_args()
    builds={}
    prior=None
    if args.acceptance_only:
        prior=json.loads((HERE/'NATIVE_COMPILE_RESULTS.json').read_text(encoding='utf-8'))
        assert prior['status']=='PASS' and prior['consoleVersion']=='1.4.0' and prior['engineVersion']=='2.4.0'
        for item in prior['files']:
            if item['path'] in ['tools/SiliconWebView2Acceptance.cs','tools/Test-Silicon-WebView2.exe']:continue
            data=(PROJECT/item['path']).read_bytes()
            assert len(data)==item['bytes'] and sha(data)==item['sha256'],'Main/helper build input or binary changed: '+item['path']
        builds['main-and-helper']={**prior['builds']['main-and-helper'],'verifiedUnchanged':True,'precedingBuildRecordUTC':prior['testedUTC']}
    build_list=[('acceptance','tools/Build-Silicon-Acceptance.cmd')] if args.acceptance_only else [('main-and-helper','host/Build-SiliconConsole.cmd'),('acceptance','tools/Build-Silicon-Acceptance.cmd')]
    for name,file in build_list:
        builds[name]=run(['cmd.exe','/d','/c',str(PROJECT/file)],'compile-'+name)
    assert all(x['status']=='PASS' for x in builds.values()),builds
    fixtures=run([str(PROJECT/'tools/JA21-Admin-Terminal.exe'),'--self-test'],'admin-protocol-fixtures')
    paths=['host/JA21VirtualBrowser.cs','host/Vec1Substrate.cs','host/PortableDesktop.cs','host/LiveWebContracts.cs',
      'host/SiliconApp.cs','host/LiveWebBridge.cs','host/HostAdminBridge.cs','host/AdminTerminal.cs','host/SiliconConsoleEntry.cs',
      'host/Build-SiliconConsole.cmd','tools/Build-Silicon-Acceptance.cmd','tools/SiliconWebView2Acceptance.cs',
      'JA21-Silicon-Console.exe','tools/JA21-Admin-Terminal.exe','tools/Test-Silicon-WebView2.exe',
      'runtime/webview2-sdk/1.0.4191.47/Microsoft.Web.WebView2.Core.dll','runtime/webview2-sdk/1.0.4191.47/Microsoft.Web.WebView2.Wpf.dll']
    files=[]
    for name in paths:
        b=(PROJECT/name).read_bytes();files.append({'path':name,'bytes':len(b),'sha256':sha(b)})
    record={'schema':'JA21/HERMIT_NATIVE_COMPILE/1','status':'PASS','consoleVersion':'1.4.0','engineVersion':'2.4.0',
      'testedUTC':datetime.now(timezone.utc).isoformat(),'warningsAsErrors':True,'warningLevel':4,'target':'x64',
      'mainAndHelperRecompiledThisRun':not args.acceptance_only,
      'compiler':'Windows .NET Framework 4.x csc.exe, fixed SystemRoot compiler used by packaged build scripts',
      'builds':builds,'files':files,'protocolFixtures':fixtures,
      'nativeUi':'NOT_RUN_IN_THIS_RUNNER','adminUacStartup':'NOT_RUN','fullApplicationRestart':'NOT_RUN',
      'scope':'Fresh exact native main, Administrator helper and acceptance binaries. Compile/source hashes and protocol fixtures do not establish UAC consent, elevated startup, native GUI or restart acceptance.'}
    if args.acceptance_only:record['scope']='Acceptance binary freshly rebuilt. Main and Administrator helper inputs/binaries verified byte-identical to preceding successful build. Compile/source hashes and protocol fixtures do not establish UAC consent, elevated startup, native GUI or restart acceptance.'
    if args.probes:
        record['namedPipeProbe']=run([str(PROJECT/'tools/JA21-Admin-Terminal.exe'),'--pipe-test'],'named-pipe-probe',40)
        record['conPtyProbe']=run([str(PROJECT/'tools/JA21-Admin-Terminal.exe'),'--conpty-test'],'conpty-probe',45)
    (HERE/'NATIVE_COMPILE_RESULTS.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':record['status'],'files':len(files),'protocolFixtures':fixtures,**({k:record[k] for k in ['namedPipeProbe','conPtyProbe']} if args.probes else {}),'adminUacStartup':'NOT_RUN'},indent=2))
if __name__=='__main__':main()
