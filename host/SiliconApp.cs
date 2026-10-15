// Local hosting boundary for the sealed JA21 software CPU/XPU application.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace VBJA21
{
    public static class SiliconApp
    {
        public const string HostName = "ja21-silicon.invalid";
        public const string Origin = "https://ja21-silicon.invalid/";
        public const string EntryUrl = Origin + "index.html";
        public const string Csp = "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
        public const string RelativeRoot = "applications/silicon/dist";
        public static bool ConsoleMode { get { return String.Equals(Environment.GetEnvironmentVariable("JA21_CONSOLE_MODE"), "1", StringComparison.Ordinal); } }
        public static bool RequireLive { get { return ConsoleMode && String.Equals(Environment.GetEnvironmentVariable("JA21_REQUIRE_LIVE_WEB"), "1", StringComparison.Ordinal); } }

        public static bool IsConsoleOrigin(Uri target)
        {
            if (!ConsoleMode || target == null || target.Scheme != "https" || target.Port != 443 ||
                !String.IsNullOrEmpty(target.UserInfo) || !String.Equals(target.DnsSafeHost, HostName, StringComparison.OrdinalIgnoreCase)) return false;
            // Reject credential delimiters, trailing-dot aliases and escaped authority spellings.
            Match authority = Regex.Match(target.OriginalString, @"\Ahttps://([^/?#]+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            return authority.Success && (String.Equals(authority.Groups[1].Value, HostName, StringComparison.OrdinalIgnoreCase) ||
                String.Equals(authority.Groups[1].Value, HostName + ":443", StringComparison.OrdinalIgnoreCase));
        }

        public static bool IsEntryDocument(Uri target)
        {
            return IsConsoleOrigin(target) && (target.AbsolutePath == "/" || target.AbsolutePath == "/index.html" || target.AbsolutePath == "/validate.html");
        }

        public static Uri ResolveEntryDocument(Uri target)
        {
            if (!IsEntryDocument(target)) throw new Exception("The software application opens only its local entry document.");
            if (target.AbsolutePath != "/") return target;
            UriBuilder entry = new UriBuilder(target); entry.Path = "/index.html";
            return entry.Uri;
        }

        public static bool IsOwnedBlob(string address)
        {
            return ConsoleMode && !String.IsNullOrEmpty(address) && address.StartsWith("blob:" + Origin, StringComparison.OrdinalIgnoreCase);
        }

        public static string ValidateMappedRoot(string packageRoot)
        {
            string root = RuntimeSeal.Contained(packageRoot, RelativeRoot);
            if (!Directory.Exists(root)) throw new Exception("The JA21 software CPU/XPU application is missing: " + RelativeRoot);
            if (root.Length >= 260) throw new Exception("The software application mapping path exceeds the WebView2 folder-path limit.");
            string sealPath = RuntimeSeal.Contained(packageRoot, "engine/ja21/runtime.integrity.json");
            JavaScriptSerializer parser = new JavaScriptSerializer(); parser.MaxJsonLength = 8 * 1024 * 1024;
            Dictionary<string, object> seal = (Dictionary<string, object>)parser.DeserializeObject(File.ReadAllText(sealPath, Encoding.UTF8));
            if (!seal.ContainsKey("version") || Convert.ToString(seal["version"]) != BrowserVersion.Full)
                throw new Exception("The software application requires the matching runtime integrity seal.");
            Dictionary<string, string> hashes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (object entry in (object[])seal["files"])
            {
                Dictionary<string, object> file = (Dictionary<string, object>)entry;
                string relative = Convert.ToString(file["path"]);
                RuntimeSeal.Contained(packageRoot, relative);
                if (hashes.ContainsKey(relative)) throw new Exception("Duplicate runtime-sealed path: " + relative);
                hashes.Add(relative, RuntimeSeal.RequireSha256(Convert.ToString(file["sha256"]), "runtime file digest"));
            }
            int count = 0;
            VerifyTree(packageRoot, root, RelativeRoot, hashes, ref count);
            if (count == 0) throw new Exception("The software application mapping is empty.");
            ValidateDocumentOverlay(RuntimeSeal.Contained(packageRoot, RelativeRoot + "/index.html"));
            string validation = RuntimeSeal.Contained(packageRoot, RelativeRoot + "/validate.html");
            if (File.Exists(validation)) ValidateDocumentOverlay(validation);
            return root;
        }

        private static void ValidateDocumentOverlay(string document)
        {
            string html = File.ReadAllText(document, Encoding.UTF8);
            if (!HasMeta(html, "http-equiv", "Content-Security-Policy", Csp) || !HasMeta(html, "name", "referrer", "no-referrer"))
                throw new Exception("The mapped software application is missing its required sealed CSP/referrer integration overlay: " + Path.GetFileName(document));
        }

        private static void VerifyTree(string packageRoot, string directory, string relative, Dictionary<string, string> hashes, ref int count)
        {
            RuntimeSeal.RejectReparsePoints(packageRoot, directory);
            foreach (string child in Directory.GetFileSystemEntries(directory))
            {
                RuntimeSeal.RejectReparsePoints(packageRoot, child);
                FileAttributes attributes = File.GetAttributes(child);
                string name = Path.GetFileName(child), path = relative + "/" + name;
                if (name.IndexOf(':') >= 0 || name == "." || name == "..") throw new Exception("Unsafe mapped application path.");
                if ((attributes & FileAttributes.Directory) != 0) { VerifyTree(packageRoot, child, path, hashes, ref count); continue; }
                string expected;
                if (!hashes.TryGetValue(path, out expected)) throw new Exception("Unsealed file in software application mapping: " + path);
                FileInfo info = new FileInfo(child);
                if (info.Length > 2 * 1024 * 1024) throw new Exception("Mapped application file exceeds the local resource size limit: " + path);
                if (RuntimeSeal.Sha256(File.ReadAllBytes(child)) != expected) throw new Exception("Software application integrity failure: " + path);
                count++;
            }
        }

        private static bool HasMeta(string html, string key, string name, string content)
        {
            foreach (Match tag in Regex.Matches(html, @"<meta\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
            {
                Match identifier = Regex.Match(tag.Value, "\\b" + key + "\\s*=\\s*([\"'])(.*?)\\1", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
                Match value = Regex.Match(tag.Value, "\\bcontent\\s*=\\s*([\"'])(.*?)\\1", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
                if (identifier.Success && value.Success && String.Equals(identifier.Groups[2].Value, name, StringComparison.OrdinalIgnoreCase) &&
                    String.Equals(value.Groups[2].Value, content, StringComparison.Ordinal)) return true;
            }
            return false;
        }
    }
}
