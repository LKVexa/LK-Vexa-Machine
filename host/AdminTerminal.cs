// Local, explicitly opened Administrator PowerShell terminal. No WebSocket listener and no host objects.
// ConPTY contract: https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace JA21Admin
{
    public static class AdminProtocol
    {
        public const int ControlBytes = 65536, FrameBytes = 524288, InputBytes = 8192, OutputBytes = 65536;
        public static readonly Encoding Utf8 = new UTF8Encoding(false, true);
        public static string RandomToken(int bytes) { byte[] b = new byte[bytes]; using (RandomNumberGenerator r = RandomNumberGenerator.Create()) r.GetBytes(b); StringBuilder s = new StringBuilder(); foreach (byte x in b) s.Append(x.ToString("x2", CultureInfo.InvariantCulture)); return s.ToString(); }
        public static string Serialize(object value) { JavaScriptSerializer j = new JavaScriptSerializer(); j.MaxJsonLength = FrameBytes; j.RecursionLimit = 10; string s = j.Serialize(value); if (Utf8.GetByteCount(s) > FrameBytes) throw new InvalidDataException("Administrator frame exceeds limit."); return s; }
        public static Dictionary<string, object> Parse(string text)
        {
            if (text == null || Utf8.GetByteCount(text) > FrameBytes) throw new InvalidDataException("Administrator frame exceeds limit.");
            new StrictJson(text).Run(); JavaScriptSerializer j = new JavaScriptSerializer(); j.MaxJsonLength = FrameBytes; j.RecursionLimit = 10;
            Dictionary<string, object> o = j.DeserializeObject(text) as Dictionary<string, object>; if (o == null) throw new InvalidDataException("Administrator envelope must be an object."); return o;
        }
        public static string String(Dictionary<string, object> o, string key, int max) { object v; if (!o.TryGetValue(key, out v) || !(v is string) || ((string)v).Length > max) throw new InvalidDataException("Invalid " + key + "."); return (string)v; }
        public static int Int(Dictionary<string, object> o, string key, int low, int high) { object v; if (!o.TryGetValue(key, out v) || (!(v is int) && !(v is long))) throw new InvalidDataException("Invalid integer " + key + "."); long n = Convert.ToInt64(v, CultureInfo.InvariantCulture); if (n < low || n > high) throw new InvalidDataException("Out of range " + key + "."); return (int)n; }
        public static void Keys(Dictionary<string, object> o, params string[] allowed) { foreach (string k in o.Keys) if (Array.IndexOf(allowed, k) < 0) throw new InvalidDataException("Unknown field " + k + "."); }
        public static Dictionary<string, object> Object(Dictionary<string, object> o, string key) { object v; if (!o.TryGetValue(key, out v) || !(v is Dictionary<string, object>)) throw new InvalidDataException("Invalid " + key + "."); return (Dictionary<string, object>)v; }
        public static Dictionary<string, object> Request(string text, string sid)
        {
            Dictionary<string, object> m = Parse(text); Keys(m, "v", "id", "op", "payload", "sid"); Int(m, "v", 1, 1);
            string id = String(m, "id", 64); if (!Regex.IsMatch(id, @"\A[A-Za-z0-9_-]{1,64}\z")) throw new InvalidDataException("Invalid request id.");
            string op = String(m, "op", 32); Dictionary<string, object> p = Object(m, "payload");
            if (op != "open" && (sid == null || String(m, "sid", 64) != sid)) throw new InvalidDataException("Stale Administrator session.");
            if (op != "delegate-result" && Utf8.GetByteCount(text) > ControlBytes) throw new InvalidDataException("Administrator control exceeds limit.");
            switch (op)
            {
                case "open": Keys(p, "cols", "rows"); if (m.ContainsKey("sid")) throw new InvalidDataException("Open cannot address an old session."); Int(p, "cols", 2, 400); Int(p, "rows", 1, 200); break;
                case "input": Keys(p, "text"); string input = String(p, "text", InputBytes); if (input.Length == 0 || input.IndexOf('\0') >= 0 || Utf8.GetByteCount(input) > InputBytes) throw new InvalidDataException("Input exceeds limit."); break;
                case "resize": Keys(p, "cols", "rows"); Int(p, "cols", 2, 400); Int(p, "rows", 1, 200); break;
                case "interrupt": case "close": Keys(p); break;
                case "delegate-result":
                    string requestId = String(p, "requestId", 64); if (!Regex.IsMatch(requestId, @"\A[A-Za-z0-9_-]{1,64}\z")) throw new InvalidDataException("Invalid delegate id.");
                    if (p.ContainsKey("error")) { Keys(p, "requestId", "error", "outcome"); String(p, "error", 256); if (String(p, "outcome", 16) != "UNKNOWN") throw new InvalidDataException("Invalid outcome."); }
                    else { Keys(p, "requestId", "code", "output", "truncated", "completion"); Int(p, "code", 0, 255); if (Utf8.GetByteCount(String(p, "output", OutputBytes)) > OutputBytes || !(p["truncated"] is bool) || String(p, "completion", 16) != "COMPLETED") throw new InvalidDataException("Invalid delegate completion."); }
                    break;
                default: throw new InvalidDataException("Unsupported Administrator operation.");
            }
            return m;
        }
        public static string ReadLine(Stream stream)
        {
            using (MemoryStream b = new MemoryStream()) { for (;;) { int v = stream.ReadByte(); if (v < 0) return b.Length == 0 ? null : FailLine(); if (v == 10) { byte[] bytes = b.ToArray(); int n = bytes.Length; if (n > 0 && bytes[n - 1] == 13) n--; return Utf8.GetString(bytes, 0, n); } if (b.Length >= FrameBytes) throw new InvalidDataException("Administrator line exceeds limit."); b.WriteByte((byte)v); } }
        }
        private static string FailLine() { throw new InvalidDataException("Incomplete Administrator line."); }
        public static void WriteFrame(Stream stream, string text) { byte[] b = Utf8.GetBytes(text); if (b.Length < 1 || b.Length > FrameBytes) throw new InvalidDataException("Frame limit."); byte[] h = BitConverter.GetBytes(b.Length); lock (stream) { stream.Write(h, 0, 4); stream.Write(b, 0, b.Length); stream.Flush(); } }
        public static string ReadFrame(Stream stream) { byte[] h = new byte[4]; int first = stream.Read(h, 0, 4); if (first == 0) return null; Exact(stream, h, first, 4); int n = BitConverter.ToInt32(h, 0); if (n < 1 || n > FrameBytes) throw new InvalidDataException("Frame limit."); byte[] b = new byte[n]; Exact(stream, b, 0, n); return Utf8.GetString(b); }
        private static void Exact(Stream stream, byte[] b, int off, int n) { while (off < n) { int got = stream.Read(b, off, n - off); if (got == 0) throw new EndOfStreamException(); off += got; } }
        public static Dictionary<string, object> Message(string type, string sid, string id, object payload) { Dictionary<string, object> m = new Dictionary<string, object> { {"v",1},{"type",type},{"payload",payload} }; if (sid != null) m.Add("sid", sid); if (id != null) m.Add("id", id); return m; }

        private sealed class StrictJson
        {
            private readonly string s; private int i; private int tokens;
            public StrictJson(string text) { s = text; }
            private void Bad() { throw new InvalidDataException("Invalid or duplicate-key JSON."); }
            private void Ws() { while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n')) i++; }
            public void Run() { Value(0); Ws(); if (i != s.Length) Bad(); }
            private string Text() { int start = i++; while (i < s.Length) { char c = s[i++]; if (c == '"') { JavaScriptSerializer j = new JavaScriptSerializer(); return j.Deserialize<string>(s.Substring(start, i - start)); } if (c < 32) Bad(); if (c == '\\') { if (i >= s.Length) Bad(); char e = s[i++]; if (e == 'u') { for (int n = 0; n < 4; n++) { if (i >= s.Length || !Uri.IsHexDigit(s[i++])) Bad(); } } else if ("\"\\/bfnrt".IndexOf(e) < 0) Bad(); } } Bad(); return null; }
            private void Value(int depth)
            {
                if (depth > 8 || ++tokens > 4096) Bad(); Ws(); if (i >= s.Length) Bad(); char c = s[i];
                if (c == '{') { i++; Ws(); HashSet<string> keys = new HashSet<string>(StringComparer.Ordinal); if (i < s.Length && s[i] == '}') { i++; return; } for (;;) { Ws(); if (i >= s.Length || s[i] != '"') Bad(); if (!keys.Add(Text())) Bad(); Ws(); if (i >= s.Length || s[i++] != ':') Bad(); Value(depth + 1); Ws(); if (i >= s.Length) Bad(); if (s[i] == '}') { i++; return; } if (s[i++] != ',') Bad(); } }
                if (c == '[') { i++; Ws(); if (i < s.Length && s[i] == ']') { i++; return; } for (;;) { Value(depth + 1); Ws(); if (i >= s.Length) Bad(); if (s[i] == ']') { i++; return; } if (s[i++] != ',') Bad(); } }
                if (c == '"') { Text(); return; }
                foreach (string word in new string[] { "true", "false", "null" }) if (i + word.Length <= s.Length && s.Substring(i, word.Length) == word) { i += word.Length; return; }
                Match m = Regex.Match(s.Substring(i, Math.Min(64, s.Length - i)), @"\A-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?"); if (!m.Success) Bad(); double v; if (!Double.TryParse(m.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out v) || Double.IsNaN(v) || Double.IsInfinity(v)) Bad(); i += m.Length;
            }
        }
    }

    public sealed class ElevatedController : IDisposable
    {
        private NamedPipeServerStream pipe; private Process helper; private string sid; private bool stopped; private readonly Action<string> emit; private readonly object gate = new object();
        public ElevatedController(Action<string> output) { emit = output; }
        public string SessionId { get { return sid; } }
        public void Submit(string text)
        {
            Dictionary<string, object> m = AdminProtocol.Request(text, sid); string op = (string)m["op"];
            if (op == "open") { if (pipe != null) throw new InvalidOperationException("An Administrator terminal is already open."); Open(m); return; }
            if (stopped || pipe == null || !pipe.IsConnected) throw new InvalidOperationException("Administrator terminal is closed."); AdminProtocol.WriteFrame(pipe, text); if (op == "close") Dispose();
        }
        private void Open(Dictionary<string, object> m)
        {
            Native.RequireLocalIpc(); // Fail before any UAC prompt when this process cannot use its own local pipe.
            string name = "JA21-Admin-" + AdminProtocol.RandomToken(32), nonce = AdminProtocol.RandomToken(32); SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
            PipeSecurity security = new PipeSecurity(); security.SetAccessRuleProtection(true, false); security.AddAccessRule(new PipeAccessRule(user, PipeAccessRights.FullControl, AccessControlType.Allow));
            pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security);
            string exe = Assembly.GetExecutingAssembly().Location; if (Path.GetFileName(exe) != "JA21-Admin-Terminal.exe") throw new InvalidOperationException("Controller must run in the packaged helper executable.");
            ProcessStartInfo info = new ProcessStartInfo(exe, "--helper --pipe " + name + " --parent " + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) + " --nonce " + nonce);
            info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden; info.WorkingDirectory = Path.GetDirectoryName(exe);
            helper = Process.Start(info); if (helper == null) throw new InvalidOperationException("Administrator helper did not start.");
            IAsyncResult pending = pipe.BeginWaitForConnection(null, null); if (!pending.AsyncWaitHandle.WaitOne(120000)) throw new TimeoutException("Administrator helper connection timed out."); pipe.EndWaitForConnection(pending);
            uint pid; if (!Native.GetNamedPipeClientProcessId(pipe.SafePipeHandle, out pid) || pid != (uint)helper.Id || !Native.SameImage(pid, exe)) throw new InvalidDataException("Administrator helper process identity mismatch.");
            Dictionary<string, object> hello = AdminProtocol.Parse(AdminProtocol.ReadFrame(pipe)); AdminProtocol.Keys(hello, "v", "type", "nonce", "elevated", "sid"); AdminProtocol.Int(hello, "v", 1, 1);
            if (AdminProtocol.String(hello, "type", 32) != "helper.hello" || !Native.FixedEqual(AdminProtocol.String(hello, "nonce", 64), nonce) || !(hello["elevated"] is bool) || !(bool)hello["elevated"]) throw new InvalidDataException("Administrator helper authentication failed.");
            sid = AdminProtocol.String(hello, "sid", 64); if (!Regex.IsMatch(sid, @"\A[0-9a-f]{32}\z")) throw new InvalidDataException("Invalid session token.");
            m.Add("sid", sid); AdminProtocol.WriteFrame(pipe, AdminProtocol.Serialize(m));
            Thread output = new Thread(delegate() { bool opened = false; try { for (;;) { string frame = AdminProtocol.ReadFrame(pipe); if (frame == null) break; Dictionary<string, object> record = AdminProtocol.Parse(frame); if (Convert.ToString(record["type"]) == "opened") opened = true; lock (gate) if (!stopped) emit(frame); } if (!opened) SafeEmit("error", "Administrator helper closed before PowerShell startup was confirmed."); } catch (Exception ex) { SafeEmit("error", ex.Message); } finally { Dispose(); } }); output.IsBackground = true; output.Start();
        }
        private void SafeEmit(string type, string message) { try { lock (gate) if (!stopped) emit(AdminProtocol.Serialize(AdminProtocol.Message(type, sid, null, new Dictionary<string, object> { { "message", message.Length > 256 ? message.Substring(0, 256) : message } }))); } catch { } }
        public void Dispose() { lock (gate) { if (stopped) return; stopped = true; if (pipe != null) { try { pipe.Dispose(); } catch { } } } if (helper != null) { try { if (helper.HasExited) helper.Dispose(); } catch { } } }
    }

    internal sealed class DelegatePending
    {
        public string Id; public int Target; public ManualResetEventSlim Ready = new ManualResetEventSlim(false); public Dictionary<string, object> Result;
    }
    internal sealed class ElevatedSession : IDisposable
    {
        private readonly NamedPipeClientStream control; private readonly string sid; private readonly string delegateName = "JA21-Delegate-" + AdminProtocol.RandomToken(32), delegateNonce = AdminProtocol.RandomToken(32);
        private readonly Dictionary<string, DelegatePending> pending = new Dictionary<string, DelegatePending>(); private readonly object sync = new object(); private readonly bool[] targets = new bool[3]; private ConPty terminal; private volatile bool closed; private int disposeState;
        public ElevatedSession(NamedPipeClientStream pipe, string token) { control = pipe; sid = token; }
        private void Send(string type, string id, object payload) { if (!closed) AdminProtocol.WriteFrame(control, AdminProtocol.Serialize(AdminProtocol.Message(type, sid, id, payload))); }
        public void Run(Dictionary<string, object> open)
        {
            Dictionary<string, object> geometry = AdminProtocol.Object(open, "payload"); int cols = AdminProtocol.Int(geometry, "cols", 2, 400), rows = AdminProtocol.Int(geometry, "rows", 1, 200);
            object startGate = new object(); List<string> early = new List<string>(); int earlyBytes = 0; bool started = false, overflow = false;
            terminal = new ConPty(cols, rows, DelegateScript(delegateName, delegateNonce), delegate(string text) { try { lock (startGate) { if (!started) { earlyBytes += AdminProtocol.Utf8.GetByteCount(text); if (earlyBytes > 65536) { overflow = true; return; } early.Add(text); return; } Send("output", null, new Dictionary<string, object> { { "text", text } }); } } catch { } }, delegate(int code) { try { Send("closed", null, new Dictionary<string, object> { { "reason", "PowerShell exited" }, { "code", code }, { "elevated", true } }); } catch { } Dispose(); try { control.Dispose(); } catch { } });
            Thread delegation = new Thread(DelegateLoop); delegation.IsBackground = true; delegation.Start();
            lock (startGate) { if (overflow) throw new InvalidDataException("PowerShell output exceeded the bounded startup queue."); Send("opened", (string)open["id"], new Dictionary<string, object> { { "cols", cols }, { "rows", rows }, { "elevated", true } }); started = true; foreach (string text in early) Send("output", null, new Dictionary<string, object> { { "text", text } }); early.Clear(); }
            try
            {
                for (;;) { string line = AdminProtocol.ReadFrame(control); if (line == null) break; Dictionary<string, object> m = AdminProtocol.Request(line, sid), p = AdminProtocol.Object(m, "payload"); string op = (string)m["op"];
                    if (op == "input") terminal.Write(AdminProtocol.String(p, "text", AdminProtocol.InputBytes));
                    else if (op == "resize") terminal.Resize(AdminProtocol.Int(p, "cols", 2, 400), AdminProtocol.Int(p, "rows", 1, 200));
                    else if (op == "interrupt") terminal.Write("\u0003");
                    else if (op == "close") break;
                    else if (op == "delegate-result") { string id = (string)p["requestId"]; lock (sync) { DelegatePending job; if (!pending.TryGetValue(id, out job)) throw new InvalidDataException("Unknown or late delegate response."); job.Result = p; job.Ready.Set(); } }
                    else throw new InvalidDataException("Unsupported operation in active session.");
                    Send("ack", (string)m["id"], new Dictionary<string, object> { { "operation", op } });
                }
            }
            catch (IOException) { if (!closed) throw; }
            catch (ObjectDisposedException) { if (!closed) throw; }
            finally { try { Send("closed", null, new Dictionary<string, object> { { "reason", "closed" } }); } catch { } Dispose(); }
        }
        private void DelegateLoop()
        {
            while (!closed)
            {
                try
                {
                    PipeSecurity security = new PipeSecurity(); security.SetAccessRuleProtection(true, false); security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
                    using (NamedPipeServerStream pipe = new NamedPipeServerStream(delegateName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security))
                    {
                        IAsyncResult wait = pipe.BeginWaitForConnection(null, null); while (!wait.AsyncWaitHandle.WaitOne(250)) if (closed) return; pipe.EndWaitForConnection(wait);
                        uint pid; if (!Native.GetNamedPipeClientProcessId(pipe.SafePipeHandle, out pid) || terminal == null || pid != terminal.ProcessId) throw new InvalidDataException("Delegate client is not the owned PowerShell process.");
                        string line = AdminProtocol.ReadFrame(pipe); Dictionary<string, object> q = AdminProtocol.Parse(line); AdminProtocol.Keys(q, "nonce", "requestId", "terminal", "command");
                        if (!Native.FixedEqual(AdminProtocol.String(q, "nonce", 64), delegateNonce)) throw new InvalidDataException("Delegate authentication failed.");
                        int target = AdminProtocol.Int(q, "terminal", 1, 2); string command = AdminProtocol.String(q, "command", 4096), id = AdminProtocol.String(q, "requestId", 64);
                        if (command.Length == 0 || Regex.IsMatch(command, @"[\x00-\x1f\x7f-\x9f]") || AdminProtocol.Utf8.GetByteCount(command) > 8192 || !Regex.IsMatch(id, @"\A[A-Za-z0-9_-]{1,64}\z")) throw new InvalidDataException("Invalid delegated command.");
                        DelegatePending job = new DelegatePending { Id = id, Target = target }; lock (sync) { if (targets[target] || pending.ContainsKey(id)) throw new InvalidOperationException("A delegated command is already running for this terminal."); targets[target] = true; pending.Add(id, job); }
                        try
                        {
                            Send("delegate", id, new Dictionary<string, object> { { "requestId", id }, { "terminal", target }, { "command", command } });
                            if (!job.Ready.Wait(45000) || job.Result == null) job.Result = new Dictionary<string, object> { { "requestId", id }, { "error", "Delegated completion was not confirmed; outcome is UNKNOWN. Nothing was retried." }, { "outcome", "UNKNOWN" } };
                            AdminProtocol.WriteFrame(pipe, AdminProtocol.Serialize(job.Result));
                        }
                        finally { lock (sync) { pending.Remove(id); targets[target] = false; } job.Ready.Dispose(); }
                    }
                }
                catch (Exception ex) { if (!closed) try { Send("error", null, new Dictionary<string, object> { { "message", ex.Message.Length > 256 ? ex.Message.Substring(0, 256) : ex.Message } }); } catch { } }
            }
        }
        public void Dispose() { if (Interlocked.Exchange(ref disposeState, 1) != 0) return; closed = true; lock (sync) { foreach (DelegatePending p in pending.Values) p.Ready.Set(); } if (terminal != null) terminal.Dispose(); }
        internal static string DelegateScript(string pipe, string nonce)
        {
            // The command supplied by the user is data in the request, never interpolated into this bootstrap.
            return "$ErrorActionPreference='Continue'; [Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); " +
                "if(Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue){Set-PSReadLineOption -HistorySaveStyle SaveNothing}; " +
                "function Invoke-JA21Terminal { [CmdletBinding()] param([Parameter(Mandatory=$true)][ValidateSet(1,2)][int]$Terminal,[Parameter(Mandatory=$true)][string]$Command) " +
                "$ErrorActionPreference='Stop';if($Command.Length -gt 4096 -or [Text.Encoding]::UTF8.GetByteCount($Command) -gt 8192 -or $Command -match '[\x00-\x1f\x7f-\x9f]'){throw 'Command exceeds JA21 limit or contains control characters'}; $ja21RequestId=[Guid]::NewGuid().ToString('N'); " +
                "$p=New-Object IO.Pipes.NamedPipeClientStream('.', '" + pipe + "', [IO.Pipes.PipeDirection]::InOut); try{$p.Connect(5000); " +
                "$q=@{nonce='" + nonce + "';requestId=$ja21RequestId;terminal=$Terminal;command=$Command}|ConvertTo-Json -Compress -Depth 6; " +
                "$b=[Text.Encoding]::UTF8.GetBytes($q); $h=[BitConverter]::GetBytes([int]$b.Length);$p.Write($h,0,4);$p.Write($b,0,$b.Length);$p.Flush(); " +
                "$h=New-Object byte[] 4;$o=0;while($o -lt 4){$n=$p.Read($h,$o,4-$o);if($n -le 0){throw 'Delegation disconnected; outcome UNKNOWN'};$o+=$n};$len=[BitConverter]::ToInt32($h,0);if($len -lt 1 -or $len -gt 524288){throw 'Invalid JA21 result frame'}; " +
                "$b=New-Object byte[] $len;$o=0;while($o -lt $len){$n=$p.Read($b,$o,$len-$o);if($n -le 0){throw 'Delegation disconnected; outcome UNKNOWN'};$o+=$n};$result=[Text.Encoding]::UTF8.GetString($b)|ConvertFrom-Json; " +
                "if($result.requestId -ne $ja21RequestId){throw 'JA21 result identifier mismatch'};if($result.outcome -eq 'UNKNOWN'){throw $result.error};if($result.completion -ne 'COMPLETED'){throw 'JA21 completion was not confirmed'};return $result }catch{throw ('JA21 delegated outcome is UNKNOWN; nothing was retried. '+$_.Exception.Message)}finally{$p.Dispose()} }; " +
                "Write-Host 'JA21 Administrator PowerShell. Invoke-JA21Terminal -Terminal 1 -Command \"xpu info\" delegates to XPU terminal 1; use -Terminal 2 for terminal 2.';";
        }
    }

    internal sealed class ConPty : IDisposable
    {
        private IntPtr pseudo, job, process; private FileStream input, output; private volatile bool stopped; private int disposeState; private readonly object lifetime = new object(); private Thread reader; public uint ProcessId { get; private set; }
        public ConPty(int cols, int rows, string script, Action<string> onOutput, Action<int> onExit)
        {
            IntPtr ir = IntPtr.Zero, iw = IntPtr.Zero, or = IntPtr.Zero, ow = IntPtr.Zero, attributes = IntPtr.Zero, environment = IntPtr.Zero; Native.PROCESS_INFORMATION pi = new Native.PROCESS_INFORMATION();
            try
            {
                Native.Check(Native.CreatePipe(out ir, out iw, IntPtr.Zero, 0)); Native.Check(Native.CreatePipe(out or, out ow, IntPtr.Zero, 0));
                int hr = Native.CreatePseudoConsole(new Native.COORD((short)cols, (short)rows), ir, ow, 0, out pseudo); if (hr < 0) Marshal.ThrowExceptionForHR(hr);
                input = new FileStream(new SafeFileHandle(iw, true), FileAccess.Write, 4096, false); iw = IntPtr.Zero; output = new FileStream(new SafeFileHandle(or, true), FileAccess.Read, 4096, false); or = IntPtr.Zero;
                IntPtr size = IntPtr.Zero; Native.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size); attributes = Marshal.AllocHGlobal(size); Native.Check(Native.InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); Native.Check(Native.UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x00020016), pseudo, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
                Native.STARTUPINFOEX si = new Native.STARTUPINFOEX(); si.StartupInfo.cb = Marshal.SizeOf(typeof(Native.STARTUPINFOEX)); si.lpAttributeList = attributes;
                // A console host with redirected stdio otherwise passes those pipes to the child, even with
                // handle inheritance disabled. Null standard handles + STARTF_USESTDHANDLES force ConPTY.
                // Microsoft terminal maintainers document this at discussions/15814 in microsoft/terminal.
                si.StartupInfo.dwFlags = 0x00000100;
                string exe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"); if (!File.Exists(exe)) throw new FileNotFoundException("Windows PowerShell is unavailable.");
                StringBuilder command = new StringBuilder("\"" + exe + "\" -NoLogo -NoProfile -NoExit -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(script)));
                environment = Native.PowerShellEnvironment(exe);
                Native.Check(Native.CreateProcess(exe, command, IntPtr.Zero, IntPtr.Zero, false, 0x00080000 | 0x00000004 | 0x00000400, environment, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ref si, out pi)); process = pi.hProcess; ProcessId = pi.dwProcessId;
                job = Native.CreateJobObject(IntPtr.Zero, null); Native.Check(job != IntPtr.Zero); Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new Native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION(); limits.BasicLimitInformation.LimitFlags = 0x00002000;
                int bytes = Marshal.SizeOf(limits); IntPtr data = Marshal.AllocHGlobal(bytes); try { Marshal.StructureToPtr(limits, data, false); Native.Check(Native.SetInformationJobObject(job, 9, data, (uint)bytes)); } finally { Marshal.FreeHGlobal(data); }
                Native.Check(Native.AssignProcessToJobObject(job, process)); if (Native.ResumeThread(pi.hThread) == 0xffffffff) Native.Check(false);
                reader = new Thread(delegate() { byte[] b = new byte[4096]; Decoder decoder = AdminProtocol.Utf8.GetDecoder(); char[] c = new char[4096]; for (;;) { try { int n = output.Read(b, 0, b.Length); if (n == 0) break; int count = decoder.GetChars(b, 0, n, c, 0, false); if (!stopped && count > 0) onOutput(new string(c, 0, count)); } catch { break; } } }); reader.IsBackground = true; reader.Start();
                Thread exited = new Thread(delegate() { while (!stopped) { uint wait = Native.WaitForSingleObject(process, 250); if (wait == 0) { uint code; if (Native.GetExitCodeProcess(process, out code) && !stopped) onExit((int)Math.Min(255, code)); return; } if (wait == 0xffffffff) return; } }); exited.IsBackground = true; exited.Start();
            }
            catch { if (pi.hProcess != IntPtr.Zero) Native.TerminateProcess(pi.hProcess, 70); Dispose(); throw; }
            finally { if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment); if (pi.hThread != IntPtr.Zero) Native.CloseHandle(pi.hThread); if (ir != IntPtr.Zero) Native.CloseHandle(ir); if (ow != IntPtr.Zero) Native.CloseHandle(ow); if (iw != IntPtr.Zero) Native.CloseHandle(iw); if (or != IntPtr.Zero) Native.CloseHandle(or); if (attributes != IntPtr.Zero) { Native.DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); } }
        }
        public void Write(string text) { if (stopped) throw new ObjectDisposedException("ConPTY"); byte[] b = AdminProtocol.Utf8.GetBytes(text); lock (input) { input.Write(b, 0, b.Length); input.Flush(); } }
        public void Resize(int cols, int rows) { lock (lifetime) { if (stopped) throw new ObjectDisposedException("ConPTY"); int hr = Native.ResizePseudoConsole(pseudo, new Native.COORD((short)cols, (short)rows)); if (hr < 0) Marshal.ThrowExceptionForHR(hr); } }
        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposeState, 1) != 0) return; stopped = true; if (job != IntPtr.Zero) { Native.TerminateJobObject(job, 70); Native.CloseHandle(job); job = IntPtr.Zero; } if (input != null) { try { input.Dispose(); } catch { } }
            IntPtr handle; lock (lifetime) { handle = pseudo; pseudo = IntPtr.Zero; } if (handle != IntPtr.Zero) { Thread close = new Thread(delegate() { Native.ClosePseudoConsole(handle); }); close.IsBackground = true; close.Start(); close.Join(2000); }
            if (reader != null) reader.Join(1000); if (output != null) { try { output.Dispose(); } catch { } } if (process != IntPtr.Zero) { Native.CloseHandle(process); process = IntPtr.Zero; }
        }
    }

    internal static class Native
    {
        [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X, Y; public COORD(short x, short y) { X = x; Y = y; } }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct STARTUPINFO { public int cb; public IntPtr lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
        [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
        [StructLayout(LayoutKind.Sequential)] public struct BASIC_LIMIT { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
        [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
        [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public BASIC_LIMIT BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint id);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint id);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr security, uint size);
        [DllImport("kernel32.dll")] public static extern int CreatePseudoConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr pseudo);
        [DllImport("kernel32.dll")] public static extern int ResizePseudoConsole(IntPtr pseudo, COORD size);
        [DllImport("kernel32.dll")] public static extern void ClosePseudoConsole(IntPtr pseudo);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] public static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateProcessW")] public static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, [In] ref STARTUPINFOEX info, out PROCESS_INFORMATION process);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr information, uint bytes);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
        [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
        public static void Check(bool ok) { if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
        public static bool SameImage(uint pid, string expected) { IntPtr p = OpenProcess(0x1000, false, pid); if (p == IntPtr.Zero) return false; try { StringBuilder name = new StringBuilder(32768); uint size = 32768; return QueryFullProcessImageName(p, 0, name, ref size) && String.Equals(Path.GetFullPath(name.ToString()), Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase); } finally { CloseHandle(p); } }
        public static bool FixedEqual(string a, string b) { if (a == null || b == null || a.Length != b.Length) return false; int diff = 0; for (int n=0;n<a.Length;n++) diff |= a[n] ^ b[n]; return diff == 0; }
        public static IntPtr PowerShellEnvironment(string executable)
        {
            SortedDictionary<string, string> values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables()) { string key = Convert.ToString(entry.Key), value = Convert.ToString(entry.Value); if (key.Length > 0 && key.IndexOf('=') < 0 && key.IndexOf('\0') < 0 && value.IndexOf('\0') < 0) values[key] = value; }
            // Use Windows PowerShell's ordinary module locations rather than inheriting an unrelated
            // launcher/runtime's PSModulePath. Execution policy and publisher trust are unchanged.
            values["PSModulePath"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), @"WindowsPowerShell\Modules") + ";" + Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"WindowsPowerShell\Modules") + ";" + Path.Combine(Path.GetDirectoryName(executable), "Modules");
            StringBuilder block = new StringBuilder(); foreach (KeyValuePair<string, string> item in values) block.Append(item.Key).Append('=').Append(item.Value).Append('\0'); block.Append('\0'); return Marshal.StringToHGlobalUni(block.ToString());
        }
        public static void RequireLocalIpc()
        {
            string name = "JA21-IpcCheck-" + AdminProtocol.RandomToken(32); Exception failure = null;
            PipeSecurity security = new PipeSecurity(); security.SetAccessRuleProtection(true, false); security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
            using (NamedPipeServerStream server = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 1024, 1024, security))
            {
                IAsyncResult waiting = server.BeginWaitForConnection(null, null);
                Thread client = new Thread(delegate() { try { using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut)) { pipe.Connect(1000); pipe.WriteByte(21); pipe.Flush(); if (pipe.ReadByte() != 22) throw new InvalidDataException("Local IPC response mismatch."); } } catch (Exception ex) { failure = ex; } }); client.IsBackground = true; client.Start();
                if (!waiting.AsyncWaitHandle.WaitOne(1500)) throw new InvalidOperationException("Windows denied local named-pipe IPC in this execution environment. Administrator startup was stopped before requesting UAC consent.");
                server.EndWaitForConnection(waiting); uint pid; if (!GetNamedPipeClientProcessId(server.SafePipeHandle, out pid) || pid != (uint)Process.GetCurrentProcess().Id || server.ReadByte() != 21) throw new InvalidDataException("Local IPC identity check failed."); server.WriteByte(22); server.Flush(); if (!client.Join(1000) || failure != null) throw new InvalidOperationException("Local IPC preflight did not complete; Administrator startup was stopped before UAC.");
            }
        }
    }

    public static class Program
    {
        public static int Main(string[] args)
        {
            try { if (args.Length == 1 && args[0] == "--self-test") return SelfTest(); if (args.Length == 1 && args[0] == "--conpty-test") return ConPtyTest(); if (args.Length == 1 && args[0] == "--pipe-test") return PipeTest(); if (args.Length == 5 && args[0] == "--pipe-peer") return PipePeer(args); if (args.Length > 0 && args[0] == "--bridge") return Bridge(args); if (args.Length == 7 && args[0] == "--helper") return Helper(args); throw new InvalidDataException("Use the packaged JA21 console to explicitly open this terminal."); }
            catch (Exception ex) { try { Console.Error.WriteLine(ex.Message); } catch { } return 70; }
        }
        private static int Bridge(string[] args)
        {
            if (args.Length != 3 || args[1] != "--root") throw new InvalidDataException("Bridge requires a package root."); string root = Path.GetFullPath(args[2]), exe = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
            if (!String.Equals(exe, Path.Combine(root, "tools", "JA21-Admin-Terminal.exe"), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Helper is outside the selected package root.");
            Stream stdout = Console.OpenStandardOutput(); Action<string> emit = delegate(string text) { byte[] b = AdminProtocol.Utf8.GetBytes(text + "\n"); lock (stdout) { stdout.Write(b, 0, b.Length); stdout.Flush(); } };
            using (ElevatedController controller = new ElevatedController(emit))
            {
                emit(AdminProtocol.Serialize(AdminProtocol.Message("ready", null, null, new Dictionary<string, object> { { "available", true }, { "message", "UAC consent is required when opening the Administrator terminal." } })));
                Stream stdin = new BufferedStream(Console.OpenStandardInput(), 8192); for (;;) { string line = AdminProtocol.ReadLine(stdin); if (line == null) break; try { controller.Submit(line); } catch (Exception ex) { emit(AdminProtocol.Serialize(AdminProtocol.Message("error", controller.SessionId, null, new Dictionary<string, object> { { "message", ex.Message.Length > 256 ? ex.Message.Substring(0, 256) : ex.Message } }))); controller.Dispose(); return 70; } }
            }
            return 0;
        }
        private static int Helper(string[] args)
        {
            if (args[1] != "--pipe" || args[3] != "--parent" || args[5] != "--nonce" || !Regex.IsMatch(args[2], @"\AJA21-Admin-[0-9a-f]{64}\z") || !Regex.IsMatch(args[6], @"\A[0-9a-f]{64}\z")) throw new InvalidDataException("Invalid helper rendezvous.");
            uint parent; if (!UInt32.TryParse(args[4], NumberStyles.None, CultureInfo.InvariantCulture, out parent) || parent == 0) throw new InvalidDataException("Invalid bridge process.");
            WindowsPrincipal principal = new WindowsPrincipal(WindowsIdentity.GetCurrent()); if (!principal.IsInRole(WindowsBuiltInRole.Administrator)) throw new InvalidOperationException("Administrator consent was not granted.");
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", args[2], PipeDirection.InOut, PipeOptions.None))
            {
                pipe.Connect(10000); uint pid; if (!Native.GetNamedPipeServerProcessId(pipe.SafePipeHandle, out pid) || pid != parent || !Native.SameImage(pid, Assembly.GetExecutingAssembly().Location)) throw new InvalidDataException("Bridge process identity mismatch.");
                string sid = AdminProtocol.RandomToken(16); AdminProtocol.WriteFrame(pipe, AdminProtocol.Serialize(new Dictionary<string, object> { { "v", 1 }, { "type", "helper.hello" }, { "nonce", args[6] }, { "sid", sid }, { "elevated", true } }));
                Dictionary<string, object> open = AdminProtocol.Parse(AdminProtocol.ReadFrame(pipe)); if ((string)open["op"] != "open" || (string)open["sid"] != sid) throw new InvalidDataException("Invalid authenticated open.");
                // Controller added sid after validating the public open; remove it for the same strict validation here.
                open.Remove("sid"); AdminProtocol.Request(AdminProtocol.Serialize(open), null); open.Add("sid", sid);
                using (ElevatedSession session = new ElevatedSession(pipe, sid)) session.Run(open);
            }
            return 0;
        }
        private static int SelfTest()
        {
            int assertions = 0; string sid = "0123456789abcdef0123456789abcdef";
            string[] good = { "{\"v\":1,\"id\":\"a\",\"op\":\"open\",\"payload\":{\"cols\":80,\"rows\":24}}", "{\"v\":1,\"id\":\"a\",\"sid\":\""+sid+"\",\"op\":\"input\",\"payload\":{\"text\":\"xpu info\\r\"}}", "{\"v\":1,\"id\":\"a\",\"sid\":\""+sid+"\",\"op\":\"interrupt\",\"payload\":{}}", "{\"v\":1,\"id\":\"a\",\"sid\":\""+sid+"\",\"op\":\"delegate-result\",\"payload\":{\"requestId\":\"d1\",\"code\":0,\"output\":\"done\",\"truncated\":false,\"completion\":\"COMPLETED\"}}" };
            foreach (string text in good) { AdminProtocol.Request(text, sid); assertions++; }
            string[] bad = { "{\"v\":1,\"v\":1}", "{\"v\":1,\"id\":\"a\",\"op\":\"exec\",\"payload\":{}}", good[1].Replace(sid, "bad"), good[0].Replace("80", "401"), good[0].Replace("24", "0"), good[1].Replace("xpu info\\r", "\\u0000"), good[2].Replace("{}", "{\"extra\":1}"), "{\"x\":1e999}", "[[[[[[[[[[1]]]]]]]]]]", good[0].Replace("\"a\"", "\"bad space\"") };
            foreach (string text in bad) { bool refused = false; try { AdminProtocol.Request(text, sid); } catch { refused = true; } if (!refused) throw new Exception("Unsafe fixture accepted."); assertions++; }
            using (MemoryStream stream = new MemoryStream()) { AdminProtocol.WriteFrame(stream, good[0]); stream.Position = 0; if (AdminProtocol.ReadFrame(stream) != good[0]) throw new Exception("Frame round trip failed."); assertions++; }
            if (Marshal.SizeOf(typeof(Native.STARTUPINFOEX)) != 112 || Marshal.SizeOf(typeof(Native.COORD)) != 4) throw new Exception("Unexpected x64 ConPTY structure layout."); assertions += 2;
            if (Native.FixedEqual("a", "b") || !Native.FixedEqual("abc", "abc")) throw new Exception("Authentication comparison failed."); assertions += 2;
            Console.WriteLine(AdminProtocol.Serialize(new Dictionary<string, object> { { "status", "PASS" }, { "assertions", assertions }, { "uacStarted", false }, { "conPtyStarted", false }, { "scope", "Strict JSON, session fences, commands, framing and x64 structure fixtures only" } })); return 0;
        }
        private static int ConPtyTest()
        {
            string name = "JA21-Diagnostic-" + AdminProtocol.RandomToken(32), nonce = AdminProtocol.RandomToken(32); object gate = new object(); StringBuilder output = new StringBuilder(); ManualResetEventSlim exited = new ManualResetEventSlim(false);
            PipeSecurity security = new PipeSecurity(); security.SetAccessRuleProtection(true, false); security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
            using (NamedPipeServerStream pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security))
            using (ConPty terminal = new ConPty(80, 24, ElevatedSession.DelegateScript(name, nonce) + "Write-Output ('JA21-'+'BOOT-'+(2+3)+[char]0x03A9);", delegate(string text) { lock (gate) { if (output.Length + text.Length > 262144) throw new InvalidDataException("Diagnostic output limit."); output.Append(text); } }, delegate(int code) { exited.Set(); }))
            {
                WaitText(output, gate, "JA21-BOOT-5\u03a9"); terminal.Resize(96, 32);
                terminal.Write("Write-Output ('JA21-'+'INPUT-'+(7*9))\r"); WaitText(output, gate, "JA21-INPUT-63");
                IAsyncResult connected = pipe.BeginWaitForConnection(null, null);
                terminal.Write("$ja21Result=Invoke-JA21Terminal -Terminal 1 -Command 'xpu info';Write-Output ('JA21-'+'DELEGATE-'+$ja21Result.code+':'+$ja21Result.output)\r");
                if (!connected.AsyncWaitHandle.WaitOne(10000)) { string captured; lock (gate) captured = output.ToString(); if (captured.Length > 16384) captured = captured.Substring(captured.Length - 16384); throw new TimeoutException("Diagnostic delegation did not connect; captured=" + AdminProtocol.Serialize(captured)); } pipe.EndWaitForConnection(connected);
                uint pid; if (!Native.GetNamedPipeClientProcessId(pipe.SafePipeHandle, out pid) || pid != terminal.ProcessId) throw new InvalidDataException("Diagnostic PowerShell pipe process mismatch.");
                Dictionary<string, object> request = AdminProtocol.Parse(AdminProtocol.ReadFrame(pipe)); if (!Native.FixedEqual(AdminProtocol.String(request, "nonce", 64), nonce) || AdminProtocol.Int(request, "terminal", 1, 2) != 1 || AdminProtocol.String(request, "command", 4096) != "xpu info") throw new InvalidDataException("Diagnostic delegation request mismatch.");
                AdminProtocol.WriteFrame(pipe, AdminProtocol.Serialize(new Dictionary<string, object> { { "requestId", request["requestId"] }, { "code", 0 }, { "output", "fixture-confirmed" }, { "truncated", false }, { "completion", "COMPLETED" } }));
                WaitText(output, gate, "JA21-DELEGATE-0:fixture-confirmed"); terminal.Write("exit 0\r"); if (!exited.Wait(10000)) throw new TimeoutException("Owned diagnostic PowerShell did not exit.");
            }
            bool elevated = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
            Console.WriteLine(AdminProtocol.Serialize(new Dictionary<string, object> { { "status", "PASS" }, { "checks", new string[] { "real PowerShell ConPTY startup", "UTF8 Unicode output", "interactive arithmetic input", "ResizePseudoConsole", "actual named-pipe client PID and nonce", "Invoke-JA21Terminal request/response using fixture result", "owned PowerShell exit and job cleanup" } }, { "uacStarted", false }, { "processAdministratorRole", elevated }, { "elevatedStartupVerified", false }, { "delegateResultFixture", true }, { "scope", "Actual Windows ConPTY and PowerShell using the current process token; delegated computation response is a controlled fixture, not a live XPU result." } })); return 0;
        }
        private static void WaitText(StringBuilder output, object gate, string expected) { Stopwatch deadline = Stopwatch.StartNew(); while (deadline.ElapsedMilliseconds < 10000) { lock (gate) if (output.ToString().IndexOf(expected, StringComparison.Ordinal) >= 0) return; Thread.Sleep(25); } string captured; lock (gate) captured = output.ToString(); if (captured.Length > 8192) captured = captured.Substring(0, 8192); throw new TimeoutException("ConPTY diagnostic expected " + expected + "; captured=" + AdminProtocol.Serialize(captured)); }
        private static int PipePeer(string[] args)
        {
            if (args[1] != "--pipe" || args[3] != "--nonce" || !Regex.IsMatch(args[2], @"\AJA21-PipeTest-[0-9a-f]{64}\z") || !Regex.IsMatch(args[4], @"\A[0-9a-f]{64}\z")) throw new InvalidDataException("Invalid diagnostic pipe.");
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", args[2], PipeDirection.InOut)) { pipe.Connect(5000); AdminProtocol.WriteFrame(pipe, AdminProtocol.Serialize(new Dictionary<string, object> { { "nonce", args[4] } })); if (AdminProtocol.ReadFrame(pipe) != "confirmed") throw new InvalidDataException("Diagnostic response mismatch."); } return 0;
        }
        private static int PipeTest()
        {
            List<object> results = new List<object>();
            foreach (bool childMode in new bool[] { false, true })
            {
                string name = "JA21-PipeTest-" + AdminProtocol.RandomToken(32), nonce = AdminProtocol.RandomToken(32); Exception peerError = null; Thread peer = null; Process child = null;
                PipeSecurity security = new PipeSecurity(); security.SetAccessRuleProtection(true, false); security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
                using (NamedPipeServerStream pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security))
                {
                    IAsyncResult connected = pipe.BeginWaitForConnection(null, null);
                    if (childMode) { ProcessStartInfo start = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "--pipe-peer --pipe " + name + " --nonce " + nonce); start.UseShellExecute = false; start.CreateNoWindow = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true; child = Process.Start(start); }
                    else { peer = new Thread(delegate() { try { PipePeer(new string[] { "--pipe-peer", "--pipe", name, "--nonce", nonce }); } catch (Exception ex) { peerError = ex; } }); peer.IsBackground = true; peer.Start(); }
                    bool ok = connected.AsyncWaitHandle.WaitOne(10000); string reason = "";
                    if (ok) { pipe.EndWaitForConnection(connected); uint pid; ok = Native.GetNamedPipeClientProcessId(pipe.SafePipeHandle, out pid) && pid == (uint)(childMode ? child.Id : Process.GetCurrentProcess().Id); if (ok) { Dictionary<string, object> request = AdminProtocol.Parse(AdminProtocol.ReadFrame(pipe)); ok = Native.FixedEqual(AdminProtocol.String(request, "nonce", 64), nonce); AdminProtocol.WriteFrame(pipe, "confirmed"); } }
                    else reason = "Named-pipe connection was not admitted within 10 seconds.";
                    if (child != null) { if (!child.WaitForExit(1000)) child.Kill(); reason += child.StandardError.ReadToEnd(); ok = ok && child.ExitCode == 0; child.Dispose(); }
                    if (peer != null) { peer.Join(1000); if (peerError != null) reason += peerError.Message; ok = ok && peerError == null; }
                    results.Add(new Dictionary<string, object> { { "mode", childMode ? "non-ConPTY child process" : "same-process thread" }, { "status", ok ? "PASS" : "FAIL" }, { "reason", reason } });
                }
            }
            bool passed = true; foreach (Dictionary<string, object> result in results) passed &= (string)result["status"] == "PASS";
            Console.WriteLine(AdminProtocol.Serialize(new Dictionary<string, object> { { "status", passed ? "PASS" : "FAIL" }, { "results", results }, { "uacStarted", false }, { "administratorRole", new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator) } })); return passed ? 0 : 1;
        }
    }
}
