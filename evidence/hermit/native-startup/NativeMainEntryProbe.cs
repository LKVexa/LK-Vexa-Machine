using System;
using System.Collections.Generic;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Reflection;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
public static class NativeMainEntryProbe {
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=4*1024*1024};
 static readonly Dictionary<string,object> Report=new Dictionary<string,object>();
 static string output,mode="startup",seedFile;static int stage;static bool busy,finished;static int ticks;static DispatcherTimer timer;
 static IWebView2 Find(DependencyObject node){if(node==null)return null;var view=node as IWebView2;if(view!=null)return view;for(int i=0;i<VisualTreeHelper.GetChildrenCount(node);i++){var found=Find(VisualTreeHelper.GetChild(node,i));if(found!=null)return found;}return null;}
 static string Sha(string file){using(var hash=SHA256.Create()){return BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(file))).Replace("-","").ToLowerInvariant();}}
 static void Save(){File.WriteAllText(Path.Combine(output,"NATIVE_MAIN_ENTRY_RESULT.json"),Json.Serialize(Report));}
 [STAThread] public static int Main(string[] args){
  if(args.Length<2||args.Length>4)return 2;if(args.Length>=3)mode=args[2];if(mode!="startup"&&mode!="seed"&&mode!="verify")return 2;if(mode=="verify"){if(args.Length!=4)return 2;seedFile=Path.GetFullPath(args[3]);}string root=Path.GetFullPath(args[0]);output=Path.GetFullPath(args[1]);if(Directory.Exists(output))throw new Exception("Fresh diagnostic output required");Directory.CreateDirectory(output);
  Report["schema"]="JA21/NATIVE_MAIN_ENTRY_DIAGNOSIS/1";Report["status"]="RUNNING";Report["root"]=root;Report["startedUtc"]=DateTime.UtcNow.ToString("o");Report["uacInvoked"]=false;Report["processorActionsClicked"]=false;Report["realProductionEntryInvoked"]=true;Report["domInstrumentationInjected"]=false;Report["securityFlagsModified"]=false;Report["mode"]=mode;Report["nativeProcessId"]=Process.GetCurrentProcess().Id;Report["virtualCommandsSubmitted"]=mode!="startup";
  try{
   if(new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))throw new Exception("Non-elevated execution required");
   foreach(string name in new string[]{"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS","WEBVIEW2_USER_DATA_FOLDER","WEBVIEW2_BROWSER_EXECUTABLE_FOLDER","JA21_WEBVIEW2_FIXED_ROOT"})if(!String.IsNullOrEmpty(Environment.GetEnvironmentVariable(name)))throw new Exception("Unexpected WebView2 override: "+name);
   string sdk=Path.Combine(root,"runtime","webview2-sdk","1.0.4191.47");AppDomain.CurrentDomain.AssemblyResolve+=delegate(object sender,ResolveEventArgs e){string name=new AssemblyName(e.Name).Name;if(name!="Microsoft.Web.WebView2.Core"&&name!="Microsoft.Web.WebView2.Wpf")return null;return Assembly.LoadFrom(Path.Combine(sdk,name+".dll"));};
   Report["productionExeSha256"]=Sha(Path.Combine(root,"JA21-Silicon-Console.exe"));Report["runtimeManifestSha256"]=Sha(Path.Combine(root,"engine","ja21","runtime.integrity.json"));
   Assembly production=Assembly.LoadFrom(Path.Combine(root,"JA21-Silicon-Console.exe"));timer=new DispatcherTimer(DispatcherPriority.Background){Interval=TimeSpan.FromSeconds(1)};timer.Tick+=Tick;timer.Start();
   var main=production.GetType("VBJA21.SiliconConsoleEntry",true).GetMethod("Main",BindingFlags.Public|BindingFlags.Static);int exit=(int)main.Invoke(null,new object[]{new string[]{"--root",root}});Report["productionExitCode"]=exit;string boot=Path.Combine(root,"workspace","logs","boot-latest.log");if(File.Exists(boot)){string log=File.ReadAllText(boot);Report["productionBootLog"]=log;Report["programRunReached"]=log.Contains("presenter-run");}
   if(!finished){Report["status"]="FAIL";Report["error"]="Production main returned before Online capture.";}
   return finished&&Convert.ToString(Report["status"])=="PASS"&&exit==0?0:1;
  }catch(Exception e){Report["status"]="FAIL";Report["error"]=e.ToString();Report["hresult"]="0x"+e.HResult.ToString("X8");return 1;}
  finally{if(timer!=null)timer.Stop();Report["finishedUtc"]=DateTime.UtcNow.ToString("o");Save();Console.WriteLine(Path.Combine(output,"NATIVE_MAIN_ENTRY_RESULT.json"));}
 }
 static async void Tick(object sender,EventArgs args){
  if(busy||finished)return;busy=true;ticks++;
  try{
   if(ticks>50)throw new TimeoutException("Actual main window/Online worker startup timed out.");
   var app=Application.Current;if(app==null||app.MainWindow==null)return;
   var view=Find(app.MainWindow);if(view==null||view.CoreWebView2==null)return;
   string raw=await view.CoreWebView2.ExecuteScriptAsync("(()=>({readyState:document.readyState,url:location.href,title:document.title,secureContext:isSecureContext,indexedDB:!!indexedDB,locks:!!navigator.locks,gpu:!!navigator.gpu,connection:document.getElementById('connection')?.textContent,notice:document.getElementById('notice')?.textContent,transcript:document.getElementById('transcript')?.textContent,version:document.getElementById('version')?.textContent,viewportWidth:innerWidth,panes:[...document.querySelectorAll('.terminal-pane')].map(p=>({id:p.id,kind:p.dataset.kind,session:p.dataset.session,inputDisabled:p.querySelector('input')?.disabled,visible:p.getClientRects().length>0,left:p.getBoundingClientRect().left,right:p.getBoundingClientRect().right}))}))()");
   var dom=Json.DeserializeObject(raw) as Dictionary<string,object>;Report["dom"]=dom;Report["windowTitle"]=app.MainWindow.Title;Report["runtime"]=view.CoreWebView2.Environment.BrowserVersionString;Report["viewType"]=view.GetType().FullName;
   if(dom==null||!dom.ContainsKey("connection"))return;
   string connection=Convert.ToString(dom["connection"]);if(connection!="Online"&&connection!="Blocked")return;
   if(connection=="Online"&&!Object.Equals(await Script(view,"(()=>{const panes=[...document.querySelectorAll('.terminal-pane')],xs=panes.filter(p=>p.dataset.kind==='xpu'),a=panes.find(p=>p.dataset.kind==='admin');return panes.length===3&&xs.length===2&&xs.every(p=>p.dataset.session==='connected'&&!p.querySelector('input').disabled)&&a?.dataset.session==='disconnected'&&a.querySelector('input').disabled;})()"),true))return;
   Report["threePanesObserved"]=connection=="Online";
   if(connection=="Online"&&mode!="startup"&&!await Exercise(view))return;
   using(var stream=File.Create(Path.Combine(output,"NATIVE_DOCUMENT_MAIN_ENTRY.png")))await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,stream);
   Report["screenshot"]="NATIVE_DOCUMENT_MAIN_ENTRY.png";Report["status"]=connection=="Online"?"PASS":"FAIL";if(connection!="Online")Report["error"]="Main entry displayed a blocked worker; first captured notice retained.";
   finished=true;timer.Stop();Save();app.Shutdown();
  }catch(Exception e){Report["status"]="FAIL";Report["error"]=e.ToString();finished=true;timer.Stop();Save();if(Application.Current!=null)Application.Current.Shutdown();}
  finally{busy=false;}
 }
 static async Task<object> Script(IWebView2 view,string code){return Json.DeserializeObject(await view.CoreWebView2.ExecuteScriptAsync(code));}
 static async Task Submit(IWebView2 view,string command){await Script(view,"document.getElementById('command').value="+Json.Serialize(command)+";document.getElementById('command-form').requestSubmit();");}
 static Task<object> Field(IWebView2 view){return Script(view,"JSON.stringify(['phase','intensity'].map(id=>[...document.getElementById(id).getContext('2d').getImageData(0,0,64,64).data]))");}
 static async Task<bool> Exercise(IWebView2 view){
  const string marker="native_restart_verified_140",begin="qa_restart_begin",end="qa_restart_done";
  if(stage==0){
   if(mode=="seed")await Submit(view,"hpu bytes; write /tmp/native-process-restart.txt "+marker+"; echo "+end);
   else{
    var seed=(Dictionary<string,object>)Json.DeserializeObject(File.ReadAllText(seedFile));
    if(Convert.ToString(seed["status"])!="PASS"||Convert.ToString(seed["mode"])!="seed"||Convert.ToString(seed["root"])!=Convert.ToString(Report["root"])||Convert.ToString(seed["productionExeSha256"])!=Convert.ToString(Report["productionExeSha256"])||Convert.ToString(seed["runtimeManifestSha256"])!=Convert.ToString(Report["runtimeManifestSha256"]))throw new Exception("Seed proof is not bound to this exact root and runtime.");
    Report["seedProcessId"]=seed["nativeProcessId"];if(Convert.ToInt32(seed["nativeProcessId"])==Process.GetCurrentProcess().Id)throw new Exception("A distinct native process is required.");Report["expectedCommittedFieldPreview"]=seed["committedFieldPreview"];Report["seedEvidenceSha256"]=Sha(seedFile);
    await Submit(view,"echo "+begin+"; cat /tmp/native-process-restart.txt; echo "+end);
   }stage=1;return false;
  }
  if(stage==1){
   bool complete=Object.Equals(await Script(view,"(()=>{const lines=document.getElementById('transcript').textContent.split('\\n'),i=lines.findIndex(l=>l.trim()==="+Json.Serialize(end)+");return i>=0&&lines.slice(i+1).some(l=>l.includes('›'))&&document.getElementById('operation').textContent==='byte chip';})()"),true);
   if(!complete)return false;
   string field=Convert.ToString(await Field(view));
   if(mode=="verify"){
    string current=Convert.ToString(await Script(view,"(()=>{const lines=document.getElementById('transcript').textContent.split('\\n'),a=lines.findIndex(l=>l.trim()==="+Json.Serialize(begin)+"),b=lines.findIndex(l=>l.trim()==="+Json.Serialize(end)+");return a>=0&&b>a?lines.slice(a+1,b).join('\\n').trim():null;})()"));
    if(current!=marker)throw new Exception("Exact committed virtual file did not survive native process relaunch.");
    if(field!=Convert.ToString(Report["expectedCommittedFieldPreview"]))throw new Exception("Exact committed field previews did not survive native process relaunch.");
    Report.Remove("expectedCommittedFieldPreview");Report["exactCommittedFileRestored"]=true;Report["exactCommittedFieldPreviewRestored"]=true;Report["verifiedFieldPreview"]=field;Report["nativeProcessRelaunchVerified"]=true;Report["browserRuntimeProcessExitVerified"]=false;return true;
   }
   Report["committedFieldPreview"]=field;Report["virtualMarker"]=marker;
   await Script(view,"document.querySelector('[data-view=storage]').click();document.getElementById('sync').click();");stage=2;return false;
  }
  if(!Object.Equals(await Script(view,"document.getElementById('notice').textContent.includes('committed')"),true))return false;
  Report["indexedDbCommitAcknowledged"]=true;await Script(view,"document.querySelector('[data-view=console]').click();");return true;
 }

}
