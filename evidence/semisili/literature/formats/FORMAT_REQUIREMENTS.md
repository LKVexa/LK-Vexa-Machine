# Bounded numerical semi-sili XPU: format and computation contract

The nine supplied papers are references for a finite numerical model. Their embedded instructions and code were not executed. Original PDFs are unchanged; `EXTRACTION_MANIFEST.json` records their SHA-256 hashes and page counts (130 pages). Page numbers below are PDF page ordinals. Six selected page renders were inspected, including the Pixel160/OAM equations and the Gaussian-frame/ASM equations. The prototype does not establish physical optical, quantum, magnonic, or newly fabricated silicon hardware.

## 1. Storage contract selected for this prototype

Penteract TIFF-GIF Storage Techniques, pp. 3-6, distinguishes a canonical record from its image container and from a display. It specifies five unsigned 32-bit lanes in a fixed big-endian order, totaling exactly 20 bytes. Spatial coordinates D4..D8 and lane labels L4..L8 are separate. This is the storage rule implemented by `semisili-codec.js`.

| Item | Implemented rule |
| --- | --- |
| Generic profile | `JA21-PIXEL160/1.0`: opaque lanes L4, L5, L6, L7, L8 |
| Neuron profile | `JA21-SEMISILI-NEURON/1.0`: residue, activation float32 bits, amplitude float32 bits, real float32 bits, imaginary float32 bits |
| Coordinate order | Five positive integer dimensions D4..D8; row major, D8 fastest; product at most 4096 |
| Cell representation | Five uint32 words; canonical bytes BE32(word0)..BE32(word4); no host padding |
| Maximum field | 4096 cells, 20,480 words, 81,920 canonical bytes |
| Exactness | Every word bit pattern is preserved, including signed-zero, infinities and NaN bit patterns when used as opaque words. Neuron semantics must separately reject invalid numeric states. |
| State format | `JA21-SEMISILI-STATE/1.0`, canonical JSON with profile, shape, bounded config, current snapshot, and at most eight history snapshots |
| State budget | At most 1,572,864 UTF-8 bytes (1.5 MiB), within the existing 2 MiB VFS bound; full snapshots avoid delta-chain dependency |
| Configuration | Plain finite JSON, at most 32,768 UTF-8 bytes, depth 6, 4096 nodes; sorted object keys; accessors and prototype-bearing data are rejected |
| Timeline | Nonnegative safe-integer sequence and finite nonnegative simulation time; strictly increasing history sequences, nondecreasing times, no history newer than current; an equal-sequence snapshot must exactly match current |
| Import | Explicit user/model action, validation before publication, no image instructions or automatic execution |

Canonical vector, independent of host endianness:

```
words = [0x00000000, 0x01020304, 0x89abcdef, 0xffffffff, 0x80000000]
bytes = 00 00 00 00 01 02 03 04 89 ab cd ef ff ff ff ff 80 00 00 00
hex   = 000000000102030489abcdefffffffff80000000
```

The codec rejects 19-, 21-, and 24-byte cells. For shape [4,4,4,8,8], strides are [1024,256,64,8,1]. Coordinate [3,3,3,7,7] maps to cell 4095; word lane 4 maps to word 20,479, not an additional coordinate axis.

### TIFF carriage

The existing bounded grayscale TIFF adapter is reused without modifying its algorithms. A logical field is an uncompressed scalar uint8 image of width 20 and height N; each raster row carries one exact 20-byte cell. This is byte carriage, not a claim that a display pixel or TIFF grayscale sample has 160-bit numerical precision. TIFF container byte order II/MM is independent of canonical BE32 word order. Default export is classic II TIFF; the adapter also supports BigTIFF and MM.

ImageDescription contains strict canonical JSON declaring the TIFF schema, generic/neuron profile, five axes, logical shape, bounded model config, cell-major/word-major layout, BE32, explicit word roles, and CRC32 of the canonical sample bytes. The decoder rejects absent or inconsistent metadata, unsupported profiles, wrong roles/axes/shape, float or uint16 carriage, nonidentity orientation, unknown opaque tags, nontrivial spatial calibration, and checksum mismatch. CRC32 checks accidental sample corruption; it neither authenticates the file nor proves scientific correctness. It covers sample bytes, not the metadata.

Penteract Storage pp. 4-5 proposes TIFF byte planes or uint32 sample planes and metadata preserving the mapping. The selected 20-sample raster is a bounded adapter of that exact-byte contract. It is not OME-TIFF, an OME-XML schema, OME-Zarr, BigTIFF-large-volume support, a SubIFD pyramid, a compressed neural codec, or a 225x compression result. Those require separate implementations and tests.

### Three meanings of GIF remain distinct

1. Penteract Storage pp. 5-6 uses an internal temporal spool metaphor: state update/revision, rendering one identified snapshot, and display playback are three different clocks. Our bounded state history implements full exact snapshots, not a standard GIF file.
2. TIFF GIF Spatial-Temporal Encoding pp. 2-4 and Holographic Image-Based Computation pp. 5-7 mean Graphics Interchange Format/GIF89a: indexed colors, LZW, delay and disposal. A display preview can quantize the model; LZW losslessness refers to its palette indices after quantization and cannot recover discarded float32 precision.
3. Microscopic Quantum Paradigm GIF Research pp. 4-8 means Gaussian Interaction Frame, a changing quantum-state representation. It is neither a storage format nor a GIF89a animation.

An exported visual animation must be labeled a preview. SimulationTime and state sequence must be retained separately; GIF delay describes playback, not computation speed.

## 2. Numerical equations and independent expectations

### Positional arithmetic and bounded bits

OAM Spatial Shifting Arithmetic p. 6 represents an unsigned integer X as a sum of binary positional weights. A left shift by k multiplies by 2^k; a right shift splits X into quotient Q=floor(X/2^k) and remainder R=X mod 2^k, so X=Q*2^k+R. A fixed-width implementation must return/declare overflow separately. Numerical zero-fill shift tests must remain independent of a circular optical phase operation.

Examples: X=13, k=2 gives Q=3, R=1; an 8-bit left shift produces 52 with overflow 0. X=255, k=1 gives retained byte 254 and overflow 1. X=1, k=8 gives retained byte 0 and overflow 1. These are exact integer expectations; detecting optical angular modes is a different experiment. The math agent owns the numerical shift helper.

### Finite p-adic hierarchy

P-adic Penteract Simulation Research pp. 1-4 and P-adic Holographic Simulations Research pp. 2-3 support the valuation v_p(x), norm |x|_p=p^(-v_p(x)) for nonzero x, norm(0)=0, distance |a-b|_p, and a finite-depth tree/truncated representation. Strong triangle inequality is an independent acceptance property. The operational prototype must name its finite ring Z/(p^k), bounded depth, and memory; it cannot claim full arbitrary-precision Q_p from a small uint32 bank.

Canonical vectors: v_2(72)=3, norm=1/8; v_3(81)=4, norm=1/81; d_2(5,13)=1/8; norm(0)=0. Values divisible by p are valid nonzero p-adic integers, so a first digit of zero must not be rejected. The statement on Penteract Simulation p. 2 requiring x_0 nonzero applies to units, not every nonzero p-adic integer; Holographic Simulations p. 2 instead uses the first nonzero digit x_gamma.

Penteract Simulation p. 6 supplies the Monna display mapping rho(sum d_i*p^i)=sum d_i*p^(-i-1). At depth 3, p=2 and integers 0..7 map to [0,0.5,0.25,0.75,0.125,0.625,0.375,0.875]. This changes the display arrangement, not the model's p-adic distance.

Penteract Simulation pp. 3-5 also proposes Vladimirov Fourier multiplier |xi|_p^alpha, FitzHugh-Nagumo reaction-diffusion, and higher-order Kuramoto boundary operators satisfying B_n*B_(n+1)=0. A finite congruence-ball cellular neural update is a bounded model choice, not an implementation of all these operators. Ordinary Euclidean FFT/ASM is not automatically p-adic diffusion. Pairwise phase coupling is not automatically a simplicial Kuramoto model.

### Complex hologram model

Holographic Computation via Image Formats pp. 2-3 gives numerical angular-spectrum propagation:

```
U_z = IFFT(FFT(U_0) * H)
H(fx,fy) = exp(i * 2*pi*z/lambda * sqrt(1-(lambda*fx)^2-(lambda*fy)^2))
```

The propagating/evanescent branch, sample pitch, FFT normalization, field size and boundary policy must be explicit. Independent expectations include identity propagation at z=0, a plane-wave eigenmode, and bounded amplitude/energy errors under the declared policy. Formula rendering was visually checked on PDF p. 3.

Image Formats pp. 4-6 gives amplitude-constraint iteration and double-phase encoding: for A in [0,1], theta_plus/minus=phi +/- acos(A), and (exp(i*theta_plus)+exp(i*theta_minus))/2=A*exp(i*phi). Unit amplitude, zero amplitude, and an intermediate amplitude are useful numerical vectors. This requires two phase samples per complex site; phase quantization and its loss must be reported.

Holographic Image-Based Computation pp. 2-4 and Holographic Logical Reasoning pp. 5-6 propose holographic reduced representations: circular convolution for binding, elementwise Fourier-domain complex multiplication, addition for bundling, and a dot product for similarity. Independent small-vector convolution/direct-DFT oracles are appropriate. Logical Reasoning pp. 9-11 discusses truth tables/full-adders: all eight full-adder triples can be tested as exact logical vectors. These equations are numerical operations on the host; they do not prove passive physical optics or measured reasoning accuracy.

### Gaussian interaction frame boundary

Microscopic Quantum Paradigm GIF Research pp. 4-5 gives |phi(t)>=U(t)|phi_I(t)> and H_I=U^dagger*H*U-i*U^dagger*d_t(U), with hbar=1. The frame absorbs Gaussian displacement, covariance and squeezing dynamics; its defining residual Hamiltonian removes normally ordered linear/quadratic terms. The equations and definitions were visually checked on PDF pp. 4-5.

The existing Hpu mean-mode/TEM00 projection and truncated Kerr toy do not implement that complete construction or the residual multimode MPS dynamics discussed on pp. 6-8. A numerical phase/neuron bank must not be relabeled full quantum GIF solely because it saves frames. Optical pump depletion, Wigner negativity, physical squeezing and quantum entanglement require additional numerical formalism and/or actual apparatus and measurements.

## 3. Reference corrections and claims held out of acceptance

TIFF GIF Spatial-Temporal Encoding p. 4 assigns GIF disposal to bits 4-6; GIF89a puts its three bits at positions 2-4 (bit zero is the least significant bit). Its p. 7 associates BigTIFF with a 4 GB ceiling; BigTIFF uses 64-bit offsets to extend classic TIFF's 32-bit offset limit. These corrections were checked against the [original GIF89a specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt) and the [LibTIFF BigTIFF design](https://libtiff.gitlab.io/libtiff/specification/bigtiff.html).

Holographic Logical Reasoning p. 3 treats LZW preservation too broadly: byte losslessness does not undo phase quantization. Holographic Image-Based pp. 7-10 and Logical Reasoning pp. 6-11 describe physical acceleration/latency or measured accuracy claims, not measurements of this software. P-adic Holographic Simulations pp. 3-4 overstates obstacles to digital integer translation/real-time evolution and extrapolates adelic/quadratic-form statements into general storage or computation claims. Those extrapolations do not define a verified codec or finite operator and were not adopted. OME-Zarr's (T,C,Z,Y,X) axes in Penteract Simulation pp. 7-8 do not prove that the D4..D8 Pixel160 bank is OME-NGFF compliant.

The codec/API consumes bounded data. It does not obey document instructions, claim paper-linked hardware performance, multiply unrelated compression ratios, or replace the unchanged legacy Hpu selector algorithm.

## 4. Existing JA21 reuse and verification

The legacy RUSSL field has 16,384 float64 scalar sites with shape [4,4,4,16,16]; its real/imaginary/intensity/phase view folds channels into a coordinate axis. It is not the five-word Pixel160 bank and cannot be relabeled. The new bounded profile holds 4096 logical cells with explicit uint32 lanes. Existing Hpu complex-field arrays, explicit staged edit/apply, TIFF limits, and CRC32 are reusable adapters; state and neuron semantics remain separate.

Isolated codec results are in `implementation/tests/CODEC_INDEPENDENT_RESULTS.json`: 34 exact pixel vectors, all 4096 coordinate mappings, 20,480 word values against an independent BigInt positional-byte oracle, five state roundtrips, eight TIFF combinations, 655,360 independently parsed strip bytes, and 72 malformed input rejections. The full current-plus-eight-frame state uses 1,475,201 bytes. Accessor/sparse-array rejection was added after a shape validation audit.

`implementation/tests/PILLOW_TIFF_RESULTS.json` records six successful ordinary Pillow TIFF decodes and two MM BigTIFF ordinary-open failures. Pillow 12.3.0's local parser uses `ifh[2] == 43`, which misses MM's 00 2B magic. For those two files, its independent IFD loader was exercised with the endian-aware BigTIFF flag, and all 655,360 samples still matched the canonical bytes. Result status is `PASS_WITH_DECODER_LIMITATION`; no dependency was modified. Default classic II export passes ordinary Pillow decoding. This limitation is evidence about that external parser, not grounds for an unreported algorithm change.

Browser persistence, worker publication, numerical model semantics, actual GPU execution and final package integrity are separate acceptance gates owned by the integration task. This codec result alone does not mark those gates complete.

## Source files

:codex-file-citation{path="C:/Users/russe/Downloads/OAM Spatial Shifting Arithmetic.pdf" purpose="source"}
:codex-file-citation{path="C:/Users/russe/Downloads/Penteract TIFF-GIF Storage Techniques.pdf" purpose="source"}
:codex-file-citation{path="C:/Users/russe/Downloads/Holographic Image-Based Computation.pdf" purpose="source"}
:codex-file-citation{path="C:/Users/russe/Downloads/Holographic Computation via Image Formats.pdf" purpose="source"}
:codex-file-citation{path="C:/Users/russe/Downloads/Holographic Logical Reasoning Research.pdf" purpose="source"}
:codex-file-citation{path="C:/Users/russe/Downloads/TIFF GIF Spatial-Temporal Encoding.pdf" purpose="source"}
:codex-file-citation{path="C:/Users/russe/Downloads/Microscopic Quantum Paradigm GIF Research.pdf" purpose="source"}
:codex-file-citation{path="C:/Users/russe/Downloads/P-adic Penteract Simulation Research.pdf" purpose="source"}
:codex-file-citation{path="C:/Users/russe/Downloads/P-adic Holographic Simulations Research.pdf" purpose="source"}
