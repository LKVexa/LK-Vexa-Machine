# JA21 RUSSL TIFF pixel profile — 2.2.2

Implementation profile: **JA21-RUSSL-HPU-ATLAS/1.0**. Source corpus: RUSSL Corpus 2.0.0, supplied as `RUSSL-Zarr-main.zip`. This is a bounded, working TIFF/field adapter. It is not the proposed complete `RUSSL-TIFF/2.0.0` adapter, RUSSL/MSSL language runtime, `.russ` container interpreter, OME-Zarr adapter, or hardware execution engine.

## 1. Source rules versus the new application placement

The corpus fixes axes `(c4,c5,c6,c7,c8)`, shape `(4,4,4,16,16)`, C-order traversal with c8 fastest, and strides `(4096,1024,256,16,1)`. Its authoritative fixture contains all 16,384 index vectors. JA21 uses those exact addresses:

```text
k = 4096*c4 + 1024*c5 + 256*c6 + 16*c7 + c8
  = ((((c4*4+c5)*4+c6)*16+c7)*16+c8)
0 <= c4,c5,c6 < 4; 0 <= c7,c8 < 16
```

The **new JA21 placement below is an application decision**, not a physical interpretation or a placement claimed to be prescribed by the corpus:

| Logical axis | Meaning in this adapter |
|---|---|
| c4 = 0 | Real component |
| c4 = 1 | Imaginary component |
| c4 = 2 | Derived intensity: `re*re + im*im` |
| c4 = 3 | Derived phase: `atan2(im,re)` |
| c5, c6 | 16×16 tile row and column in the existing 64×64 HPU |
| c7, c8 | Local row and column within that tile |

```text
HPU y = c5*16 + c7
HPU x = c6*16 + c8
TIFF raster y = floor(k / 128)
TIFF raster x = k % 128
```

Every one of the 128×128 raster positions stores a meaningful scalar. The 4,096 complex working pixels remain 64×64; the 16,384 sites are their four scalar components, not 16,384 new complex processors. There is no padding, fabricated sample upscaling, or hardware-speed claim.

Rational coordinates follow the corpus: `q(i,n)=(2*i-(n-1))/(n-1)`, reduced exactly, with a singleton axis represented by 0/1. Coordinate arithmetic uses BigInt internally to avoid intermediate overflow at the safe-integer boundary, then returns exact safe integers. This normalization is not a physical unit calibration. An optional `distance` command exposes the distinct 2-adic ordinal address metric; it is not Euclidean distance or a valuation of TIFF sample brightness.

## 2. Numerical fidelity and payload

The active HPU stores real and imaginary arrays in Float32. Capture widens those values exactly into Float64 TIFF slots, including signed zero, then computes intensity and phase in JavaScript binary64. It does not recover precision already absent from the Float32 HPU.

The atlas has 16,384 × 8 = **131,072 raw sample bytes (128 KiB)**. Actual TIFF file size is greater because the header, directory and description are included. Real/imaginary samples must be finite, bounded to ±10^12, and exactly representable in Float32. Derived planes must agree with the declared calculation within `16*Number.EPSILON*max(1,abs(expected),abs(actual))`; this accommodates small cross-platform math differences without silently replacing imported samples.

The atlas is LOSSLESS **within its declared finite scalar-sample, axis and simulated-calibration domain**. It is not a full HPU session backup. GIF spool, recordings, derived caches, byte lanes/counters, command interpreter, virtual filesystem and executable runtime are excluded. Use the existing full-volume backup for those.

## 3. TIFF wire subset

`src/vendor/spiral/tiff-codec.js` writes one grayscale BlackIsZero image with one uncompressed strip. It reads one or several nonoverlapping uncompressed strips. Supported sample representations are unsigned 8/16-bit and finite IEEE Float32/Float64, classic TIFF or bounded BigTIFF, little- or big-endian. All four representations are exercised with independent writer fixtures.

The generic reader retains orientation 1–8 and the original source bytes; it does not rotate or normalize pixels. The application atlas reader accepts only orientation 1, Float64, 128×128, no opaque tags, resolution 1/1 with no physical unit, and the exact declared atlas metadata. `ImageDescription` uses `logicalShape`, not `shape`: some external TIFF tooling reserves top-level `shape` for its own series reshaping.

The 64-bit BigTIFF directory format does **not** remove this implementation's memory bounds. This release supports small, bounded BigTIFF files; it does not spool terabytes or exercise offsets above 4 GiB.

| Bound | Limit |
|---|---:|
| Generic TIFF file | 4 MiB |
| Application field TIFF | 192 KiB |
| Generic image samples | 262,144 |
| Width or height | 4,096, subject to total sample limit |
| IFD tags | 128 |
| Aggregate tag metadata | 64 KiB |
| ASCII/escaped-JSON description | 32 KiB excluding terminator |
| VFS contents | Existing 2 MiB / 1,500-node limits; unchanged |

Header/IFD/tag/strip overlaps, duplicate tags, invalid counts/types, unsafe 64-bit integers, truncated inputs, malformed descriptions, nonfinite floats, unsupported compression, RGB/palette/alpha, tiles and multiple/chained pages are rejected. No page-to-time/depth mapping is guessed. Known semantic-bearing unsupported metadata is rejected; unknown opaque tags in the generic inspector are reported and retained with original bytes, not translated. The atlas's stricter import rejects opaque tags.

BigTIFF external directory values are required to be 8-byte aligned. During independent tests, one default unsigned BigTIFF fixture from tifffile placed external values at 4 mod 8. That fixture remains an explicit rejection test. Valid fixtures add an explicit orientation entry, satisfying the alignment check. Consequently, successful decoding of the supported profile must not be generalized to every TIFF produced by every library. Preserve the source when an import is rejected.

## 4. Metadata and identity

The JSON ImageDescription binds profile/version, source-corpus identifier, logical axes/shape/strides, scalar dtype, placement, simulated calibration, loss declaration and CRC32 of canonical little-endian Float64 sample bytes. Simulated calibration is 8 µm pitch and 532 nm wavelength plus the live HPU's finite z position. These are model settings, not acquisition measurements.

A SHA-256 receipt separates:

1. Exact file identity: hash of original container bytes.
2. Sample identity: hash of little-endian Float64 sample bytes in ordinal order.
3. Logical identity: SHA-256 of `JA21-RUSSL-LOGICAL/1`, NUL, recursively key-sorted descriptor JSON, NUL, canonical sample bytes.

The three supplied field container variants have different file hashes but identical sample and logical hashes. This JA21 domain is not a `.russ` cryptographic root or a language-wide RUSSL canonicalization certificate. CRC32 is accidental-corruption detection and a cooperative UI stale-revision guard, not adversarial authentication. Hash receipts are not signatures, access controls, encryption, or proof of origin.

## 5. Capture, stage, inspect, edit, apply

The authoritative staged file is `/var/hpu/russl-field.tif` inside the existing virtual filesystem. Capture and validated import write only that file. They do not change the live HPU. Old saved volumes are not automatically rewritten.

Only real/imaginary sites (c4 = 0 or 1) are writable. A requested scalar is explicitly rounded with `Math.fround` and the requested/effective values plus a rounding flag are returned. Intensity and phase at the corresponding pixel are recomputed together. Direct derivative writes, NaN, Infinity and out-of-range values are rejected. Validation and edits occur on detached buffers before replacement.

GUI/RPC writes include the staged-file revision token and reject stale state. The worker refuses TIFF management while a terminal command is active. Shell commands operate inside the existing single worker execution context. Imports cannot execute metadata or follow file paths/URLs from it; a host file is read only through an explicit user file selection.

**Apply is intentionally separate and destructive to transient HPU state.** It validates and reconstructs the complex Float32 field, prepares a fresh HPU2 state, verifies VFS quota before changing the live object, and resets byte lanes/counters, recordings, caches and GIF spool. Publication failure rolls the live object and field file back. The GUI asks for confirmation; entering `russl apply` is the explicit terminal action. Export a full-volume backup first when the current session must be retained.

Existing volume-v2, filesystem-v1 and HPU2 encodings are unchanged. A binary fixture produced by the unmodified 2.1.1 HPU round-trips byte-identically through 2.2.2. The staged TIFF is persisted as an ordinary VFS file. Browser durability still depends on actual IndexedDB/locks support and local acceptance testing.

## 6. Legacy visual TIFFs and examples

`phase.tif` remains unsigned 16-bit phase visualization. Its quantizer and reconstruction are now explicit, with phase quantization error at most π/65535 radians under that mapping, and loss of amplitude declared. The stored u16 values export exactly; the original complex field cannot be recovered from phase alone.

Processor TIFFs retain exact `u16 = byte*257` mapping and inverse `byte=u16/257`. Processor 7 denotes route IDs. That representation is lossless for the byte-lane/route domain, not for the original complex field. These are computed data, not independent CPU/GPU execution units.

`examples/tiffs/` contains twelve regenerated TIFFs, three receipt files, documentation and SHA-256 checksums. The address-oracle TIFF stores ordinal 0…16383 for testing and is deliberately not accepted as an HPU field atlas. The three field variants are directly importable. Reference archives and already-saved user TIFFs are preserved unchanged; rerun `hpu tiff` / `hpu bytes` to regenerate active visual exports.

## 7. Reproduction and exclusions

```text
node scripts/verify.mjs
node scripts/make-tiff-examples.mjs
python tests/russl_interop.py
python tests/codecs.py
python tests/browser_offline.py
```

Only Node is required for the application and core verification. Python plus NumPy/tifffile/Pillow/Playwright/Chromium are optional audit tools, not runtime components. See `AUDIT_REPORT.md` for actual test results and remaining native Windows/browser acceptance gaps. No full RUSSL/MSSL execution, `.russ` interpreter, OME-Zarr interchange, multiscale pyramids, compression, RGB/complex TIFF SampleFormat, native GPU dispatch, or independent image execution is implemented here.

## References

Corpus files are retained under `corpus/russl-2.0.0/`; the complete uploaded ZIP is retained under `references/`. A subset document's relative link may point to a document only in that full archive. Source hashes and file dispositions are in `audit/RUSSL_CORPUS_INTAKE.json`.

Primary external specifications consulted:
- https://libtiff.gitlab.io/libtiff/specification/coverage.html
- https://libtiff.gitlab.io/libtiff/specification/bigtiff.html
- https://ngff.openmicroscopy.org/0.5/ (boundary review only; no OME-Zarr adapter claim)
