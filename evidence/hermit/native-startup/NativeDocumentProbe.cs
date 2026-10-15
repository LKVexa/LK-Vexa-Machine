using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
public static class NativeDocumentProbe {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string path,IntPtr reserved,uint flags);
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=2*1024*1024};
 static readonly Dictionary<string,object> Report=new Dictionary<string,object>();static readonly List<string> Events=new List<string>();static string result,work;static Assembly production;
 static object Call(string type,string method,params object[] args){return production.GetType(type,true).GetMethod(method,BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,args);}
 static void Save(){File.WriteAllText(result,Json.Serialize(Report));}
 [STAThread] public static int Main(string[] args){
  if(args.Length!=1)return 2;string root=Path.GetFullPath(args[0]);work=Path.Combine(root,"workspace","native-document-diagnosis",DateTime.UtcNow.ToString("yyyyMMddTHHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8));Directory.CreateDirectory(work);result=Path.Combine(work,"NATIVE_DOCUMENT_RESULT.json");
  Report["status"]="RUNNING";Report["schema"]="JA21/NATIVE_DOCUMENT_DIAGNOSIS/1";Report["startedUtc"]=DateTime.UtcNow.ToString("o");Report["events"]=Events;Report["root"]=root;Report["work"]=work;Report["uacInvoked"]=false;Report["processorActionsClicked"]=false;Report["isolatedProfile"]=true;
  try{
   if(new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))throw new Exception("Non-elevated execution required");
   foreach(string key in new string[]{"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS","WEBVIEW2_USER_DATA_FOLDER","WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"})if(!String.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))throw new Exception("Unexpected WebView2 override: "+key);
   Environment.SetEnvironmentVariable("JA21_CONSOLE_MODE","1");Environment.SetEnvironmentVariable("JA21_REQUIRE_LIVE_WEB","1");Environment.SetEnvironmentVariable("JA21_NATIVE_ONLY","0");Environment.SetEnvironmentVariable("JA21_DISABLE_LIVE_WEB","0");Environment.SetEnvironmentVariable("JA21_ALLOW_PRIVATE_HOSTS","0");Environment.SetEnvironmentVariable("JA21_PORTABLE_ROOT",work);Environment.SetEnvironmentVariable("JA21_ALLOW_EXTERNAL_PORTABLE_ROOT","0");Environment.SetEnvironmentVariable("JA21_WEB_DATA_ROOT",Path.Combine(work,"state","webview2"));
   string sdk=Path.Combine(root,"runtime","webview2-sdk","1.0.4191.47");AppDomain.CurrentDomain.AssemblyResolve+=delegate(object sender,ResolveEventArgs e){string name=new AssemblyName(e.Name).Name;if(name!="Microsoft.Web.WebView2.Core"&&name!="Microsoft.Web.WebView2.Wpf")return null;return Assembly.LoadFrom(Path.Combine(sdk,name+".dll"));};if(LoadLibraryEx(Path.Combine(sdk,"WebView2Loader.dll"),IntPtr.Zero,0x1100)==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   production=Assembly.LoadFrom(Path.Combine(root,"tools","Test-Silicon-WebView2.exe"));Call("VBJA21.RuntimeSeal","Verify",root);Call("VBJA21.SiliconApp","ValidateMappedRoot",root);Call("VBJA21.PortableFabric","Configure",root);return Run(root);
  }catch(Exception e){Report["status"]="FAIL";Report["error"]=e.ToString();Report["hresult"]="0x"+e.HResult.ToString("X8");return 1;}
  finally{Report["finishedUtc"]=DateTime.UtcNow.ToString("o");Save();Console.WriteLine(result);}
 }
 static int Run(string root){
  var app=new Application{ShutdownMode=ShutdownMode.OnExplicitShutdown};System.Threading.SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));
  object surface=Call("VBJA21.LiveWebFactory","Create",root,950001,false);var type=surface.GetType();var element=(FrameworkElement)type.GetProperty("View").GetValue(surface,null);var view=(IWebView2)element;
  var window=new Window{Title="JA21 native startup error diagnosis — isolated state",Width=1200,Height=900,Content=element};var timeout=new DispatcherTimer{Interval=TimeSpan.FromSeconds(55)};int exit=1;
  timeout.Tick+=delegate{timeout.Stop();Report["status"]="TIMEOUT";Save();window.Close();app.Shutdown();};
  window.Loaded+=async delegate{
   try{
    await view.EnsureCoreWebView2Async(null);Report["controllerCreated"]=true;Report["runtime"]=view.CoreWebView2.Environment.BrowserVersionString;Report["viewType"]=element.GetType().FullName;
    foreach(string name in new string[]{"Runtime.exceptionThrown","Log.entryAdded"}){var receiver=view.CoreWebView2.GetDevToolsProtocolEventReceiver(name);receiver.DevToolsProtocolEventReceived+=delegate(object o,CoreWebView2DevToolsProtocolEventReceivedEventArgs e){if(Events.Count<100)Events.Add(name+": "+e.ParameterObjectAsJson);};}
    await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.enable","{}");await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Log.enable","{}");
    view.CoreWebView2.WebResourceResponseReceived+=delegate(object o,CoreWebView2WebResourceResponseReceivedEventArgs e){try{if(Events.Count<100)Events.Add("resource "+e.Response.StatusCode+" "+new Uri(e.Request.Uri).GetLeftPart(UriPartial.Path)+" "+e.Response.Headers.GetHeader("Content-Type"));}catch{}};
    view.CoreWebView2.PermissionRequested+=delegate(object o,CoreWebView2PermissionRequestedEventArgs e){if(Events.Count<100)Events.Add("permission "+e.PermissionKind+" "+e.State);};
    await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("(()=>{const log={events:[],notices:[],workerErrors:[],capabilities:{secureContext:isSecureContext,origin:location.origin,indexedDB:!!indexedDB,locks:!!navigator.locks,Worker:typeof Worker,gpu:!!navigator.gpu}};Object.defineProperty(window,'__JA21_NATIVE_DIAGNOSTIC',{value:log});const push=(list,value)=>{if(list.length<100)list.push({at:Date.now(),value:String(value).slice(0,3000)});};addEventListener('error',e=>push(log.events,'error: '+e.message+' '+e.filename+':'+e.lineno));addEventListener('unhandledrejection',e=>push(log.events,'rejection: '+String(e.reason?.stack||e.reason)));const BaseWorker=Worker;class ObservedWorker extends BaseWorker{constructor(...args){super(...args);this.addEventListener('error',e=>push(log.workerErrors,'worker error: '+e.message+' '+e.filename+':'+e.lineno));this.addEventListener('messageerror',()=>push(log.workerErrors,'worker message decode error'));this.addEventListener('message',e=>{const m=e.data;if(m?.type==='error'||m?.error)push(log.workerErrors,JSON.stringify({type:m.type,message:m.message,error:m.error}));});}}Object.defineProperty(window,'Worker',{value:ObservedWorker,writable:true,configurable:true});document.addEventListener('DOMContentLoaded',()=>{const n=document.getElementById('notice');if(n){push(log.notices,n.textContent);new MutationObserver(()=>push(log.notices,n.textContent)).observe(n,{subtree:true,childList:true,characterData:true});}});})();");
    type.GetMethod("Navigate").Invoke(surface,new object[]{"https://ja21-silicon.invalid/"});
    await Task.Delay(16000);
    string dom=await view.CoreWebView2.ExecuteScriptAsync("(()=>({diagnostic:window.__JA21_NATIVE_DIAGNOSTIC,readyState:document.readyState,url:location.href,title:document.title,connection:document.getElementById('connection')?.textContent,notice:document.getElementById('notice')?.textContent,transcript:document.getElementById('transcript')?.textContent}))()");Report["dom"]=Json.DeserializeObject(dom);
    string screenshot=Path.Combine(work,"native-startup.png");using(var stream=File.Create(screenshot)){await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,stream);}Report["screenshot"]=screenshot;
    Report["status"]="CAPTURED_DIAGNOSTIC";exit=0;
   }catch(Exception e){Report["status"]="FAIL";Report["error"]=e.ToString();Report["hresult"]="0x"+e.HResult.ToString("X8");}
   finally{timeout.Stop();Save();((IDisposable)surface).Dispose();window.Close();app.Shutdown();}
  };timeout.Start();window.Show();app.Run();return exit;
 }
}
