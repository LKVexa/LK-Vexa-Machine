// The sealed index document receives a narrow JSON bridge; no COM/.NET host object is exposed.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using JA21Admin;

namespace VBJA21
{
    internal sealed class HostAdminBridge : IDisposable
    {
        private readonly string root; private readonly CoreWebView2 view; private readonly Action<Action> dispatch;
        private readonly object gate = new object(); private readonly Queue<string> input = new Queue<string>(); private readonly AutoResetEvent available = new AutoResetEvent(false);
        private sealed class OutputFrame { public string Json; public int Generation, Bytes; }
        private readonly Queue<OutputFrame> output = new Queue<OutputFrame>(); private int outputBytes; private bool outputScheduled, outputFailed;
        private readonly HashSet<string> ids = new HashSet<string>(StringComparer.Ordinal); private Process bridge; private string sid, openRequestId, documentToken = AdminProtocol.RandomToken(16); private int generation, queuedBytes; private bool completed, disposed;
        public HostAdminBridge(string packageRoot, CoreWebView2 webView, Action<Action> uiDispatch) { root = packageRoot; view = webView; dispatch = uiDispatch; }
        public static bool TrustedSource(string source)
        {
            Uri u; return Uri.TryCreate(source, UriKind.Absolute, out u) && SiliconApp.IsConsoleOrigin(u) && u.AbsolutePath == "/index.html" && u.Query.Length == 0 && u.Fragment.Length == 0 && String.Equals(source, SiliconApp.EntryUrl, StringComparison.Ordinal);
        }
        public void Navigating() { lock (gate) { completed = false; documentToken = AdminProtocol.RandomToken(16); } Stop("document changed"); }
        public void DocumentCompleted(bool success) { lock (gate) completed = success && TrustedSource(view.Source); }
        private void Post(string json, int expected)
        {
            bool schedule = false, overflow = false; Process child = null; int bytes = AdminProtocol.Utf8.GetByteCount(json);
            lock (gate)
            {
                if (disposed || expected != generation || !completed) return;
                if (output.Count >= 1024 || outputBytes + bytes > AdminProtocol.FrameBytes) { if (!outputFailed) { outputFailed = true; overflow = true; child = bridge; } }
                else { output.Enqueue(new OutputFrame { Json = json, Generation = expected, Bytes = bytes }); outputBytes += bytes; if (!outputScheduled) { outputScheduled = true; schedule = true; } }
            }
            if (overflow) Fail("Administrator output exceeded the bounded display queue; undelivered output was discarded.", expected, child);
            if (schedule) try { dispatch(DrainOutput); } catch { lock (gate) { output.Clear(); outputBytes = 0; outputScheduled = false; } }
        }
        private void DrainOutput()
        {
            int count = 0;
            while (count++ < 32)
            {
                OutputFrame item; lock (gate) { if (disposed || output.Count == 0) { output.Clear(); outputBytes = 0; outputScheduled = false; return; } item = output.Dequeue(); outputBytes -= item.Bytes; if (item.Generation != generation || !completed || !TrustedSource(view.Source)) continue; }
                try { view.PostWebMessageAsJson(item.Json); } catch { }
            }
            try { dispatch(DrainOutput); } catch { lock (gate) { output.Clear(); outputBytes = 0; outputScheduled = false; } }
        }
        private void Error(string message, int expected) { Post(AdminProtocol.Serialize(AdminProtocol.Message("error", sid, null, new Dictionary<string, object> { { "message", message.Length > 256 ? message.Substring(0, 256) : message } })), expected); }
        private void Fail(string message, int expected, Process child)
        {
            try { dispatch(delegate() { lock (gate) { if (disposed || expected != generation || (child != null && bridge != child) || !completed || !TrustedSource(view.Source)) return; } try { view.PostWebMessageAsJson(AdminProtocol.Serialize(AdminProtocol.Message("error", sid, null, new Dictionary<string, object> { { "message", message.Length > 256 ? message.Substring(0, 256) : message } }))); } catch { } Stop("Administrator bridge failure", child, expected); }); } catch { }
        }
        public void Handle(string source, string json)
        {
            int current; lock (gate) { if (disposed || !completed || !TrustedSource(source) || !TrustedSource(view.Source)) return; current = generation; }
            try
            {
                Dictionary<string, object> request = AdminProtocol.Parse(json);
                if (request.ContainsKey("op") && Convert.ToString(request["op"]) == "hello")
                {
                    AdminProtocol.Keys(request, "v", "id", "op", "payload"); AdminProtocol.Int(request, "v", 1, 1); AdminProtocol.Keys(AdminProtocol.Object(request, "payload"));
                    RequireHelper(); string token; lock (gate) token = documentToken;
                    Post(AdminProtocol.Serialize(AdminProtocol.Message("ready", null, null, new Dictionary<string, object> { { "available", true }, { "bridgeEpoch", token } })), current); return;
                }
                string expectedToken; lock (gate) expectedToken = documentToken;
                if (!NativeToken(request, expectedToken)) throw new InvalidDataException("Administrator request belongs to an old document."); request.Remove("bridgeEpoch");
                if (Convert.ToString(request["op"]) == "cancel-open")
                {
                    AdminProtocol.Keys(request, "v", "id", "op", "payload"); AdminProtocol.Int(request, "v", 1, 1); string cancelId = AdminProtocol.String(request, "id", 64); if (!System.Text.RegularExpressions.Regex.IsMatch(cancelId, @"\A[A-Za-z0-9_-]{1,64}\z")) throw new InvalidDataException("Invalid cancellation id."); Dictionary<string, object> payload = AdminProtocol.Object(request, "payload"); AdminProtocol.Keys(payload, "requestId"); string opening = AdminProtocol.String(payload, "requestId", 64); lock (gate) { if (opening != openRequestId || bridge == null) return; } Stop("Administrator opening cancelled"); return;
                }
                string clean = AdminProtocol.Serialize(request); request = AdminProtocol.Request(clean, sid); string op = (string)request["op"], id = (string)request["id"];
                lock (gate) { if (ids.Count >= 4096 || !ids.Add(id)) throw new InvalidDataException("Repeated or excessive Administrator requests."); if (op == "open") { if (bridge != null) throw new InvalidOperationException("Administrator terminal is already opening."); generation++; current = generation; openRequestId = id; Start(current); } if (bridge == null) throw new InvalidOperationException("Administrator terminal is not open."); int n = AdminProtocol.Utf8.GetByteCount(clean); if (input.Count >= 64 || queuedBytes + n > AdminProtocol.FrameBytes) throw new InvalidOperationException("Administrator input backpressure."); input.Enqueue(clean); queuedBytes += n; available.Set(); }
                if (op == "close") Stop("closed");
            }
            catch (Exception ex) { Fail(ex.Message, current, null); }
        }
        private static bool NativeToken(Dictionary<string, object> request, string token) { object value; return request.TryGetValue("bridgeEpoch", out value) && value is string && ConstantEqual((string)value, token); }
        private static bool ConstantEqual(string a, string b) { if (a == null || b == null || a.Length != b.Length) return false; int diff = 0; for (int n = 0; n < a.Length; n++) diff |= a[n] ^ b[n]; return diff == 0; }
        private string RequireHelper()
        {
            string path = RuntimeSeal.Contained(root, "tools/JA21-Admin-Terminal.exe"); RuntimeSeal.RejectReparsePoints(root, path); if (!File.Exists(path) || new FileInfo(path).Length > 1024 * 1024) throw new FileNotFoundException("Packaged Administrator helper is unavailable.");
            JavaScriptSerializer j = new JavaScriptSerializer(); j.MaxJsonLength = 8 * 1024 * 1024; Dictionary<string, object> seal = (Dictionary<string, object>)j.DeserializeObject(File.ReadAllText(RuntimeSeal.Contained(root, "engine/ja21/runtime.integrity.json"), Encoding.UTF8));
            string digest = null; foreach (object item in (object[])seal["files"]) { Dictionary<string, object> e = (Dictionary<string, object>)item; if (Convert.ToString(e["path"]) == "tools/JA21-Admin-Terminal.exe") { if (digest != null) throw new InvalidDataException("Duplicate helper seal."); digest = RuntimeSeal.RequireSha256(Convert.ToString(e["sha256"]), "Administrator helper digest"); } }
            if (digest == null || RuntimeSeal.Sha256(File.ReadAllBytes(path)) != digest) throw new InvalidDataException("Administrator helper integrity check failed."); return path;
        }
        private void Start(int expected)
        {
            string exe = RequireHelper(); ProcessStartInfo info = new ProcessStartInfo(exe, "--bridge --root \"" + root + "\""); info.UseShellExecute = false; info.CreateNoWindow = true; info.RedirectStandardInput = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true; info.StandardOutputEncoding = AdminProtocol.Utf8; info.StandardErrorEncoding = AdminProtocol.Utf8; info.WorkingDirectory = root;
            Process child = new Process(); child.StartInfo = info; if (!child.Start()) throw new InvalidOperationException("Administrator controller did not start."); bridge = child;
            Thread errors = new Thread(delegate() { try { using (StreamReader reader = child.StandardError) { char[] discard = new char[512]; while (reader.Read(discard, 0, discard.Length) != 0) { } } } catch { } }); errors.IsBackground = true; errors.Start();
            Thread writer = new Thread(delegate() { try { for (;;) { string text = null; lock (gate) { if (disposed || expected != generation || bridge != child) return; if (input.Count > 0) { text = input.Dequeue(); queuedBytes -= AdminProtocol.Utf8.GetByteCount(text); } } if (text == null) { available.WaitOne(250); continue; } child.StandardInput.WriteLine(text); child.StandardInput.Flush(); } } catch (Exception ex) { Fail(ex.Message, expected, child); } }); writer.IsBackground = true; writer.Start();
            Thread output = new Thread(delegate() { try { Stream stream = new BufferedStream(child.StandardOutput.BaseStream, 8192); for (;;) { string line = AdminProtocol.ReadLine(stream); if (line == null) break; Dictionary<string, object> m = AdminProtocol.Parse(line); string type = AdminProtocol.String(m, "type", 32); if (type == "ready") continue; if (type == "opened") { string opened = AdminProtocol.String(m, "sid", 64); lock (gate) { if (expected != generation || bridge != child) return; sid = opened; } } Post(line, expected); } } catch (Exception ex) { Fail(ex.Message, expected, child); } finally { try { dispatch(delegate() { Stop("Administrator controller ended", child, expected); }); } catch { } } }); output.IsBackground = true; output.Start();
        }
        private void Stop(string reason, Process expectedChild = null, int expectedGeneration = -1)
        {
            Process child; int current; string oldSid; lock (gate) { if ((expectedChild != null && bridge != expectedChild) || (expectedGeneration >= 0 && generation != expectedGeneration)) return; child = bridge; bridge = null; oldSid = sid; sid = null; openRequestId = null; input.Clear(); queuedBytes = 0; ids.Clear(); output.Clear(); outputBytes = 0; outputFailed = false; current = generation; generation++; available.Set(); }
            if (child != null) { try { child.StandardInput.Close(); } catch { } try { if (!child.WaitForExit(250)) child.Kill(); } catch { } try { child.Dispose(); } catch { } }
            if (oldSid != null && !disposed) Post(AdminProtocol.Serialize(AdminProtocol.Message("closed", oldSid, null, new Dictionary<string, object> { { "reason", reason } })), current + 1);
        }
        public void Dispose() { lock (gate) { if (disposed) return; disposed = true; completed = false; } Stop("window closed"); available.Dispose(); }
    }
}
