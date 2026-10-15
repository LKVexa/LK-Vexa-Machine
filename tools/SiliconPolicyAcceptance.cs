// Focused, headless tests against the compiled production host; no browser or network.
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

public static class SiliconPolicyAcceptance
{
    private static int _checks;
    private static Type _app;
    private static Type _policy;
    private static void Check(bool value, string label) { _checks++; if (!value) throw new Exception(label); }
    private static object Call(Type type, string method, params object[] args) { return type.GetMethod(method, BindingFlags.Public | BindingFlags.Static).Invoke(null, args); }
    private static bool Origin(string raw) { try { return (bool)Call(_app, "IsConsoleOrigin", new Uri(raw)); } catch (UriFormatException) { return false; } }
    private static void Refused(Action action, string label) { _checks++; try { action(); } catch (Exception) { return; } throw new Exception(label); }
    private static string Sha(byte[] bytes) { using (SHA256 sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); } }
    private static void Seal(string root, string version)
    {
        List<object> files = new List<object>();
        foreach (string file in Directory.GetFiles(Path.Combine(root, "applications", "silicon", "dist"), "*", SearchOption.AllDirectories))
            files.Add(new Dictionary<string, object> { { "path", file.Substring(root.Length + 1).Replace('\\', '/') }, { "sha256", Sha(File.ReadAllBytes(file)) } });
        string target = Path.Combine(root, "engine", "ja21"); Directory.CreateDirectory(target);
        File.WriteAllText(Path.Combine(target, "runtime.integrity.json"), new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "version", version }, { "files", files } }), new UTF8Encoding(false));
    }
    public static int Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("Usage: Test-Silicon-Policy.exe PACKAGE_ROOT OWNED_WORK_DIRECTORY"); return 1; }
        string root = Path.GetFullPath(args[0]), work = Path.GetFullPath(args[1]);
        string fixture = null;
        try
        {
            Directory.CreateDirectory(work);
            Assembly production = Assembly.LoadFrom(Path.Combine(root, "JA21-Silicon-Console.exe"));
            _app = production.GetType("VBJA21.SiliconApp", true); _policy = production.GetType("VBJA21.JaAddressPolicy", true);
            Environment.SetEnvironmentVariable("JA21_CONSOLE_MODE", "1");
            Environment.SetEnvironmentVariable("JA21_ALLOW_PRIVATE_HOSTS", "1");
            Environment.SetEnvironmentVariable("JA21_CONSOLE_ORIGINS", "http://127.0.0.1:8788");
            string origin = (string)_app.GetField("Origin").GetRawConstantValue(), csp = (string)_app.GetField("Csp").GetRawConstantValue();
            foreach (string address in new string[] { origin, "https://JA21-SILICON.invalid/index.html", "https://ja21-silicon.invalid:443/src/app.js" })
                Check(Origin(address), "trusted HTTPS origin refused: " + address);
            foreach (string address in new string[] { "http://ja21-silicon.invalid/", "https://ja21-silicon.invalid:444/", "https://ja21-silicon.invalid./", "https://ja21-silicon.invalid.evil/", "https://user@ja21-silicon.invalid/", "https://@ja21-silicon.invalid/", "https://example.com/ja21-silicon.invalid", "https://127.0.0.1/", "https://localhost/" })
                Check(!Origin(address), "untrusted origin admitted: " + address);
            Call(_policy, "CheckResolved", new Uri(origin)); _checks++; // .invalid must succeed without DNS.
            foreach (string address in new string[] { "http://127.0.0.1:8788/", "http://localhost/", "https://192.168.1.1/" })
                Refused(delegate { Call(_policy, "Check", new Uri(address)); }, "console private-host boundary bypassed");
            Uri entry = (Uri)Call(_app, "ResolveEntryDocument", new Uri(origin + "?a=1#x"));
            Check(entry.AbsolutePath == "/index.html" && entry.Query == "?a=1" && entry.Fragment == "#x", "root entry normalization changed origin/query/fragment");
            Uri validation = (Uri)Call(_app, "ResolveEntryDocument", new Uri(origin + "validate.html"));
            Check(validation.AbsolutePath == "/validate.html" && validation.GetLeftPart(UriPartial.Authority) == "https://ja21-silicon.invalid", "literal validation entry refused or changed origin");
            foreach (string address in new string[] { origin + "validate.html/", origin + "validate.html.evil", origin + "Validate.html", origin + "nested/validate.html", origin + "validate.htm", origin + "%76alidate.html", "https://ja21-silicon.invalid.evil/validate.html", "https://ja21-silicon.invalid./validate.html", "https://user@ja21-silicon.invalid/validate.html", "https://@ja21-silicon.invalid/validate.html", "http://ja21-silicon.invalid/validate.html", "https://ja21-silicon.invalid:444/validate.html", "https://example.com/validate.html", "https://127.0.0.1/validate.html", "file:///validate.html" })
                Refused(delegate { Call(_app, "ResolveEntryDocument", new Uri(address)); }, "non-literal or foreign validation entry admitted: " + address);
            Refused(delegate { Call(_app, "ResolveEntryDocument", new Uri(origin + "src/app.js")); }, "non-entry top-level document admitted");
            Check((bool)Call(_app, "IsOwnedBlob", "blob:" + origin + "test") && !(bool)Call(_app, "IsOwnedBlob", "blob:https://example.com/test"), "export Blob origin boundary");
            Environment.SetEnvironmentVariable("JA21_CONSOLE_MODE", "0");
            Check(!Origin(origin), "mapped exception leaked outside console mode");
            Call(_policy, "Check", new Uri("https://example.com/")); _checks++;
            Environment.SetEnvironmentVariable("JA21_CONSOLE_MODE", "1");

            fixture = Path.Combine(work, "policy-fixture-" + Guid.NewGuid().ToString("N"));
            string dist = Path.Combine(fixture, "applications", "silicon", "dist"); Directory.CreateDirectory(dist);
            string html = "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\"><meta name=\"referrer\" content=\"no-referrer\">";
            string index = Path.Combine(dist, "index.html"), script = Path.Combine(dist, "app.js");
            File.WriteAllText(index, html); File.WriteAllText(script, "export default 1;"); Seal(fixture, "9.8.7");
            Check((string)Call(_app, "ValidateMappedRoot", fixture) == dist, "valid sealed mapping refused");
            string validationFile = Path.Combine(dist, "validate.html"); File.WriteAllText(validationFile, html); Seal(fixture, "9.8.7");
            Check((string)Call(_app, "ValidateMappedRoot", fixture) == dist, "valid sealed validation page refused");
            File.WriteAllText(validationFile, "<!doctype html>"); Seal(fixture, "9.8.7");
            Refused(delegate { Call(_app, "ValidateMappedRoot", fixture); }, "validation page without CSP/referrer overlay admitted");
            File.WriteAllText(validationFile, html); Seal(fixture, "9.8.7");
            File.WriteAllText(script, "tampered");
            Refused(delegate { Call(_app, "ValidateMappedRoot", fixture); }, "tampered mapped file admitted");
            File.WriteAllText(script, "export default 1;"); Seal(fixture, "9.8.7");
            string extra = Path.Combine(dist, "extra.js"); File.WriteAllText(extra, "unsealed");
            Refused(delegate { Call(_app, "ValidateMappedRoot", fixture); }, "unsealed extra mapped file admitted"); File.Delete(extra);
            File.WriteAllText(index, "<!doctype html>"); Seal(fixture, "9.8.7");
            Refused(delegate { Call(_app, "ValidateMappedRoot", fixture); }, "missing CSP/referrer overlay admitted");
            File.WriteAllText(index, html); Seal(fixture, "wrong");
            Refused(delegate { Call(_app, "ValidateMappedRoot", fixture); }, "wrong seal version admitted");
            File.WriteAllBytes(script, new byte[2 * 1024 * 1024 + 1]); Seal(fixture, "9.8.7");
            Refused(delegate { Call(_app, "ValidateMappedRoot", fixture); }, "oversized mapped file admitted");
            Type seal = production.GetType("VBJA21.RuntimeSeal", true);
            Refused(delegate { Call(seal, "Contained", fixture, "applications/silicon/dist/../escape"); }, "mapped path traversal admitted");
            Dictionary<string, object> report = new Dictionary<string, object> { { "status", "PASS" }, { "checks", _checks }, { "runtime", Environment.Version.ToString() }, { "processBits", IntPtr.Size * 8 }, { "scope", "Headless production origin policy, entry normalization and sealed mapping; no browser/UI/network started" }, { "productionExeSha256", Sha(File.ReadAllBytes(Path.Combine(root, "JA21-Silicon-Console.exe"))) } };
            string json = new JavaScriptSerializer().Serialize(report);
            File.WriteAllText(Path.Combine(work, "SILICON_NATIVE_POLICY_RESULTS.json"), json + "\n", new UTF8Encoding(false));
            Console.WriteLine(json); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally
        {
            if (fixture != null && Path.GetDirectoryName(fixture) == work && Path.GetFileName(fixture).StartsWith("policy-fixture-", StringComparison.Ordinal))
            { Directory.Delete(fixture, true); }
        }
    }
}
