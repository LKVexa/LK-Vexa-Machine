// Optional live QA: exact production bridge + mapped CPU in an isolated WPF window.
// No Node, Playwright, remote debugging, existing browser profile, or sandbox switches.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace VBJA21
{
    public static class SiliconWebView2Acceptance
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 33554432 };
        private static int sequence;
        private static string token;
        private static bool windowClosed;

        [STAThread]
        public static int Main(string[] args)
        {
            string root = System.IO.Path.GetFullPath(System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            // A fixed short, isolated QA root prevents package path length from
            // obscuring the real production bridge's persistence checks.
            string qaRoot = @"D:\Codex\hermit-native-validation\qa";
            string work = System.IO.Path.Combine(qaRoot, Guid.NewGuid().ToString("N").Substring(0, 12));
            string result = System.IO.Path.Combine(work, "silicon-webview2-acceptance.json");
            Dictionary<string, object> initial = new Dictionary<string, object> {
                { "schema", "JA21/SILICON_WEBVIEW2_ACCEPTANCE/1" }, { "status", "RUNNING" },
                { "fixture", false }, { "software_cpu_version", "2.4.0" },
                { "started_utc", DateTime.UtcNow.ToString("o") }, { "browser_validation_passed", false },
                { "live_browser_created", false }, { "qa_window_shown", false },
                { "test_workspace", work }, { "test_workspace_external", true }, { "checks", new object[0] }
            };
            Dictionary<string, string> previous = new Dictionary<string, string>();
            string[] variables = { "JA21_CONSOLE_MODE", "JA21_REQUIRE_LIVE_WEB", "JA21_START_URL", "JA21_CONSOLE_ORIGINS", "JA21_NATIVE_ONLY", "JA21_DISABLE_LIVE_WEB", "JA21_ALLOW_PRIVATE_HOSTS", "JA21_PORTABLE_ROOT", "JA21_ALLOW_EXTERNAL_PORTABLE_ROOT", "JA21_WEB_DATA_ROOT", "JA21_VEC1_STATE_ROOT", "JA21_DOWNLOADS_ROOT", "JA21_TEMP_ROOT", "JA21_WEBVIEW2_FIXED_ROOT", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "WEBVIEW2_USER_DATA_FOLDER", "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER" };
            try
            {
                if (args.Length > 1 || (args.Length == 1 && args[0] != "--preflight")) throw new Exception("Usage: Test-Silicon-WebView2.exe [--preflight]");
                RuntimeSeal.RejectReparsePoints(System.IO.Path.GetPathRoot(qaRoot), work);
                PortablePaths.RequireConsoleProfilePath(System.IO.Path.Combine(work, "state", "webview2", "profile"));
                Directory.CreateDirectory(work);
                File.WriteAllText(result, Json.Serialize(initial));
                AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs error) {
                    try { initial["status"] = "BLOCKED_ENVIRONMENT"; initial["error"] = Convert.ToString(error.ExceptionObject); initial["finished_utc"] = DateTime.UtcNow.ToString("o"); File.WriteAllText(result, Json.Serialize(initial)); } catch { }
                };
                foreach (string name in variables) previous[name] = Environment.GetEnvironmentVariable(name);
                Environment.SetEnvironmentVariable("JA21_CONSOLE_MODE", "1");
                Environment.SetEnvironmentVariable("JA21_REQUIRE_LIVE_WEB", "1");
                Environment.SetEnvironmentVariable("JA21_START_URL", SiliconApp.Origin);
                Environment.SetEnvironmentVariable("JA21_CONSOLE_ORIGINS", "");
                Environment.SetEnvironmentVariable("JA21_NATIVE_ONLY", "0");
                Environment.SetEnvironmentVariable("JA21_DISABLE_LIVE_WEB", "0");
                Environment.SetEnvironmentVariable("JA21_ALLOW_PRIVATE_HOSTS", "0");
                Environment.SetEnvironmentVariable("JA21_PORTABLE_ROOT", work);
                // Only this separate acceptance executable opts its fresh test
                // volume into the existing explicit external-workspace policy.
                Environment.SetEnvironmentVariable("JA21_ALLOW_EXTERNAL_PORTABLE_ROOT", "1");
                Environment.SetEnvironmentVariable("JA21_WEB_DATA_ROOT", System.IO.Path.Combine(work, "state", "webview2"));
                Environment.SetEnvironmentVariable("JA21_VEC1_STATE_ROOT", System.IO.Path.Combine(work, "state", "vec1"));
                Environment.SetEnvironmentVariable("JA21_DOWNLOADS_ROOT", System.IO.Path.Combine(work, "downloads"));
                Environment.SetEnvironmentVariable("JA21_TEMP_ROOT", System.IO.Path.Combine(work, "temp"));
                foreach (string name in new string[] { "JA21_WEBVIEW2_FIXED_ROOT", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "WEBVIEW2_USER_DATA_FOLDER", "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER" }) Environment.SetEnvironmentVariable(name, null);
                RuntimeSeal.Verify(root);
                SiliconApp.ValidateMappedRoot(root);
                SiliconConsoleEntry.LoadVerifiedAdapter(root);
                if (args.Length == 1)
                {
                    initial["status"] = "PREFLIGHT_PASS";
                    initial["scope"] = "Runtime integrity, mapping and pinned SDK load only; CPU/browser not executed";
                    initial["finished_utc"] = DateTime.UtcNow.ToString("o");
                    File.WriteAllText(result, Json.Serialize(initial));
                    Console.WriteLine("PREFLIGHT PASS: no browser or CPU was started.");
                    Console.WriteLine("Result: " + result); return 0;
                }
                string completed = Run(root, work);
                File.WriteAllText(result, completed);
                Dictionary<string, object> report = (Dictionary<string, object>)Json.DeserializeObject(completed);
                Console.WriteLine("RESULT: " + Convert.ToString(report["status"]));
                Console.WriteLine("Result: " + result);
                return Convert.ToString(report["status"]) == "PASS" ? 0 : 1;
            }
            catch (Exception error)
            {
                initial["status"] = "PRECHECK_FAILED"; initial["error"] = error.ToString(); initial["finished_utc"] = DateTime.UtcNow.ToString("o");
                try { if (Directory.Exists(work)) File.WriteAllText(result, Json.Serialize(initial)); } catch { }
                Console.Error.WriteLine(error.ToString()); Console.WriteLine("Result: " + result); return 1;
            }
            finally { foreach (KeyValuePair<string, string> entry in previous) Environment.SetEnvironmentVariable(entry.Key, entry.Value); }
        }

        private static void PumpUntil(Func<bool> done, int timeout, string label)
        {
            Stopwatch clock = Stopwatch.StartNew();
            while (!done())
            {
                if (windowClosed) throw new Exception("Acceptance window was closed before completion.");
                if (clock.ElapsedMilliseconds > timeout) throw new TimeoutException(label + " timed out after " + timeout + " ms.");
                DispatcherFrame frame = new DispatcherFrame();
                DispatcherTimer timer = new DispatcherTimer(DispatcherPriority.Background);
                timer.Interval = TimeSpan.FromMilliseconds(25);
                timer.Tick += delegate { timer.Stop(); frame.Continue = false; };
                timer.Start();
                Dispatcher.PushFrame(frame);
            }
        }

        private static object Script(IWebView2 view, string source)
        {
            Task<string> task = view.CoreWebView2.ExecuteScriptAsync(source);
            PumpUntil(delegate { return task.IsCompleted; }, 15000, "WebView2 script evaluation");
            return Json.DeserializeObject(task.GetAwaiter().GetResult());
        }

        private static void WaitScript(IWebView2 view, string expression, string label)
        {
            PumpUntil(delegate { return Object.Equals(Script(view, "Boolean(" + expression + ")"), true); }, 30000, label);
        }

        private static string Text(IWebView2 view, string id)
        {
            return Convert.ToString(Script(view, "document.getElementById(" + Json.Serialize(id) + ").textContent"));
        }

        private static void Online(IWebView2 view)
        {
            WaitScript(view, "document.getElementById('connection') && document.getElementById('connection').textContent === 'Online' && document.getElementById('transcript').textContent.includes('›')", "Real CPU worker boot and terminal prompt");
        }

        private static string Command(IWebView2 view, string line)
        {
            sequence++;
            string begin = token + "_begin_" + sequence, end = token + "_done_" + sequence;
            string command = "echo " + begin + "; " + line + "; printf '\\n'; echo " + end;
            Script(view, "document.getElementById('command').value=" + Json.Serialize(command) + ";document.getElementById('command-form').requestSubmit();");
            WaitCommandEnd(view, end);
            string[] lines = Text(view, "transcript").Split('\n');
            int first = -1, last = -1;
            for (int i = 0; i < lines.Length; i++) { if (lines[i].Trim() == begin) first = i; if (lines[i].Trim() == end) last = i; }
            if (first < 0 || last <= first) throw new Exception("Current-screen command output markers are absent.");
            return String.Join("\n", lines, first + 1, last - first - 1).Trim();
        }

        // Long reports can scroll their begin marker off the accessible current
        // screen. Use this only when output is independently checked elsewhere.
        private static void CommandCompleted(IWebView2 view, string line)
        {
            string end = token + "_done_" + (++sequence).ToString();
            string command = line + "; printf '\\n'; echo " + end;
            Script(view, "document.getElementById('command').value=" + Json.Serialize(command) + ";document.getElementById('command-form').requestSubmit();");
            WaitCommandEnd(view, end);
        }

        private static void WaitCommandEnd(IWebView2 view, string end)
        {
            WaitScript(view, "(()=>{const lines=document.getElementById('transcript').textContent.split('\\n');const end=lines.findIndex(l=>l.trim()===" + Json.Serialize(end) + ");return end>=0&&lines.slice(end+1).some(l=>l.includes('›'));})()", "Terminal command completion");
        }

        private static void Screenshot(IWebView2 view, string path)
        {
            using (FileStream image = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                Task capture = view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
                PumpUntil(delegate { return capture.IsCompleted; }, 15000, "WebView2 screenshot"); capture.GetAwaiter().GetResult();
            }
        }

        private static void CaptureFailure(ILiveWebSurface first, string work, Dictionary<string, object> report)
        {
            Dictionary<string, object> evidence = new Dictionary<string, object> { { "captured_utc", DateTime.UtcNow.ToString("o") } };
            report["failure_evidence"] = evidence;
            IWebView2 view;
            try
            {
                view = first == null ? null : first.View as IWebView2;
                if (view == null || view.CoreWebView2 == null) { evidence["status"] = "NO_DOCUMENT"; return; }
            }
            catch (Exception error) { evidence["document_error"] = error.Message; return; }
            try
            {
                object snapshot = Script(view, "(()=>{const d=document.documentElement;const html=d?d.outerHTML:'';const text=id=>document.getElementById(id)?.textContent??null;return {href:location.href,readyState:document.readyState,connection:text('connection'),notice:text('notice'),operation:text('operation'),transcript:text('transcript'),dom:html.slice(0,262144),domTruncated:html.length>262144};})()");
                string path = System.IO.Path.Combine(work, "silicon-webview2-first-fault.json");
                using (StreamWriter file = new StreamWriter(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))) file.Write(Json.Serialize(snapshot));
                evidence["document"] = path;
            }
            catch (Exception error) { evidence["document_error"] = error.Message; }
            try
            {
                string path = System.IO.Path.Combine(work, "silicon-webview2-first-fault.png");
                Screenshot(view, path); evidence["screenshot"] = path;
            }
            catch (Exception error) { evidence["screenshot_error"] = error.Message; }
        }

        private static string Preview(IWebView2 view)
        {
            return Convert.ToString(Script(view, "JSON.stringify(['phase','intensity'].map(id=>[...document.getElementById(id).getContext('2d').getImageData(0,0,64,64).data]))"));
        }

        private static void Restore(IWebView2 view, string backup)
        {
            Script(view, "(()=>{window.prompt=()=> 'RESTORE';document.getElementById('notice').textContent='';const dt=new DataTransfer();dt.items.add(new File([" + Json.Serialize(backup) + "],'acceptance.json',{type:'application/json'}));const input=document.getElementById('restore-file');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
        }

        private static void Passed(List<object> checks, string name)
        {
            checks.Add(new Dictionary<string, object> { { "name", name }, { "status", "PASS" } });
            Console.WriteLine("PASS: " + name);
        }

        public static string Run(string root, string work)
        {
            List<object> checks = new List<object>();
            List<string> bridgeFailures = new List<string>();
            Dictionary<string, object> report = new Dictionary<string, object> {
                { "schema", "JA21/SILICON_WEBVIEW2_ACCEPTANCE/1" }, { "status", "RUNNING" },
                { "scope", "Real production WebView2 surface, mapped software CPU, worker, IndexedDB, Web Locks and backup restore; no ARM ISA or host OS simulation claim" },
                { "software_cpu_version", "2.4.0" }, { "fixture", false },
                { "started_utc", DateTime.UtcNow.ToString("o") }, { "checks", checks },
                { "live_browser_created", false }, { "cpu_online_observed", false },
                { "browser_validation_passed", false }, { "program_run_called", false },
                { "qa_window_shown", false }, { "sandbox_disabled", false },
                { "test_workspace", work }, { "test_workspace_external", true }, { "bridge_failures", bridgeFailures }
            };
            Window window = null;
            ILiveWebSurface first = null, second = null;
            System.Threading.SynchronizationContext previousContext = System.Threading.SynchronizationContext.Current;
            bool cpuOnline = false;
            token = "qa_" + Guid.NewGuid().ToString("N").Substring(0, 10);
            sequence = 0; windowClosed = false;
            try
            {
                RuntimeSeal.Verify(root);
                SiliconApp.ValidateMappedRoot(root);
                PortableFabric.Configure(root);
                Passed(checks, "Production runtime seal and mapped software CPU closure");
                Check(LiveWebFactory.IsAvailable(root), "Configured WebView2 Runtime is unavailable; live CPU acceptance cannot use native fallback.");
                report["webview2_version"] = LiveWebFactory.RuntimeVersion(root);
                if (Application.Current == null) { new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown }; }
                System.Threading.SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));
                Grid panel = new Grid();
                panel.ColumnDefinitions.Add(new ColumnDefinition()); panel.ColumnDefinitions.Add(new ColumnDefinition());
                Rect workArea = SystemParameters.WorkArea;
                window = new Window { Title = "JA21 software CPU acceptance — isolated test state", Width = Math.Min(1560, workArea.Width), Height = Math.Min(900, workArea.Height), WindowStartupLocation = WindowStartupLocation.CenterScreen, Content = panel };
                window.Closed += delegate { windowClosed = true; };
                first = LiveWebFactory.Create(root, 910001, false);
                first.NavigationFailed += delegate(string message) { bridgeFailures.Add(message); };
                IWebView2 view = (IWebView2)first.View;
                Grid.SetColumnSpan((UIElement)view, 2); panel.Children.Add((UIElement)view);
                window.Show(); report["qa_window_shown"] = true; report["live_browser_created"] = true;
                first.Navigate(SiliconApp.Origin);
                PumpUntil(delegate { return first.Ready && view.CoreWebView2 != null; }, 30000, "Production bridge initialization and mapping");
                Online(view); cpuOnline = true; report["cpu_online_observed"] = true;
                Check(Text(view, "version") == "2.4.0", "Wrong mapped CPU version.");
                Check(Object.Equals(Script(view, "window.isSecureContext && !!navigator.locks && !!window.indexedDB && typeof Worker==='function' && location.origin==='https://ja21-silicon.invalid'"), true), "Secure virtual origin or required browser APIs are unavailable.");
                Passed(checks, "Secure mapped origin boots the real module worker and MessageChannel terminal");
                string originalSource = first.Source;
                bool externalRejected = false;
                try { first.Navigate("https://example.com/"); } catch { externalRejected = true; }
                Check(externalRejected && first.Source == originalSource, "Production application surface allowed a cross-origin navigation.");
                Passed(checks, "Production bridge refuses cross-origin navigation without replacing the CPU surface");
                CommandCompleted(view, "hpu bytes");
                WaitScript(view, "document.getElementById('operation').textContent.includes('byte chip')", "Software byte lanes");
                string expectedPreview = Preview(view);
                Command(view, "write /tmp/webview-acceptance.txt committed_webview_value");
                Script(view, "document.querySelector('[data-view=storage]').click();document.getElementById('sync').click();");
                WaitScript(view, "document.getElementById('notice').textContent.includes('committed')", "IndexedDB commit");
                // Capture the actual UI export's Blob; suppress only the synthetic test's
                // anchor download, so host downloads/user folders are never required.
                Script(view, "window.__qaBackup=null;window.__qaBackupError=null;const originalUrl=URL.createObjectURL;URL.createObjectURL=function(blob){blob.text().then(t=>window.__qaBackup=t).catch(e=>window.__qaBackupError=String(e));return originalUrl.call(URL,blob);};const originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.href.startsWith('blob:'))return;return originalClick.call(this);};document.getElementById('backup').click();");
                WaitScript(view, "typeof window.__qaBackup==='string' && window.__qaBackup.length>0", "Production validated backup export");
                string backup = Convert.ToString(Script(view, "window.__qaBackup"));
                Dictionary<string, object> record = (Dictionary<string, object>)Json.DeserializeObject(backup);
                Check(Convert.ToInt32(record["v"]) == 2 && Convert.ToString(record["version"]) == "2.4.0" && Convert.ToInt64(record["revision"]) > 0, "Exported backup metadata is invalid.");
                RuntimeSeal.RequireSha256(Convert.ToString(record["sha256"]), "backup checksum");
                Passed(checks, "Software byte lanes, real IndexedDB commit and production backup export");
                string navigationToken = Guid.NewGuid().ToString("N");
                Script(view, "window.__qaOldNavigation=" + Json.Serialize(navigationToken));
                first.Reload();
                WaitScript(view, "window.__qaOldNavigation!==" + Json.Serialize(navigationToken) + "&&document.getElementById('connection')&&document.getElementById('connection').textContent==='Online'", "New document after reload");
                Online(view);
                Check(Command(view, "cat /tmp/webview-acceptance.txt") == "committed_webview_value", "Committed VFS file did not survive reload.");
                WaitScript(view, "document.getElementById('operation').textContent.includes('byte chip')", "Restored CPU byte lane state");
                Check(Preview(view) == expectedPreview, "CPU field previews changed across reload.");
                Passed(checks, "Reload restores exact committed file content and CPU field previews");
                Grid.SetColumnSpan((UIElement)view, 1);
                second = LiveWebFactory.Create(root, 910002, false);
                second.NavigationFailed += delegate(string message) { bridgeFailures.Add("second: " + message); };
                IWebView2 other = (IWebView2)second.View;
                Grid.SetColumn((UIElement)other, 1); panel.Children.Add((UIElement)other); second.Navigate(SiliconApp.Origin);
                PumpUntil(delegate { return second.Ready && other.CoreWebView2 != null; }, 30000, "Second production bridge");
                WaitScript(other, "document.getElementById('connection') && document.getElementById('connection').textContent==='Blocked'", "Real single-writer Web Lock");
                Check(Text(other, "notice") == "another window owns this volume; close it and retry", "Second surface did not report the precise active-volume lock refusal.");
                Check(Object.Equals(Script(other, "(()=>{const panes=[...document.querySelectorAll('#terminal-container .terminal-pane[data-kind=xpu]')];return panes.length===2 && panes.every(p=>!['connecting','connected'].includes(p.dataset.session) && p.querySelector('input')?.disabled===false && p.querySelector('button[type=submit]')?.disabled===true && p.querySelector('.pane-interrupt')?.disabled===true) && document.getElementById('tabs').children.length===0 && document.getElementById('command').disabled && document.getElementById('add-tab').disabled && document.getElementById('reboot').disabled && document.getElementById('transcript').textContent.trim()==='';})()"), true), "Blocked second surface connected an XPU session or enabled XPU command controls.");
                panel.Children.Remove((UIElement)other); second.Dispose(); second = null; Grid.SetColumnSpan((UIElement)view, 2);
                Passed(checks, "Second production WebView2 surface cannot acquire the active writer lock");
                Command(view, "write /tmp/webview-acceptance.txt changed_after_backup");
                Script(view, "document.querySelector('[data-view=storage]').click();");
                Restore(view, "{\"v\":2,\"snap\":{}}");
                WaitScript(view, "document.getElementById('notice').textContent==='volume checksum mismatch'", "Malformed restore checksum rejection");
                Check(Command(view, "cat /tmp/webview-acceptance.txt") == "changed_after_backup", "Malformed restore changed the running volume.");
                Passed(checks, "Malformed backup restore preserves the running virtual volume");
                Restore(view, backup);
                WaitScript(view, "document.getElementById('notice').textContent==='Backup validated and restored. Previous committed volume retained.'", "Validated backup restore");
                Online(view);
                Check(Command(view, "cat /tmp/webview-acceptance.txt") == "committed_webview_value", "Validated restore did not recover the exact backup file content.");
                WaitScript(view, "document.getElementById('operation').textContent.includes('byte chip')", "Restored CPU state after backup restore");
                Check(Preview(view) == expectedPreview, "Validated restore changed the backed-up CPU field previews.");
                Passed(checks, "Validated production restore restarts the real worker and recovers exact file and CPU state");
                Screenshot(view, System.IO.Path.Combine(work, "silicon-webview2.png"));
                report["status"] = "PASS"; report["browser_validation_passed"] = true;
            }
            catch (Exception error)
            {
                report["status"] = cpuOnline ? "FAIL" : "BLOCKED_ENVIRONMENT";
                report["error"] = error.ToString(); Console.WriteLine(error.ToString());
                report["failure_surface"] = second != null ? "second" : "first";
                CaptureFailure(second ?? first, work, report);
            }
            finally
            {
                try { if (second != null) second.Dispose(); } catch { }
                try { if (first != null) first.Dispose(); } catch { }
                try { if (window != null) window.Close(); } catch { }
                System.Threading.SynchronizationContext.SetSynchronizationContext(previousContext);
                report["finished_utc"] = DateTime.UtcNow.ToString("o");
            }
            return Json.Serialize(report);
        }
    }
}
