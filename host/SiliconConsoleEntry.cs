// Ordinary .NET Framework console application entry point; no script interpreter.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

[assembly: AssemblyTitle("JA21 Software CPU Console")]
[assembly: AssemblyVersion("1.4.0.0")]
[assembly: AssemblyFileVersion("1.4.0.0")]
[assembly: AssemblyInformationalVersion("Console 1.4.0; software CPU/XPU 2.4.0; base browser 9.8.7")]

namespace VBJA21
{
    public static class SiliconConsoleEntry
    {
        private const string SdkVersion = "1.0.4191.47";
        private static string _bootLog;
        private static string _sdkRoot;
        private static IntPtr _nativeLoader;
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryExW(string path, IntPtr file, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetModuleFileNameW(IntPtr module, StringBuilder path, int size);

        [STAThread]
        public static int Main(string[] args)
        {
            try
            {
                bool preflight = false, blank = false, rootSeen = false;
                string root = AppDomain.CurrentDomain.BaseDirectory;
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--preflight" && !preflight) { preflight = true; continue; }
                    if (args[i] == "--blank" && !blank) { blank = true; continue; }
                    if (args[i] == "--root" && !rootSeen && i + 1 < args.Length) { rootSeen = true; root = args[++i]; continue; }
                    throw new Exception("Usage: JA21-Silicon-Console.exe [--root ABSOLUTE_PACKAGE_PATH] [--preflight] [--blank]");
                }
                if (!Path.IsPathRooted(root)) throw new Exception("The package root must be an absolute path.");
                root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
                if (!Directory.Exists(root)) throw new Exception("The package root does not exist: " + root);
                RuntimeSeal.RejectReparsePoints(Path.GetPathRoot(root), root);
                if (!Environment.Is64BitProcess) throw new Exception("This console requires a 64-bit Windows/.NET Framework process.");
                Environment.SetEnvironmentVariable("JA21_CONSOLE_MODE", "1");
                Environment.SetEnvironmentVariable("JA21_REQUIRE_LIVE_WEB", "1");
                Environment.SetEnvironmentVariable("JA21_REDUCED_MOTION", "1");
                Environment.SetEnvironmentVariable("JA21_ALLOW_PRIVATE_HOSTS", "0");
                Environment.SetEnvironmentVariable("JA21_PORTABLE_ROOT", Path.Combine(root, "workspace"));
                ConfigurePortableEnvironment(root);
                Stage("native-entry", "software CPU/XPU 2.4.0; compiled native presenter x64; WebView2 executes JavaScript; no Node or local server");
                RuntimeSeal.Verify(root);
                VerifyConfiguration(root);
                string mapping = SiliconApp.ValidateMappedRoot(root);
                VerifyAdapter(root);
                Stage("preflight-pass", "sealed application and SDK verified; mapped directory " + mapping);
                if (preflight)
                {
                    Console.WriteLine("JA21 software console preflight PASS. Sealed application and pinned SDK verified; no browser window or network started.");
                    return 0;
                }
                if (Environment.GetEnvironmentVariable("JA21_NATIVE_ONLY") == "1" || Environment.GetEnvironmentVariable("JA21_DISABLE_LIVE_WEB") == "1")
                    throw new Exception("The software CPU/XPU requires Microsoft WebView2; disabled-live or native-inspection mode cannot execute it.");
                LoadAdapter();
                Environment.SetEnvironmentVariable("JA21_START_URL", blank ? "about:blank" : SiliconApp.Origin);
                StartPresenter(root);
                Stage("presenter-exit", "clean exit");
                return 0;
            }
            catch (Exception error)
            {
                Stage("FAILED", error.ToString());
                Console.Error.WriteLine("JA21 software console could not start: " + error.Message);
                if (!String.IsNullOrEmpty(_bootLog)) Console.Error.WriteLine("Boot log: " + _bootLog);
                return 1;
            }
        }

        private static void ConfigurePortableEnvironment(string root)
        {
            PortablePaths.RequireConsoleProfilePath(Path.Combine(PortablePaths.Workspace(root), "state", "webview2", "profile"));
            string workspace = PortablePaths.EnsureLayout(root);
            _bootLog = RuntimeSeal.Contained(root, "workspace/logs/boot-latest.log");
            File.WriteAllText(_bootLog, "JA21 software CPU/XPU console native startup\r\n", new UTF8Encoding(false));
            string state = Path.Combine(workspace, "state");
            Environment.SetEnvironmentVariable("JA21_WEB_DATA_ROOT", Path.Combine(state, "webview2"));
            Environment.SetEnvironmentVariable("JA21_VEC1_STATE_ROOT", Path.Combine(state, "vec1"));
            Environment.SetEnvironmentVariable("JA21_DOWNLOADS_ROOT", Path.Combine(workspace, "downloads"));
            Environment.SetEnvironmentVariable("JA21_TEMP_ROOT", Path.Combine(workspace, "temp"));
            Environment.SetEnvironmentVariable("LOCALAPPDATA", Path.Combine(workspace, "host-env", "LocalAppData"));
            Environment.SetEnvironmentVariable("APPDATA", Path.Combine(workspace, "host-env", "RoamingAppData"));
            Environment.SetEnvironmentVariable("TEMP", Path.Combine(workspace, "temp"));
            Environment.SetEnvironmentVariable("TMP", Path.Combine(workspace, "temp"));
            Environment.SetEnvironmentVariable("PYTHONPYCACHEPREFIX", Path.Combine(workspace, "cache", "pycache"));
            Environment.SetEnvironmentVariable("PYTHONDONTWRITEBYTECODE", "1");
        }

        private static Dictionary<string, object> ReadObject(string root, string relative)
        {
            return (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(File.ReadAllText(RuntimeSeal.Contained(root, relative), Encoding.UTF8));
        }

        private static void VerifyConfiguration(string root)
        {
            Dictionary<string, object> settings = ReadObject(root, "console.json");
            if (Convert.ToString(settings["start_url"]) != SiliconApp.Origin) throw new Exception("The software console start_url must be its exact local HTTPS origin.");
            object[] origins = (object[])settings["local_origins"];
            if (origins.Length != 1) throw new Exception("The software console requires exactly one mapped local origin.");
            foreach (object entry in origins)
            {
                Uri origin;
                if (!Uri.TryCreate(Convert.ToString(entry), UriKind.Absolute, out origin) || !SiliconApp.IsEntryDocument(origin) ||
                    origin.AbsolutePath != "/" || !String.IsNullOrEmpty(origin.Query) || !String.IsNullOrEmpty(origin.Fragment))
                    throw new Exception("The software console does not permit another local origin.");
            }
            Dictionary<string, object> build = ReadObject(root, "CONSOLE_BUILD.json");
            if (!build.ContainsKey("software_cpu_console") || !(build["software_cpu_console"] is bool) || !(bool)build["software_cpu_console"] ||
                Convert.ToString(build["silicon_version"]) != "2.4.0" || Convert.ToString(build["console_version"]) != "1.4.0" ||
                File.ReadAllText(RuntimeSeal.Contained(root, "CONSOLE_VERSION")).Trim() != "1.4.0")
                throw new Exception("Console build/version markers do not identify the integrated software CPU/XPU release.");
            Dictionary<string, object> release = ReadObject(root, "applications/silicon/dist/release.json");
            if (Convert.ToString(release["version"]) != "2.4.0" || Convert.ToString(release["profile"]) != "LOCAL_BROWSER")
                throw new Exception("Unexpected software CPU/XPU component version or runtime profile.");
            if (File.ReadAllText(RuntimeSeal.Contained(root, "applications/silicon/VERSION")).Trim() != "2.4.0")
                throw new Exception("The software CPU/XPU component version markers disagree.");
        }

        private static void VerifyAdapter(string root)
        {
            _sdkRoot = RuntimeSeal.Contained(root, "runtime/webview2-sdk/" + SdkVersion);
            string[] names = new string[] { "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.Wpf.dll", "WebView2Loader.dll" };
            string[] expected = new string[] {
                "e6f54c8ce208e3797c427d01ad671b47cb25abc85604753d6ec2546d0ffef550",
                "6942b85a3388ece45febde5584d2bfc035d84315f2dd5a4a47913f01a0193800",
                "c66e4a92fdc7a216118e43b7a5024ea2200e8c43f9310bf20d96a0084f82c5bc"
            };
            for (int i = 0; i < names.Length; i++)
            {
                string file = RuntimeSeal.Contained(root, "runtime/webview2-sdk/" + SdkVersion + "/" + names[i]);
                if (!File.Exists(file) || RuntimeSeal.Sha256(File.ReadAllBytes(file)) != expected[i]) throw new Exception("Pinned WebView2 artifact failed integrity verification: " + names[i]);
                if (i < 2)
                {
                    AssemblyName identity = AssemblyName.GetAssemblyName(file);
                    if (identity.Name + ".dll" != names[i] || identity.Version.ToString() != SdkVersion)
                        throw new Exception("Pinned WebView2 assembly identity disagrees: " + names[i]);
                }
            }
        }

        private static Assembly ResolveAdapter(object sender, ResolveEventArgs args)
        {
            AssemblyName requested = new AssemblyName(args.Name);
            if (requested.Name != "Microsoft.Web.WebView2.Core" && requested.Name != "Microsoft.Web.WebView2.Wpf") return null;
            string file = Path.Combine(_sdkRoot, requested.Name + ".dll");
            if (AssemblyName.GetAssemblyName(file).FullName != requested.FullName) throw new Exception("Unexpected WebView2 assembly binding request.");
            return Assembly.LoadFrom(file);
        }

        private static void LoadAdapter()
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveAdapter;
            string native = Path.Combine(_sdkRoot, "WebView2Loader.dll");
            _nativeLoader = LoadLibraryExW(native, IntPtr.Zero, 0x00000100 | 0x00001000);
            if (_nativeLoader == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            StringBuilder actual = new StringBuilder(32768);
            uint length = GetModuleFileNameW(_nativeLoader, actual, actual.Capacity);
            if (length == 0 || length >= actual.Capacity || !String.Equals(actual.ToString(), native, StringComparison.OrdinalIgnoreCase))
                throw new Exception("WebView2 native loader resolved outside its verified SDK directory.");
            foreach (string name in new string[] { "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.Wpf.dll" })
            {
                string path = Path.Combine(_sdkRoot, name);
                Assembly loaded = Assembly.LoadFrom(path);
                if (!String.Equals(loaded.Location, path, StringComparison.OrdinalIgnoreCase)) throw new Exception("WebView2 managed assembly resolved outside its verified SDK directory.");
            }
        }

        // Used by the separate production acceptance application after its runtime-seal gate.
        // Loading the same pinned SDK never restores packages or changes browser settings.
        public static void LoadVerifiedAdapter(string root)
        {
            VerifyAdapter(root);
            LoadAdapter();
        }

        private static void StartPresenter(string root)
        {
            if (!LiveWebFactory.IsAvailable(root)) throw new Exception("A supported Microsoft WebView2 runtime is required. Native inspection fallback cannot run the software CPU/XPU.");
            Stage("live-runtime-ready", LiveWebFactory.AdapterStatus(root));
            Stage("presenter-run", SiliconApp.Origin);
            Program.Run(root);
        }

        private static void Stage(string name, string message)
        {
            string line = DateTime.UtcNow.ToString("o") + "\t" + name + "\t" + message;
            Console.WriteLine("JA21 · " + name + " · " + message);
            if (!String.IsNullOrEmpty(_bootLog)) { try { File.AppendAllText(_bootLog, line + "\r\n", new UTF8Encoding(false)); } catch { } }
        }
    }
}
