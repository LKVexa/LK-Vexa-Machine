#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Opt-in Windows regression for Internet-zone WebView2 SDK assembly loading.

Run manually from a full repository/export with the current runtime seal:
    python tests/test_downloaded_sdk_startup.py --run --work-parent D:\\Codex

Default invocation only prints help. --run creates a new owned runtime copy,
sets ZoneId=3 only on its copied SDK managed DLLs, and starts the shipped console
without elevation. The test does not remove any download markers or alter machine
configuration. The native window observation is not a worker/DOM acceptance test.
--reuse-owned-root is reserved for an already-created disposable regression root
with the explicit ownership marker; never pass a user's installed application.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import time

CONFIGS=('JA21-Silicon-Console.exe.config','tools/Test-Silicon-WebView2.exe.config')
SDK=('runtime/webview2-sdk/1.0.4191.47/Microsoft.Web.WebView2.Core.dll',
     'runtime/webview2-sdk/1.0.4191.47/Microsoft.Web.WebView2.Wpf.dll')
ZONE=b'[ZoneTransfer]\r\nZoneId=3\r\n'
OWNER='.ja21-downloaded-sdk-test-root'
OWNER_VALUE=b'JA21_DOWNLOADED_SDK_TEST_ROOT/1\n'

MONITOR_SOURCE=r'''
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
class OwnedWindowMonitor {
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder name,int count);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 static int Main(string[] args) {
  if(args.Length!=2)return 2;
  string root=Path.GetFullPath(args[0]), report=Path.GetFullPath(args[1]);
  var row=new Dictionary<string,object>();
  var output=new StringBuilder(); var errors=new StringBuilder(); object gate=new object();
  Process child=null; var clock=Stopwatch.StartNew();
  bool visible=false, presenter=false, closed=false, forced=false, processStarted=false; double observedAt=-1;
  int exit=-999;
  try {
   var start=new ProcessStartInfo(Path.Combine(root,"JA21-Silicon-Console.exe"));
   start.WorkingDirectory=root; start.UseShellExecute=false; start.CreateNoWindow=true;
   start.RedirectStandardOutput=true; start.RedirectStandardError=true;
   child=new Process(); child.StartInfo=start;
   child.OutputDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data!=null)lock(gate){output.AppendLine(e.Data);}};
   child.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data!=null)lock(gate){errors.AppendLine(e.Data);}};
   if(!child.Start())throw new Exception("Owned native process did not start");
   processStarted=true;
   row["ownedProcessId"]=child.Id;
   row["ownedProcessImage"]=start.FileName;
   child.BeginOutputReadLine(); child.BeginErrorReadLine();
   while(clock.Elapsed.TotalSeconds<85) {
    if(child.HasExited)break;
    child.Refresh(); IntPtr window=child.MainWindowHandle;
    if(window!=IntPtr.Zero&&IsWindowVisible(window)) {
     uint pid; GetWindowThreadProcessId(window,out pid);
     var name=new StringBuilder(256); GetClassName(window,name,name.Capacity);
     if(pid==(uint)child.Id&&name.ToString().StartsWith("HwndWrapper",StringComparison.Ordinal)) {
      visible=true; row["windowHandle"]=window.ToInt64(); row["windowProcessId"]=pid;
      row["windowClass"]=name.ToString(); row["windowTitle"]=child.MainWindowTitle;
      if(observedAt<0)observedAt=clock.Elapsed.TotalSeconds;
     }
    }
    lock(gate){presenter=output.ToString().Contains("presenter-run");}
    if(visible&&presenter&&clock.Elapsed.TotalSeconds-observedAt>=8) {
     closed=child.CloseMainWindow();
     if(!closed)throw new Exception("Owned WPF window did not accept CloseMainWindow");
     if(!child.WaitForExit(15000))throw new TimeoutException("Owned window did not exit cleanly");
     break;
    }
    Thread.Sleep(100);
   }
   if(!child.HasExited)throw new TimeoutException("Owned native process/window observation deadline expired");
   child.WaitForExit(); exit=child.ExitCode;
  }catch(Exception e){row["error"]=e.ToString();}
  finally {
   if(child!=null){try{if(!child.HasExited){forced=true;child.Kill();child.WaitForExit(5000);}exit=child.ExitCode;}catch(Exception e){row["cleanupError"]=e.Message;}}
   row["status"]=visible&&presenter&&closed&&exit==0&&!forced?"PASS":"NOT_A_CLEAN_WINDOW_PASS";
   row["actualExecutableStartedAsSeparateProcess"]=processStarted;
   row["visibleOwnedWpfWindowObserved"]=visible;row["presenterRunObserved"]=presenter;
   row["closeMainWindowAccepted"]=closed;row["forcedTermination"]=forced;row["productionExitCode"]=exit;
   row["elapsedSeconds"]=clock.Elapsed.TotalSeconds;
   row["scope"]="Actual shipped executable, its own CLR configuration, owned WPF window and clean close; no worker/DOM, GPU, UAC, or Administrator delegation assertion";
   lock(gate){row["stdout"]=output.ToString();row["stderr"]=errors.ToString();}
   var json=new JavaScriptSerializer{MaxJsonLength=4*1024*1024};
   File.WriteAllText(report,json.Serialize(row),new UTF8Encoding(false));
   if(child!=null)child.Dispose();
  }
  return 0;
 }
}
'''

def sha(data): return hashlib.sha256(data).hexdigest()
def rewrite_existing_stream(target,data):
    # OPEN_EXISTING preserves other NTFS streams; CREATE_ALWAYS can discard ADS.
    with target.open('r+b') as stream:
        stream.seek(0); stream.write(data); stream.truncate()

def member(root,relative):
    if not isinstance(relative,str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('Noncanonical test runtime path')
    posix=PurePosixPath(relative)
    if posix.is_absolute() or any(p in ('','.','..') for p in relative.split('/')):
        raise ValueError('Unsafe test runtime path')
    root=root.resolve(); target=root.joinpath(*relative.split('/'))
    if not target.resolve().is_relative_to(root): raise ValueError('Test runtime path escapes root')
    current=root
    for part in relative.split('/'):
        current=current/part
        if current.exists():
            info=current.lstat()
            if current.is_symlink() or getattr(info,'st_file_attributes',0)&0x400:
                raise ValueError('Linked/reparse test path refused')
    return target

def verify(root,seal):
    seen=set()
    for row in seal['files']:
        key=row['path'].casefold()
        if key in seen: raise ValueError('Duplicate runtime path')
        seen.add(key); data=member(root,row['path']).read_bytes()
        if len(data)!=row['bytes'] or sha(data)!=row['sha256']:
            raise ValueError('Runtime bytes disagree: '+row['path'])

def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--run',action='store_true',help='Explicitly run this Windows native-window regression')
    parser.add_argument('--source-root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--work-parent',type=Path,default=Path(r'D:\Codex'))
    parser.add_argument('--reuse-owned-root',type=Path,help='Developer-only: reuse a disposable root carrying the required ownership marker')
    parser.add_argument('--report-dir',type=Path,help='Fresh evidence directory, required with --reuse-owned-root')
    args=parser.parse_args()
    if not args.run: parser.print_help(); return 0
    if os.name!='nt': parser.error('This opt-in regression requires Windows')
    source=args.source_root.resolve()
    seal_bytes=member(source,'engine/ja21/runtime.integrity.json').read_bytes(); seal=json.loads(seal_bytes)
    if seal.get('format')!='vb-ja21-runtime-seal/4' or len(seal['files'])<360:
        parser.error('A complete current source/runtime closure of at least 360 members is required')
    if not set(CONFIGS).issubset({r['path'] for r in seal['files']}): parser.error('Both app-scoped configurations must be sealed')
    verify(source,seal)
    if args.reuse_owned_root:
        root=args.reuse_owned_root.resolve()
        if (root/OWNER).read_bytes()!=OWNER_VALUE: parser.error('Disposable-root ownership marker missing')
        if not args.report_dir: parser.error('Fresh --report-dir required for reuse')
        reports=args.report_dir.resolve()
        if reports.exists(): parser.error('Fresh report directory required')
        reports.mkdir(parents=True)
        verify(root,seal)
        if member(root,'engine/ja21/runtime.integrity.json').read_bytes()!=seal_bytes: parser.error('Reused root manifest differs')
    else:
        args.work_parent.mkdir(parents=True,exist_ok=True)
        run=Path(tempfile.mkdtemp(prefix='ja21-sdk-zone-',dir=args.work_parent))
        root=run/'runtime'; reports=run/'reports'; root.mkdir(); reports.mkdir()
        for row in seal['files']:
            target=member(root,row['path']); target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(member(source,row['path']).read_bytes())
        member(root,'engine/ja21/runtime.integrity.json').write_bytes(seal_bytes)
        (root/OWNER).write_bytes(OWNER_VALUE)
    result={'schema':'LK-VEXA-MACHINE/DOWNLOADED-SDK-STARTUP-REGRESSION/1','status':'RUNNING',
            'startedUtc':datetime.now(timezone.utc).isoformat(),'ownedRoot':str(root),'reportDirectory':str(reports),
            'runtimeManifestSha256':sha(seal_bytes),'runtimeMembers':len(seal['files']),'uacAttempted':False,
            'globalPolicyChanged':False,'downloadMarkersRemoved':False,'checks':[]}
    report=reports/'DOWNLOADED_SDK_STARTUP_RESULTS.json'
    def save(): report.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    def run(name,argv,timeout=60):
        began=time.monotonic(); row={'name':name,'arguments':[str(a) for a in argv],'timeoutSeconds':timeout}
        try:
            p=subprocess.run([str(a) for a in argv],cwd=root,capture_output=True,timeout=timeout)
            row.update(exitCode=p.returncode,stdout=p.stdout.decode('utf-8','replace'),stderr=p.stderr.decode('utf-8','replace'),timedOut=False)
        except subprocess.TimeoutExpired as e:
            row.update(exitCode=None,stdout=(e.stdout or b'').decode('utf-8','replace'),stderr=(e.stderr or b'').decode('utf-8','replace'),timedOut=True)
        row['elapsedSeconds']=round(time.monotonic()-began,3); result['checks'].append(row); save()
        print(name+': '+str(row['exitCode']),flush=True); return row
    exe=member(root,'JA21-Silicon-Console.exe')
    def preflight(name): return run(name,[exe,'--preflight'])
    try:
        save()
        for relative in SDK: Path(str(member(root,relative))+':Zone.Identifier').write_bytes(ZONE)
        verify(root,seal)
        csc=Path(os.environ['SystemRoot'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
        monitor_cs=reports/'OwnedWindowMonitor.cs'; monitor_cs.write_text(MONITOR_SOURCE,encoding='utf-8')
        monitor=reports/'OwnedWindowMonitor.exe'
        compile_check=run('compile owned-process monitor',[csc,'/nologo','/warn:4','/warnaserror+','/platform:x64','/target:exe','/out:'+str(monitor),'/r:System.Web.Extensions.dll',monitor_cs])
        compile_check['passed']=compile_check['exitCode']==0
        if not compile_check['passed']: raise RuntimeError('Native monitor compilation failed')
        configs={relative:member(root,relative).read_bytes() for relative in CONFIGS}
        try:
            for relative in CONFIGS: member(root,relative).unlink()
            baseline=dict(seal); baseline['files']=[r for r in seal['files'] if r['path'] not in CONFIGS]
            member(root,'engine/ja21/runtime.integrity.json').write_text(json.dumps(baseline,indent=2)+'\n',encoding='utf-8')
            first=preflight('without configurations: actual Main preflight')
            first['passed']=first['exitCode']==0 and 'preflight PASS' in first['stdout']
            baseline_report=reports/'BASELINE_ACTUAL_PROCESS.json'
            before=run('without configurations: actual executable process',[monitor,root,baseline_report],110)
            proof=json.loads(baseline_report.read_text(encoding='utf-8-sig')); before['processReport']=proof
            text=proof.get('stdout','')+proof.get('stderr','')
            before['passed']=before['exitCode']==0 and proof.get('productionExitCode')==1 and '0x80131515' in text and 'Microsoft.Web.WebView2.Core' in text and not proof.get('presenterRunObserved')
        finally:
            for relative,data in configs.items(): member(root,relative).write_bytes(data)
            member(root,'engine/ja21/runtime.integrity.json').write_bytes(seal_bytes)
            save()
        fixed=preflight('with sealed configurations: actual Main preflight')
        fixed['passed']=fixed['exitCode']==0 and 'preflight PASS' in fixed['stdout']
        qa=run('with sealed configurations: actual QA SDK-load preflight',[member(root,'tools/Test-Silicon-WebView2.exe'),'--preflight'])
        qa['passed']=qa['exitCode']==0 and 'PREFLIGHT PASS' in qa['stdout']
        fixed_report=reports/'FIXED_ACTUAL_PROCESS.json'
        good=run('with sealed configurations: actual executable WPF window and clean close',[monitor,root,fixed_report],110)
        good['processReport']=json.loads(fixed_report.read_text(encoding='utf-8-sig'))
        good['passed']=good['exitCode']==0 and good['processReport'].get('status')=='PASS'
        for relative in (CONFIGS[0],SDK[0]):
            target=member(root,relative); original=target.read_bytes()
            ads=Path(str(target)+':Zone.Identifier') if relative in SDK else None
            original_ads=ads.read_bytes() if ads else None
            try:
                rewrite_existing_stream(target,original+b'\n')
                if ads and ads.read_bytes()!=original_ads: raise RuntimeError('Tamper operation changed an SDK download marker')
                bad=preflight('reject tampered '+relative)
                bad['expectedFailure']='Runtime integrity failure: '+relative
                bad['passed']=bad['exitCode']==1 and bad['expectedFailure'] in bad['stdout']+bad['stderr'] and 'presenter-run' not in bad['stdout']
            finally:
                rewrite_existing_stream(target,original)
                if target.read_bytes()!=original: raise RuntimeError('Exact byte restoration failed')
                if ads and ads.read_bytes()!=original_ads: raise RuntimeError('Restoration changed an SDK download marker')
                save()
        final=preflight('restored fixed root: final actual Main preflight')
        final['passed']=final['exitCode']==0 and 'preflight PASS' in final['stdout']
        verify(root,seal)
        result['allRuntimeHashesMatch']=True
        result['sdkInternetZoneMarkersRetained']=all(Path(str(member(root,p))+':Zone.Identifier').read_bytes()==ZONE for p in SDK)
        result['status']='PASS' if all(r.get('passed') is True for r in result['checks']) and result['sdkInternetZoneMarkersRetained'] else 'FAIL'
    except Exception as error:
        result['status']='FAIL'; result['error']=repr(error)
    finally:
        result['finishedUtc']=datetime.now(timezone.utc).isoformat(); save()
    print(str(report),flush=True)
    return 0 if result['status']=='PASS' else 1

if __name__=='__main__': raise SystemExit(main())
