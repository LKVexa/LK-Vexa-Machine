namespace Spiral.Hpu;

/// <summary>
/// Scalar and 32-wide batched CPU reference loops for six lookup-table lanes.
/// Gpu is a retained compatibility method name; no GPU API is called.
/// Six table identities represent four distinct byte transformations.
/// Sample verifies equality of both software loops; a seventh selector chooses
/// the largest absolute byte change, resolving ties to the lowest lane index.
/// TIFF exports carry the computed data; the images do not execute themselves.
/// This source is not compiled or invoked by the browser application.
/// </summary>
public sealed class ChipHarness
{
    public const int Width = 64;
    public const int Height = 64;
    public const int Processors = 6;
    public const int Warp = 32;

    static readonly byte[][] Tables =
    {
        new byte[] { 254,240,242,128,246,128,130,0,254,128,130,0,134,0,2,0,254,144,146,0,150,0,2,0,158,0,2,0,6,0,2,0,254,176,178,0,182,0,2,0,190,0,2,0,6,0,2,0,190,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,240,242,0,246,0,2,0,254,0,2,0,6,0,2,0,254,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,48,50,0,54,0,2,0,62,0,2,0,6,0,2,0,62,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,240,242,128,246,128,130,0,254,128,130,0,134,0,2,0,254,144,146,0,150,0,2,0,158,0,2,0,6,0,2,0,254,176,178,0,182,0,2,0,190,0,2,0,6,0,2,0,190,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,240,242,0,246,0,2,0,254,0,2,0,6,0,2,0,254,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,48,50,0,54,0,2,0,62,0,2,0,6,0,2,0,62,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0 },
        new byte[] { 255,253,251,249,247,245,243,241,239,237,235,233,231,229,227,225,223,221,219,217,215,213,211,209,207,205,203,201,199,197,195,193,191,189,187,185,183,181,179,177,175,173,171,169,167,165,163,161,159,157,155,153,151,149,147,145,143,141,139,137,135,133,131,129,127,125,123,121,119,117,115,113,111,109,107,105,103,101,99,97,95,93,91,89,87,85,83,81,79,77,75,73,71,69,67,65,63,61,59,57,55,53,51,49,47,45,43,41,39,37,35,33,31,29,27,25,23,21,19,17,15,13,11,9,7,5,3,1,255,253,251,249,247,245,243,241,239,237,235,233,231,229,227,225,223,221,219,217,215,213,211,209,207,205,203,201,199,197,195,193,191,189,187,185,183,181,179,177,175,173,171,169,167,165,163,161,159,157,155,153,151,149,147,145,143,141,139,137,135,133,131,129,127,125,123,121,119,117,115,113,111,109,107,105,103,101,99,97,95,93,91,89,87,85,83,81,79,77,75,73,71,69,67,65,63,61,59,57,55,53,51,49,47,45,43,41,39,37,35,33,31,29,27,25,23,21,19,17,15,13,11,9,7,5,3,1 },
        new byte[] { 254,240,242,128,246,128,130,0,254,128,130,0,134,0,2,0,254,144,146,0,150,0,2,0,158,0,2,0,6,0,2,0,254,176,178,0,182,0,2,0,190,0,2,0,6,0,2,0,190,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,240,242,0,246,0,2,0,254,0,2,0,6,0,2,0,254,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,48,50,0,54,0,2,0,62,0,2,0,6,0,2,0,62,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,240,242,128,246,128,130,0,254,128,130,0,134,0,2,0,254,144,146,0,150,0,2,0,158,0,2,0,6,0,2,0,254,176,178,0,182,0,2,0,190,0,2,0,6,0,2,0,190,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,240,242,0,246,0,2,0,254,0,2,0,6,0,2,0,254,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,48,50,0,54,0,2,0,62,0,2,0,6,0,2,0,62,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0 },
        new byte[] { 255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255 },
        new byte[] { 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 },
        new byte[] { 254,240,242,128,246,128,130,0,254,128,130,0,134,0,2,0,254,144,146,0,150,0,2,0,158,0,2,0,6,0,2,0,254,176,178,0,182,0,2,0,190,0,2,0,6,0,2,0,190,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,240,242,0,246,0,2,0,254,0,2,0,6,0,2,0,254,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,48,50,0,54,0,2,0,62,0,2,0,6,0,2,0,62,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,240,242,128,246,128,130,0,254,128,130,0,134,0,2,0,254,144,146,0,150,0,2,0,158,0,2,0,6,0,2,0,254,176,178,0,182,0,2,0,190,0,2,0,6,0,2,0,190,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,240,242,0,246,0,2,0,254,0,2,0,6,0,2,0,254,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0,254,48,50,0,54,0,2,0,62,0,2,0,6,0,2,0,62,16,18,0,22,0,2,0,30,0,2,0,6,0,2,0 }
    };

    sealed class SampleResult
    {
        public readonly byte[][] Planes;
        public readonly byte[] Route;
        public readonly byte[] Chip;
        public SampleResult(byte[][] planes, byte[] route, byte[] chip)
        {
            Planes = planes;
            Route = route;
            Chip = chip;
        }
    }
    volatile SampleResult result = new SampleResult(
        new byte[Processors][], System.Array.Empty<byte>(), System.Array.Empty<byte>());

    /// <summary>Snapshots preserve verified outputs when callers edit returned arrays.</summary>
    public byte[][] Planes
    {
        get
        {
            var current = result;
            var copy = new byte[Processors][];
            for (int s = 0; s < Processors; s++)
                copy[s] = current.Planes[s] == null ? null : (byte[])current.Planes[s].Clone();
            return copy;
        }
    }
    public byte[] Route => (byte[])result.Route.Clone();
    public byte[] Chip => (byte[])result.Chip.Clone();

    public static int RouteOf(byte sample)
    {
        int best = -1;
        int pick = 0;
        for (int s = 0; s < Processors; s++)
        {
            int delta = System.Math.Abs(Tables[s][sample] - sample);
            if (delta > best)
            {
                best = delta;
                pick = s;
            }
        }
        return pick;
    }

    public byte[] Cpu(int processor, byte[] ram)
    {
        if (processor < 0 || processor >= Processors) throw new System.ArgumentOutOfRangeException(nameof(processor));
        if (ram == null) throw new System.ArgumentNullException(nameof(ram));
        if (ram.Length == 0 || ram.Length % Warp != 0) throw new System.ArgumentException("RAM sample must fill whole warps.", nameof(ram));
        var table = Tables[processor];
        var lane = new byte[ram.Length];
        for (int i = 0; i < ram.Length; i++)
            lane[i] = table[ram[i]];
        return lane;
    }

    public byte[] Gpu(int processor, byte[] ram)
    {
        if (processor < 0 || processor >= Processors) throw new System.ArgumentOutOfRangeException(nameof(processor));
        if (ram == null) throw new System.ArgumentNullException(nameof(ram));
        if (ram.Length == 0 || ram.Length % Warp != 0) throw new System.ArgumentException("RAM sample must fill whole warps.", nameof(ram));
        var table = Tables[processor];
        var lane = new byte[ram.Length];
        int warps = ram.Length / Warp;
        for (int warp = 0; warp < warps; warp++)
        {
            int start = warp * Warp;
            for (int laneId = 0; laneId < Warp; laneId++)
            {
                int i = start + laneId;
                lane[i] = table[ram[i]];
            }
        }
        return lane;
    }

    public void Sample(byte[] ram)
    {
        result = ComputeSample(ram);
    }

    SampleResult ComputeSample(byte[] ram)
    {
        if (ram == null) throw new System.ArgumentNullException(nameof(ram));
        if (ram.Length != Width * Height)
            throw new System.ArgumentException("RAM sample must be 4096 bytes.", nameof(ram));
        // Work from one input snapshot and publish only a complete verified result.
        var input = (byte[])ram.Clone();
        var nextPlanes = new byte[Processors][];
        var nextRoute = new byte[input.Length];
        var nextChip = new byte[input.Length];
        for (int s = 0; s < Processors; s++)
        {
            var cpu = Cpu(s, input);
            var gpu = Gpu(s, input);
            for (int i = 0; i < input.Length; i++)
                if (cpu[i] != gpu[i])
                    throw new System.InvalidOperationException("Scalar and batched software lanes diverged.");
            nextPlanes[s] = cpu;
        }
        for (int i = 0; i < input.Length; i++)
        {
            int pick = RouteOf(input[i]);
            nextRoute[i] = (byte)(pick + 1);
            nextChip[i] = nextPlanes[pick][i];
        }
        return new SampleResult(nextPlanes, nextRoute, nextChip);
    }

    /// <summary>Index 1–6 is that processor's TIFF. Index 7 is the controller route.</summary>
    public byte[] Tiff(int index)
    {
        return Tiff(index, result);
    }

    static byte[] Tiff(int index, SampleResult current)
    {
        if (index < 1 || index > 7) throw new System.ArgumentOutOfRangeException(nameof(index));
        if (current.Planes[0] == null) throw new System.InvalidOperationException("Call Sample first.");
        var samples = new ushort[Width * Height];
        if (index == 7)
        {
            for (int i = 0; i < samples.Length; i++)
            {
                int r = current.Route[i];
                samples[i] = (ushort)((r << 8) | r);
            }
        }
        else
        {
            var lane = current.Planes[index - 1];
            for (int i = 0; i < samples.Length; i++)
                samples[i] = (ushort)(lane[i] * 257);
        }
        return EncodeGray16(Width, Height, samples);
    }

    /// <summary>Sample the RAM bytes and return the seven TIFF payloads.</summary>
    public byte[][] Wrap(byte[] ram)
    {
        var current = ComputeSample(ram);
        result = current;
        var all = new byte[7][];
        for (int i = 0; i < 7; i++) all[i] = Tiff(i + 1, current);
        return all;
    }

    static byte[] EncodeGray16(int width, int height, ushort[] samples)
    {
        int[][] tags =
        {
            new[] { 256, 4, 1, width },
            new[] { 257, 4, 1, height },
            new[] { 258, 3, 1, 16 },
            new[] { 259, 3, 1, 1 },
            new[] { 262, 3, 1, 1 },
            new[] { 273, 4, 1, 0 },
            new[] { 274, 3, 1, 1 },
            new[] { 277, 3, 1, 1 },
            new[] { 278, 4, 1, height },
            new[] { 279, 4, 1, width * height * 2 },
            new[] { 282, 5, 1, 0 },
            new[] { 283, 5, 1, 0 },
            new[] { 284, 3, 1, 1 },
            new[] { 296, 3, 1, 1 },
            new[] { 339, 3, 1, 1 },
        };
        int ifd = 8;
        int nTags = tags.Length;
        int ifdBytes = 2 + nTags * 12 + 4;
        int xres = ifd + ifdBytes;
        int yres = xres + 8;
        int strip = yres + 8;
        var outb = new byte[strip + width * height * 2];
        void U16(int at, int value) { outb[at] = (byte)value; outb[at + 1] = (byte)(value >> 8); }
        void U32(int at, int value)
        {
            outb[at] = (byte)value;
            outb[at + 1] = (byte)(value >> 8);
            outb[at + 2] = (byte)(value >> 16);
            outb[at + 3] = (byte)(value >> 24);
        }
        U16(0, 0x4949);
        U16(2, 42);
        U32(4, ifd);
        U16(ifd, nTags);
        tags[5][3] = strip;
        tags[10][3] = xres;
        tags[11][3] = yres;
        int p = ifd + 2;
        foreach (var tag in tags)
        {
            U16(p, tag[0]);
            U16(p + 2, tag[1]);
            U32(p + 4, tag[2]);
            if (tag[1] == 3) U16(p + 8, tag[3]);
            else U32(p + 8, tag[3]);
            p += 12;
        }
        U32(p, 0);
        // LUT bytes and route IDs carry no physical pixel calibration.
        U32(xres, 1);
        U32(xres + 4, 1);
        U32(yres, 1);
        U32(yres + 4, 1);
        for (int i = 0; i < samples.Length; i++) U16(strip + i * 2, samples[i]);
        return outb;
    }
}
