// JA21 9.8.7 live-web composition bridge. This is selected only when the Microsoft WebView2 SDK
// adapter has been provisioned. The browser shell, VEC1 lifecycle, policy and evidence
// remain JA21/VEC1; Edge WebView2 is used only as the modern document/media engine.
using System;
using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace VBJA21
{
    // The console has no WPF trust/rail overlays, so a regular WebView2 is appropriate there.
    // Generic browsing retains the composition control required for its overlay chrome.
    internal sealed class LiveWebView : IDisposable
    {
        private readonly WebView2 windowed;
        private readonly WebView2CompositionControl composition;
        public FrameworkElement Element { get; private set; }
        public LiveWebView(bool console) { if (console) { windowed = new WebView2(); Element = windowed; } else { composition = new WebView2CompositionControl(); Element = composition; } }
        public HorizontalAlignment HorizontalAlignment { set { Element.HorizontalAlignment = value; } }
        public VerticalAlignment VerticalAlignment { set { Element.VerticalAlignment = value; } }
        public System.Windows.Threading.Dispatcher Dispatcher { get { return Element.Dispatcher; } }
        public CoreWebView2 CoreWebView2 { get { return windowed != null ? windowed.CoreWebView2 : composition.CoreWebView2; } }
        public CoreWebView2CreationProperties CreationProperties { set { if (windowed != null) windowed.CreationProperties = value; else composition.CreationProperties = value; } }
        public Uri Source { get { return windowed != null ? windowed.Source : composition.Source; } set { if (windowed != null) windowed.Source = value; else composition.Source = value; } }
        public event EventHandler<CoreWebView2InitializationCompletedEventArgs> CoreWebView2InitializationCompleted { add { if (windowed != null) windowed.CoreWebView2InitializationCompleted += value; else composition.CoreWebView2InitializationCompleted += value; } remove { if (windowed != null) windowed.CoreWebView2InitializationCompleted -= value; else composition.CoreWebView2InitializationCompleted -= value; } }
        public event EventHandler<CoreWebView2NavigationStartingEventArgs> NavigationStarting { add { if (windowed != null) windowed.NavigationStarting += value; else composition.NavigationStarting += value; } remove { if (windowed != null) windowed.NavigationStarting -= value; else composition.NavigationStarting -= value; } }
        public event EventHandler<CoreWebView2NavigationCompletedEventArgs> NavigationCompleted { add { if (windowed != null) windowed.NavigationCompleted += value; else composition.NavigationCompleted += value; } remove { if (windowed != null) windowed.NavigationCompleted -= value; else composition.NavigationCompleted -= value; } }
        public void GoBack() { if (windowed != null) windowed.GoBack(); else composition.GoBack(); }
        public void GoForward() { if (windowed != null) windowed.GoForward(); else composition.GoForward(); }
        public void Reload() { if (windowed != null) windowed.Reload(); else composition.Reload(); }
        public void Dispose() { if (windowed != null) windowed.Dispose(); else composition.Dispose(); }
    }
    internal static class LiveWebFactory
    {
        public static bool IsAvailable(string root)
        {
            string sdk = PortablePaths.WebView2SdkRoot(root);
            if(!Directory.Exists(sdk) || String.Equals(Environment.GetEnvironmentVariable("JA21_NATIVE_ONLY"), "1", StringComparison.Ordinal)) return false;
            try { RuntimeVersion(root); return true; } catch { return false; }
        }

        public static string AdapterStatus(string root)
        {
            if (!IsAvailable(root)) return "native-only";
            try { return "WebView2 " + RuntimeVersion(root); }
            catch { return "WebView2 runtime unavailable"; }
        }

        public static ILiveWebSurface Create(string root, int tabId, bool isPrivate)
        {
            return new WebView2LiveWebSurface(root, tabId, isPrivate);
        }

        internal static string RuntimeVersion(string root)
        {
            string fixedRuntime = PortablePaths.FixedWebView2Root(root);
            return CoreWebView2Environment.GetAvailableBrowserVersionString(String.IsNullOrWhiteSpace(fixedRuntime) ? null : fixedRuntime);
        }
    }

    internal sealed class WebView2LiveWebSurface : ILiveWebSurface
    {
        private readonly LiveWebView _view;
        private readonly string _root;
        private readonly string _dataDir;
        private readonly bool _private;
        private bool _ready;
        private bool _disposed;
        private bool _navigationStartedSecure;
        private ulong _navigationId;
        private bool _boundaryUnavailable;
        private bool _siliconAppActive;
        private readonly string _siliconRoot;
        private HostAdminBridge _adminBridge;

        public event Action<string, string> NavigationCommitted;
        public event Action<string> NavigationFailed;
        public event Action<string> StatusChanged;
        public event Action<bool> FullScreenChanged;

        public WebView2LiveWebSurface(string root, int tabId, bool isPrivate)
        {
            _root = root;
            _private = isPrivate;
            if (SiliconApp.ConsoleMode) _siliconRoot = SiliconApp.ValidateMappedRoot(root);
            string state = Environment.GetEnvironmentVariable("JA21_WEB_DATA_ROOT");
            if(String.IsNullOrWhiteSpace(state)) state = PortablePaths.LiveWebState(root);
            state = System.IO.Path.GetFullPath(state);
            RuntimeSeal.RejectReparsePoints(PortablePaths.Workspace(root), state);
            _dataDir = isPrivate
                ? System.IO.Path.Combine(state, "private", "tab-" + tabId.ToString() + "-" + Guid.NewGuid().ToString("N"))
                : System.IO.Path.Combine(state, "profile");
            if (SiliconApp.ConsoleMode) PortablePaths.RequireConsoleProfilePath(_dataDir);
            RuntimeSeal.RejectReparsePoints(PortablePaths.Workspace(root), _dataDir);
            Directory.CreateDirectory(state);
            Directory.CreateDirectory(_dataDir);

            _view = new LiveWebView(SiliconApp.ConsoleMode);
            _view.HorizontalAlignment = HorizontalAlignment.Stretch;
            _view.VerticalAlignment = VerticalAlignment.Stretch;
            CoreWebView2CreationProperties creation = new CoreWebView2CreationProperties { UserDataFolder = _dataDir, IsInPrivateModeEnabled = isPrivate, AreBrowserExtensionsEnabled = false };
            string fixedRuntime = PortablePaths.FixedWebView2Root(root);
            if(!String.IsNullOrWhiteSpace(fixedRuntime)) { var bp = creation.GetType().GetProperty("BrowserExecutableFolder"); if(bp != null && bp.CanWrite) bp.SetValue(creation, fixedRuntime, null); }
            _view.CreationProperties = creation;
            PortableFabric.Record("live.web", "surface-create", SiliconApp.ConsoleMode ? "WebView2 windowed console surface" : (isPrivate ? "private WebView2 composition surface" : "persistent portable WebView2 composition surface"));
            _view.CoreWebView2InitializationCompleted += OnInitialized;
            _view.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e)
            {
                if (_adminBridge != null) _adminBridge.Navigating();
                try
                {
                    if (_boundaryUnavailable) throw new Exception("The installed live web runtime cannot enforce the required resource boundary.");
                    _navigationId = e.NavigationId;
                    Uri target = RequireWebTarget(e.Uri, true);
                    if (target != null)
                    {
                        if (_siliconAppActive && target.AbsolutePath == "/")
                        {
                            e.Cancel = true;
                            _view.CoreWebView2.Navigate(SiliconApp.ResolveEntryDocument(target).AbsoluteUri);
                            return;
                        }
                        if (!e.IsRedirected) _navigationStartedSecure = target.Scheme == "https";
                        if (e.IsRedirected && _navigationStartedSecure && target.Scheme == "http")
                            throw new Exception("HTTPS to HTTP redirects are outside the JA21 transport boundary.");
                    }
                }
                catch(Exception policyEx) { e.Cancel=true; EmitStatus("Live web navigation blocked · "+policyEx.Message); return; }
                EmitStatus("Loading live web · " + SafeHost(e.Uri));
            };
            _view.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
            {
                if (_disposed || e.NavigationId != _navigationId) return;
                if (_adminBridge != null) _adminBridge.DocumentCompleted(e.IsSuccess);
                if (e.IsSuccess) EmitNavigation();
                else EmitFailure("Live web navigation failed · " + e.WebErrorStatus.ToString());
                EmitStatus(e.IsSuccess ? "Live web settled" : "Live web navigation failed · " + e.WebErrorStatus.ToString());
            };
        }

        private void OnInitialized(object sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (!e.IsSuccess || _view.CoreWebView2 == null)
            {
                string failure = "Live web engine could not initialize" + (e.InitializationException == null ? "" : " · " + e.InitializationException.Message);
                EmitStatus(failure); EmitFailure(failure);
                return;
            }
            _ready = false;
            CoreWebView2Settings s = _view.CoreWebView2.Settings;
            s.IsStatusBarEnabled = false;
            s.AreDevToolsEnabled = String.Equals(Environment.GetEnvironmentVariable("JA21_ENABLE_DEVTOOLS"), "1", StringComparison.Ordinal);
            s.IsPasswordAutosaveEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.AreDefaultScriptDialogsEnabled = true;
            s.AreDefaultContextMenusEnabled = true;
            s.IsZoomControlEnabled = true;
            s.AreBrowserAcceleratorKeysEnabled = true;
            s.AreHostObjectsAllowed = false;
            s.IsWebMessageEnabled = _siliconRoot != null && SiliconApp.ConsoleMode;
            if (s.IsWebMessageEnabled)
            {
                _adminBridge = new HostAdminBridge(_root, _view.CoreWebView2, delegate(Action action) { if (!_disposed) _view.Dispatcher.BeginInvoke(action); });
                _view.CoreWebView2.WebMessageReceived += delegate(object o, CoreWebView2WebMessageReceivedEventArgs message)
                {
                    if (_adminBridge != null && !_disposed) _adminBridge.Handle(message.Source, message.WebMessageAsJson);
                };
            }
            _view.CoreWebView2.FrameNavigationStarting += delegate(object o, CoreWebView2NavigationStartingEventArgs n)
            {
                try { if (_siliconAppActive) throw new Exception("Embedded frames are disabled for the software application."); RequireWebTarget(n.Uri, true); }
                catch (Exception ex) { n.Cancel = true; EmitStatus("Live web frame blocked · " + ex.Message); }
            };
            // Cover images, scripts, fetch/XHR, frames and worker requests, rather than
            // applying a private-network boundary only to the top-level address bar.
            try { _view.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All); }
            catch (Exception ex)
            {
                _boundaryUnavailable = true; _ready = false; s.IsScriptEnabled = false; _view.CoreWebView2.Stop();
                string failure = "Live web runtime cannot enforce the required resource boundary · " + ex.Message;
                EmitStatus(failure); EmitFailure(failure); return;
            }
            _view.CoreWebView2.WebResourceRequested += delegate(object o, CoreWebView2WebResourceRequestedEventArgs r)
            {
                try
                {
                    Uri target;
                    if (!Uri.TryCreate(r.Request.Uri, UriKind.Absolute, out target)) throw new Exception("Invalid resource address.");
                    if (_siliconAppActive)
                    {
                        if (SiliconApp.IsConsoleOrigin(target)) return;
                        if (r.ResourceContext == CoreWebView2WebResourceContext.Image && (target.Scheme == "data" || SiliconApp.IsOwnedBlob(r.Request.Uri))) return;
                        throw new Exception("The software CPU/XPU application cannot request external resources.");
                    }
                    if (target.Scheme == "data" || target.Scheme == "blob" || r.Request.Uri == "about:blank") return;
                    RequireWebTarget(r.Request.Uri, false);
                }
                catch (Exception ex)
                {
                    r.Response = _view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(new byte[0]), 403, "Forbidden", "Content-Type: text/plain\r\nCache-Control: no-store");
                    EmitStatus("Live web resource blocked · " + ex.Message);
                }
            };
            if (_siliconRoot != null)
            {
                try
                {
                    // Mapped URLs are local, secure-context resources. Microsoft documents that
                    // their responses do not raise WebResourceRequested, so the sealed HTML must
                    // carry CSP/referrer metadata. The all-source filter still denies external
                    // document and worker network requests from this dedicated app surface.
                    _view.CoreWebView2.SetVirtualHostNameToFolderMapping(SiliconApp.HostName, _siliconRoot, CoreWebView2HostResourceAccessKind.DenyCors);
                }
                catch (Exception ex)
                {
                    _boundaryUnavailable = true; s.IsScriptEnabled = false; _view.CoreWebView2.Stop();
                    string failure = "Software application mapping could not be installed · " + ex.Message;
                    EmitStatus(failure); EmitFailure(failure); return;
                }
            }

            // Some video/player shells apply `cursor:none` while media is active. In a browser-owned
            // virtual desktop that can make the system pointer appear to fall behind the video surface.
            // Install a narrow guard that only overrides elements which explicitly compute to cursor:none;
            // ordinary link/text/resize cursor semantics remain site-controlled.
            string cursorGuard =
                "(function(){" +
                "function ja21CursorGuard(ev){var n=ev&&ev.target?ev.target:null;var hops=0;" +
                "while(n&&n.nodeType===1&&hops++<16){try{if(getComputedStyle(n).cursor==='none')n.style.setProperty('cursor','auto','important');}catch(e){}n=n.parentElement;}}" +
                "document.addEventListener('pointerover',ja21CursorGuard,true);" +
                "document.addEventListener('pointermove',ja21CursorGuard,true);" +
                "document.addEventListener('mousemove',ja21CursorGuard,true);" +
                "})();";
            try { _view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(cursorGuard); } catch { }
            _view.CoreWebView2.NewWindowRequested += delegate(object o, CoreWebView2NewWindowRequestedEventArgs n)
            {
                // Keep web navigation in the omni surface rather than spawning external browser chrome.
                n.Handled = true;
                if (_siliconAppActive) { EmitStatus("The software application cannot open another web window."); return; }
                try
                {
                    Uri popup; if(!String.IsNullOrWhiteSpace(n.Uri) && Uri.TryCreate(n.Uri,UriKind.Absolute,out popup) && (popup.Scheme=="http" || popup.Scheme=="https")) Navigate(n.Uri);
                    else EmitStatus("Live web blocked a non-web popup target.");
                }
                catch (Exception ex) { EmitStatus("Live web popup blocked · " + ex.Message); }
            };
            _view.CoreWebView2.LaunchingExternalUriScheme += delegate(object o, CoreWebView2LaunchingExternalUriSchemeEventArgs n)
            {
                n.Cancel = true;
                EmitStatus("Live web blocked an external application launch.");
            };
            _view.CoreWebView2.ContainsFullScreenElementChanged += delegate(object o, object args)
            {
                Action<bool> h=FullScreenChanged; if(h!=null)h(_view.CoreWebView2.ContainsFullScreenElement);
            };
            _view.CoreWebView2.PermissionRequested += delegate(object o, CoreWebView2PermissionRequestedEventArgs p)
            {
                // Camera, microphone, geolocation, notifications and clipboard escalation are denied
                // unless explicitly opted in for this launch. Ordinary video playback is unaffected.
                if (!_siliconAppActive && String.Equals(Environment.GetEnvironmentVariable("JA21_ALLOW_WEB_PERMISSIONS"), "1", StringComparison.Ordinal)) return;
                p.State = CoreWebView2PermissionState.Deny;
                p.SavesInProfile = false;
            };
            _view.CoreWebView2.ProcessFailed += delegate(object o, CoreWebView2ProcessFailedEventArgs p)
            {
                string failure = "Live web process needs recovery · " + p.ProcessFailedKind.ToString();
                _ready = false;
                EmitStatus(failure); EmitFailure(failure);
            };
            _view.CoreWebView2.DownloadStarting += delegate(object o, CoreWebView2DownloadStartingEventArgs d)
            {
                try
                {
                    if (_siliconAppActive && !SiliconApp.IsOwnedBlob(d.DownloadOperation.Uri)) throw new Exception("Software exports must originate from this application's own generated Blob.");
                    string path = PortablePaths.UniqueDownloadPath(_root, d.ResultFilePath);
                    d.ResultFilePath = path;
                    PortableFabric.Record("downloads", "download-route", System.IO.Path.GetFileName(path));
                    EmitStatus("Download routed to portable workspace · " + System.IO.Path.GetFileName(path));
                }
                catch(Exception ex) { d.Cancel = true; EmitStatus("Portable download path unavailable · " + ex.Message); }
            };
            _ready = true;
            EmitStatus("Live web engine ready · " + EngineLabel);
        }

        private Uri RequireWebTarget(string raw, bool allowBlank)
        {
            if (allowBlank && String.Equals(raw, "about:blank", StringComparison.OrdinalIgnoreCase)) return null;
            Uri target;
            if (!Uri.TryCreate(raw, UriKind.Absolute, out target)) throw new Exception("Live web address is not absolute.");
            if (_siliconAppActive && !SiliconApp.IsEntryDocument(target)) throw new Exception("The software application stays within its own local entry document.");
            JaAddressPolicy.CheckResolved(target);
            return target;
        }

        private void EmitNavigation()
        {
            Action<string, string> h = NavigationCommitted;
            if (h == null) return;
            string src = Source;
            string title = DocumentTitle;
            h(src, title);
        }
        private void EmitStatus(string text) { Action<string> h = StatusChanged; if (h != null) h(text); }
        private void EmitFailure(string text) { Action<string> h = NavigationFailed; if (h != null) h(text); }
        private static string SafeHost(string raw) { Uri u; return Uri.TryCreate(raw, UriKind.Absolute, out u) ? u.Host : "site"; }

        public FrameworkElement View { get { return _view.Element; } }
        public bool Ready { get { return _ready; } }
        public string EngineLabel
        {
            get
            {
                try { return "Microsoft Edge WebView2 " + LiveWebFactory.RuntimeVersion(_root); }
                catch { return "Microsoft Edge WebView2"; }
            }
        }
        public string Source { get { return _view.Source == null ? "" : _view.Source.AbsoluteUri; } }
        public string DocumentTitle { get { try { return _view.CoreWebView2 == null ? "" : _view.CoreWebView2.DocumentTitle; } catch { return ""; } } }
        public bool CanGoBack { get { try { return _view.CoreWebView2 != null && _view.CoreWebView2.CanGoBack; } catch { return false; } } }
        public bool CanGoForward { get { try { return _view.CoreWebView2 != null && _view.CoreWebView2.CanGoForward; } catch { return false; } } }

        public void Navigate(string url)
        {
            if (_disposed) return;
            if (_boundaryUnavailable) throw new Exception("The installed live web runtime cannot enforce the required resource boundary.");
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u)) throw new Exception("Live web address is not absolute.");
            if(u.Scheme!="http" && u.Scheme!="https") throw new Exception("Live web opens only HTTP or HTTPS addresses.");
            if (_siliconAppActive && !SiliconApp.IsEntryDocument(u)) throw new Exception("The software application stays within its own local entry document.");
            if (SiliconApp.IsConsoleOrigin(u))
            {
                if (!SiliconApp.IsEntryDocument(u)) throw new Exception("The software application opens only its local entry document.");
                if (_siliconRoot == null) throw new Exception("Software application mapping is unavailable.");
                _siliconAppActive = true;
                u = SiliconApp.ResolveEntryDocument(u);
            }
            JaAddressPolicy.Check(u);
            PortableFabric.Record("live.web", "navigate", u.Host);
            _view.Source = u;
        }
        public void GoBack() { if (CanGoBack) _view.GoBack(); }
        public void GoForward() { if (CanGoForward) _view.GoForward(); }
        public void Reload() { try { if (_view.CoreWebView2 != null) _view.Reload(); } catch { } }
        public void Stop() { try { if (_view.CoreWebView2 != null) _view.CoreWebView2.Stop(); } catch { } }
        public void ClearBrowsingData() { try { if (_view.CoreWebView2 != null) _view.CoreWebView2.Profile.ClearBrowsingDataAsync(); } catch { } }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            if (_adminBridge != null) { _adminBridge.Dispose(); _adminBridge = null; }
            try { _view.Dispose(); } catch { }
            if (_private)
            {
                try { RuntimeSeal.RejectReparsePoints(PortablePaths.Workspace(_root), _dataDir); Directory.Delete(_dataDir, true); } catch { }
            }
        }
    }
}
