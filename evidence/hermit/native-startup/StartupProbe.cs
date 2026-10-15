using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

public static class StartupProbe {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string path,IntPtr reserved,uint flags);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr handle);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=1024*1024};
 static readonly Dictionary<string,object> Report=new Dictionary<string,object>();
 static string result;
 [STAThread] public static int Main(string[] args) {
  if(args.Length!=2||!(args[0]=="raw"||args[0]=="windowed"||args[0]=="composition")||!(args[1]=="ambient"||args[1]=="relocated"))return 2;
  string root=AppDomain.CurrentDomain.BaseDirectory;
  string work=Path.Combine(root,args[0]+"-"+args[1]+"-"+DateTime.UtcNow.ToString("yyyyMMddTHHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8));
  Directory.CreateDirectory(work);result=Path.Combine(work,"RESULT.json");
  Report["schema"]="JA21/NATIVE_WEBVIEW2_STARTUP_PROBE/1";Report["mode"]=args[0];Report["environment"]=args[1];Report["status"]="RUNNING";Report["startedUtc"]=DateTime.UtcNow.ToString("o");Report["work"]=work;
  Report["elevated"]=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
  Report["securityFlagsChanged"]=false;Report["mappedApplicationRun"]=false;Report["networkNavigation"]=false;
  try {
   if((bool)Report["elevated"])throw new Exception("Probe requires non-elevated execution");
   var overrides=new Dictionary<string,bool>();foreach(string key in new string[]{"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS","WEBVIEW2_USER_DATA_FOLDER","WEBVIEW2_BROWSER_EXECUTABLE_FOLDER","WEBVIEW2_RELEASE_CHANNELS","WEBVIEW2_CHANNEL_SEARCH_KIND"})overrides[key]=!String.IsNullOrEmpty(Environment.GetEnvironmentVariable(key));Report["overridePresence"]=overrides;
   foreach(var pair in overrides)if(pair.Value)throw new Exception("Unexpected WebView2 environment override; not changing it: "+pair.Key);
   string temp=Path.Combine(work,"temp");Directory.CreateDirectory(temp);Environment.SetEnvironmentVariable("TEMP",temp);Environment.SetEnvironmentVariable("TMP",temp);
   if(args[1]=="relocated")foreach(string key in new string[]{"APPDATA","LOCALAPPDATA"}){string path=Path.Combine(work,key);Directory.CreateDirectory(path);Environment.SetEnvironmentVariable(key,path);}
   Report["localAppData"]=Environment.GetEnvironmentVariable("LOCALAPPDATA");Report["appData"]=Environment.GetEnvironmentVariable("APPDATA");
   string sdk=Path.Combine(root,"sdk");AppDomain.CurrentDomain.AssemblyResolve+=delegate(object sender,ResolveEventArgs e){string name=new AssemblyName(e.Name).Name;if(name!="Microsoft.Web.WebView2.Core"&&name!="Microsoft.Web.WebView2.Wpf")return null;return Assembly.LoadFrom(Path.Combine(sdk,name+".dll"));};
   if(LoadLibraryEx(Path.Combine(sdk,"WebView2Loader.dll"),IntPtr.Zero,0x1100)==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   return Run(work,args[0]);
  }catch(Exception e){Failure(e);return 1;}
  finally{Report["finishedUtc"]=DateTime.UtcNow.ToString("o");Save();Console.WriteLine(result);}
 }
 static void Save(){File.WriteAllText(result,Json.Serialize(Report));}
 static void Failure(Exception e){Report["status"]="FAIL";Report["exceptionType"]=e.GetType().FullName;Report["hresult"]="0x"+e.HResult.ToString("X8");Report["error"]=e.ToString();if(e.InnerException!=null)Report["innerHresult"]="0x"+e.InnerException.HResult.ToString("X8");Save();}
 static int Run(string work,string mode) {
  int exit=1;var app=new Application {ShutdownMode=ShutdownMode.OnExplicitShutdown};
  SynchronizationContextSetup();
  var window=new Window {Title="JA21 WebView2 diagnostic - non-elevated",Width=800,Height=560,Content=new TextBlock {Text="Bounded WebView2 startup diagnosis. No administrator session or network navigation."}};
  var timer=new DispatcherTimer {Interval=TimeSpan.FromSeconds(25)};
  timer.Tick+=delegate {timer.Stop();Report["stageTimeout"]=Report.ContainsKey("stage")?Report["stage"]:null;Report["status"]="TIMEOUT";Save();window.Close();app.Shutdown();};
  window.Loaded+=async delegate {
   IDisposable control=null;
   try {
    var handle=new WindowInteropHelper(window).Handle;Report["parentHandle"]=handle.ToInt64();Report["parentIsWindow"]=IsWindow(handle);Report["windowVisible"]=window.IsVisible;Report["uiThreadId"]=GetCurrentThreadId();Report["apartment"]=System.Threading.Thread.CurrentThread.GetApartmentState().ToString();
    string profile=Path.Combine(work,"profile");Directory.CreateDirectory(profile);File.WriteAllText(Path.Combine(profile,"write-probe.txt"),"owned directory write check");Report["profileWrite"]=true;
    Report["stage"]="environment-create";Save();var env=await CoreWebView2Environment.CreateAsync(null,profile,new CoreWebView2EnvironmentOptions());Report["runtimeVersion"]=env.BrowserVersionString;Report["environmentCreated"]=true;
    Report["stage"]="controller-create";Save();
    if(mode=="raw"){
     var controller=await env.CreateCoreWebView2ControllerAsync(handle);Report["controllerCreated"]=true;Report["controllerBrowserPid"]=controller.CoreWebView2.BrowserProcessId;controller.Close();
    }else if(mode=="windowed"){
     var view=new WebView2();control=view;window.Content=view;window.UpdateLayout();await view.EnsureCoreWebView2Async(env);Report["controllerCreated"]=view.CoreWebView2!=null;Report["controlLoaded"]=view.IsLoaded;
    }else{
     var view=new WebView2CompositionControl();control=view;window.Content=view;window.UpdateLayout();await view.EnsureCoreWebView2Async(env);Report["controllerCreated"]=view.CoreWebView2!=null;Report["controlLoaded"]=view.IsLoaded;
    }
    Report["status"]="PASS";exit=0;
   }catch(Exception e){Failure(e);}
   finally{timer.Stop();if(control!=null)control.Dispose();window.Close();app.Shutdown();}
  };
  timer.Start();window.Show();app.Run();return exit;
 }
 static void SynchronizationContextSetup(){System.Threading.SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));}
}
