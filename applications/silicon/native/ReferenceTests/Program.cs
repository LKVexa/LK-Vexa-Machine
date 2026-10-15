using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Spiral.Hpu;

if (args.Length != 2) throw new ArgumentException("Usage: reference-tests <vectors-dir> <results-dir>");
string vectors = Path.GetFullPath(args[0]), results = Path.GetFullPath(args[1]);
Directory.CreateDirectory(results);
int assertions = 0;
void Check(bool condition, string message)
{
    assertions++;
    if (!condition) throw new InvalidOperationException(message);
}
void Same(byte[] actual, byte[] expected, string message) => Check(actual.SequenceEqual(expected), message);
void Throws<T>(Action action, string message) where T : Exception
{
    assertions++;
    try { action(); } catch (T) { return; }
    throw new InvalidOperationException(message);
}
string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
var h = new ChipHarness();
Throws<InvalidOperationException>(() => h.Tiff(1), "TIFF before sampling must fail");
foreach (int index in new[] { -1, 0, 8 })
    Throws<ArgumentOutOfRangeException>(() => h.Tiff(index), "invalid TIFF index before sampling");
var enumeratedRoute = File.ReadAllBytes(Path.Combine(vectors, "enumerated-route.bin"));
for (int b = 0; b < 256; b++)
{
    int pick = enumeratedRoute[b] - 1;
    Check(ChipHarness.RouteOf((byte)b) == pick, $"RouteOf({b})");
}
var vectorNames = JsonSerializer.Deserialize<string[]>(File.ReadAllText(Path.Combine(vectors, "vectors.json")));
var outputs = new List<object>();
foreach (string name in vectorNames)
{
    byte[] ram = File.ReadAllBytes(Path.Combine(vectors, name + "-input.bin"));
    byte[] untouched = (byte[])ram.Clone();
    var tiffs = h.Wrap(ram);
    Check(tiffs.Length == 7, name + " TIFF count");
    for (int s = 0; s < 6; s++)
    {
        byte[] want = File.ReadAllBytes(Path.Combine(vectors, $"{name}-lane-{s + 1}.bin"));
        Same(h.Cpu(s, ram), want, $"{name} CPU lane {s + 1}");
        Same(h.Gpu(s, ram), want, $"{name} batched lane {s + 1}");
        Same(h.Planes[s], want, $"{name} sampled lane {s + 1}");
        File.WriteAllBytes(Path.Combine(results, $"{name}-lane-{s + 1}.bin"), h.Planes[s]);
    }
    Same(h.Route, File.ReadAllBytes(Path.Combine(vectors, name + "-route.bin")), name + " selector");
    Same(h.Chip, File.ReadAllBytes(Path.Combine(vectors, name + "-chip.bin")), name + " selected byte");
    Same(ram, untouched, name + " input was modified");
    File.WriteAllBytes(Path.Combine(results, name + "-route.bin"), h.Route);
    File.WriteAllBytes(Path.Combine(results, name + "-chip.bin"), h.Chip);
    for (int s = 0; s < 7; s++)
    {
        Same(tiffs[s], h.Tiff(s + 1), name + " repeated TIFF is deterministic");
        string file = $"{name}-processor-{s + 1}.tif";
        File.WriteAllBytes(Path.Combine(results, file), tiffs[s]);
        outputs.Add(new { file, sha256 = Hash(tiffs[s]) });
    }
}
for (int s = 0; s < 6; s++)
{
    foreach (int length in new[] { 32, 64, 256, 4096, 4128 })
    {
        byte[] ram = Enumerable.Range(0, length).Select(i => (byte)(i & 255)).ToArray();
        Same(h.Cpu(s, ram), h.Gpu(s, ram), $"valid whole-warp length {length}");
    }
    foreach (int length in new[] { 0, 1, 31, 33, 255, 4095, 4097 })
    {
        Throws<ArgumentException>(() => h.Cpu(s, new byte[length]), "CPU invalid length");
        Throws<ArgumentException>(() => h.Gpu(s, new byte[length]), "batched invalid length");
    }
    Throws<ArgumentException>(() => h.Cpu(s, null), "CPU null input");
    Throws<ArgumentException>(() => h.Gpu(s, null), "batched null input");
}
foreach (int processor in new[] { int.MinValue, -1, 6, 7, int.MaxValue })
{
    Throws<ArgumentOutOfRangeException>(() => h.Cpu(processor, new byte[32]), "CPU invalid processor");
    Throws<ArgumentOutOfRangeException>(() => h.Gpu(processor, new byte[32]), "batched invalid processor");
}
byte[] priorRoute = h.Route, priorChip = h.Chip;
byte[][] priorPlanes = h.Planes;
foreach (byte[] ram in new byte[][] { null, Array.Empty<byte>(), new byte[32], new byte[4095], new byte[4097] })
{
    Throws<ArgumentException>(() => h.Sample(ram), "Sample invalid input");
    Throws<ArgumentException>(() => h.Wrap(ram), "Wrap invalid input");
    Same(h.Route, priorRoute, "invalid input changed selector");
    Same(h.Chip, priorChip, "invalid input changed output");
    for (int s = 0; s < 6; s++) Same(h.Planes[s], priorPlanes[s], "invalid input changed lane");
}
foreach (int index in new[] { int.MinValue, -1, 0, 8, int.MaxValue })
    Throws<ArgumentOutOfRangeException>(() => h.Tiff(index), "invalid TIFF index");
byte[] beforeLane = h.Tiff(1), beforeRoute = h.Tiff(7);
byte[][] exposedPlanes = h.Planes;
exposedPlanes[0][0] ^= 255;
exposedPlanes[1] = Array.Empty<byte>();
h.Route[0] = 255;
h.Chip[0] ^= 255;
bool resultSnapshots = h.Tiff(1).SequenceEqual(beforeLane) && h.Tiff(7).SequenceEqual(beforeRoute)
    && h.Planes[1].Length == 4096 && h.Chip.SequenceEqual(priorChip);
Console.WriteLine("Result snapshots protect verified outputs: " + resultSnapshots);
Check(resultSnapshots, "public result arrays allow corrupting verified outputs");
byte[][] zeroTiffs = new ChipHarness().Wrap(new byte[4096]);
byte[][] maximumTiffs = new ChipHarness().Wrap(Enumerable.Repeat((byte)255, 4096).ToArray());
var shared = new ChipHarness();
int concurrentFailures = 0;
Parallel.For(0, 128, i =>
{
    byte[] ram = Enumerable.Repeat((byte)((i & 1) == 0 ? 0 : 255), 4096).ToArray();
    byte[][] expected = (i & 1) == 0 ? zeroTiffs : maximumTiffs;
    byte[][] actual = shared.Wrap(ram);
    for (int s = 0; s < 7; s++)
        if (!actual[s].SequenceEqual(expected[s])) Interlocked.Increment(ref concurrentFailures);
});
Check(concurrentFailures == 0, "concurrent Wrap mixed outputs from distinct inputs");
var report = new
{
    status = "PASS", assertions, sdk = Environment.GetEnvironmentVariable("JA21_NATIVE_SDK"),
    runtime = Environment.Version.ToString(), framework = RuntimeInformation.FrameworkDescription,
    os = RuntimeInformation.OSDescription, processArchitecture = RuntimeInformation.ProcessArchitecture.ToString(),
    osArchitecture = RuntimeInformation.OSArchitecture.ToString(), vectors = vectorNames,
    laneInputComparisons = vectorNames.Length * 4096 * 6 * 3,
    selectorSamples = vectorNames.Length * 4096, tiffFiles = outputs.Count, tiffPixels = outputs.Count * 4096,
    concurrentWraps = 128, sourceSha256 = Hash(File.ReadAllBytes(Path.Combine(vectors, "ChipHarness.cs"))), outputs
};
File.WriteAllText(Path.Combine(results, "native-results.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }) + "\n");
Console.WriteLine(JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
