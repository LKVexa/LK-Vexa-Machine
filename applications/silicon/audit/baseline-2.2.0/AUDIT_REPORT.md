# JA21 Silicon Console 2.2.0 — TIFF and pixel-logic audit

Release date: 2026-10-12 (local); execution timestamps in JSON evidence use UTC.
Baseline: the supplied 2.1.1 PrivateRuntime package. New input: RUSSL-Zarr-main.zip.
Status: **implemented and passed the scoped offline gates; native Windows and normal-browser acceptance remain open.**

## Executive result

The active TIFF generation path now uses a bounded typed codec and explicit,
loss-aware metadata. A new 128×128 Float64 field atlas maps the RUSSL corpus's
[4,4,4,16,16] sites onto the existing 64×64 complex HPU's real, imaginary,
intensity and phase values. The mapping is exhaustive and reversible within the
declared finite-sample domain; it is a documented JA21 application placement,
not a physical 5D processor or a placement the corpus itself already implements.

The TIFF pixel lab and `russl` command capture, inspect, edit, hash, import, export
and explicitly apply staged image data. This is functional runtime integration,
not just copied documentation. The live grid, HPU2 binary format, volume v2,
filesystem snapshot v1 and hermit.vws.v3 are unchanged. The private Windows Node
bootstrap from 2.1.1 remains in place, with current product version 2.2.0.

The new sample set contains **12 actual regenerated TIFFs**, including three
sample-identical field container variants. The active phase and seven processor
TIFF exporters are updated. Old user files and archived references are not
silently rewritten on startup. A user can explicitly capture a new atlas or run
`hpu tiff` / `hpu bytes` to regenerate current visual files.

## 1. Intake, provenance and corpus scope

Uploaded corpus SHA-256:
`4adec0988b7e9de5e82d6c43d910112341373d18207545f4df2be431cbb66eb1`.

All **325 outer-archive files** have size, hash and disposition records
in `audit/RUSSL_CORPUS_INTAKE.json`. Disposition counts are:

```json
{
  "binary preserved": 14,
  "UTF-8 decoded": 164,
  "JSON parsed": 134,
  "JSONL parsed": 3,
  "Python AST parsed; not executed": 10
}
```

The fixed-shape registry, all 16,384 authoritative index vectors, the reviewed
pure Python layout helper, imaging/indexing/TIFF/storage-identity specifications,
limitations and notices were read for this integration. The copied selected
reference files are byte-identical to their source. The complete original corpus
ZIP is preserved unchanged under references/. All **33 prior reference files**
also retain their baseline hashes. `audit/TIFF_SOURCE_PROVENANCE.json` records
these assertions and the old-version HPU2 migration fixture.

The attached corpus describes candidate specifications, not an already working
universal TIFF/Zarr adapter. Selected source ideas implemented here are exact
addressing, explicit placement, type preservation, loss classification, separate
identity domains, bounded import, and preservation of original source bytes.
Nested archives were not recursively re-audited or executed. Corpus prompts were
not treated as instructions to run, and papers were not treated as proof of
hardware acceleration. A previous 8,752-record audit is historical evidence, not
a count of files newly semantically certified in this update.

## 2. Findings and applied changes

| ID | Finding / boundary | Applied result |
|---|---|---|
| T01 | Visual TIFFs did not embody the supplied fixed-site address profile | Exact shape/strides, ordinal/inverse, rational coordinates and address metric; all 16,384 corpus vectors checked |
| T02 | Phase-only TIFF cannot reconstruct the original complex field | New sample-exact Float64 atlas; legacy phase quantization and discarded amplitude explicitly labeled LOSSY |
| T03 | No live-field import/edit/apply transaction | Detached validation, staged VFS TIFF, coupled derivative recomputation, explicit apply with quota-first replacement and publication rollback |
| T04 | Untrusted TIFFs create offset/count/allocation/semantic risks | Bounded classic/BigTIFF, II/MM, scalar u8/u16/f32/f64, strict directory/strip ranges, codec/page/type/metadata rejection |
| T05 | Byte-lane TIFF meaning and reversible scale were implicit | Declared u16=byte×257 mapping, processor/route identity and domain-scoped losslessness |
| T06 | Byte-identical versus sample-identical files were conflated | CRC32 sample integrity plus separate SHA-256 file, sample and declared logical identities; no signature claim |
| T07 | Metadata `shape` collided with an external library's TIFF-series convention | Replaced with `logicalShape` and verified expected 128×128 independent decoder output |
| T08 | BigTIFF fixtures exposed external alignment differences | Retained strict 8-byte external-value alignment; valid independent fixtures and a real nonaligned rejection fixture |
| T09 | UI could show a stale staged revision / value after lifecycle or import | Revision guards, start/stop invalidation, refreshed visible lab, read-output invalidation and stopped-control disabling |
| T10 | Corpus source/version/license attribution needed preservation | Original corpus archive, selected notices and source rules retained; per-file SPDX attribution; no blanket relicense of old source |
| T11 | Version/history and test evidence could be confused | Product 2.2.0, genuine old changelog retained, baseline reports segregated, current source diff/manifests/results |
| T12 | Rational-coordinate intermediate arithmetic could exceed safe integer precision | BigInt intermediates and an explicit safe-integer-boundary regression |

The newly defined placement is:

```text
k = 4096*c4 + 1024*c5 + 256*c6 + 16*c7 + c8
c4 = real / imaginary / intensity / phase
HPU y = 16*c5 + c7; HPU x = 16*c6 + c8
TIFF y = floor(k/128); TIFF x = k mod 128
```

The raw Float64 payload is 131,072 bytes. That is four scalar components for each
of 4,096 complex working pixels, not a fourfold growth in complex compute units.
Real/imaginary Float32 values widen exactly into Float64 slots; lost source
precision is not recovered. Every raster site participates; there is no padding.

## 3. Semantics, edit safety and saved-state compatibility

The atlas's lossless claim is limited to finite decoded scalar samples, declared
axes/placement and simulated calibration. A full VM/HPU session is not encoded
in it. Fields are capped to ±10^12 for real/imaginary values and must already be
exactly Float32-representable. Derived intensity/phase is validated, allowing a
specified small numerical tolerance for cross-platform calculation differences.
Stored decoded sample bits themselves are preserved, including signed zero.

Only c4=0/1 can be edited. The requested value is explicitly rounded to Float32,
its effective value is reported, and intensity/phase are recomputed together.
Capture/import/edit stages `/var/hpu/russl-field.tif`; the live HPU remains
unchanged. GUI write operations check the current revision and the worker rejects
management while a terminal command is active. Invalid or stale replacements do
not replace the valid staged file.

Apply validates and prepares a fresh HPU2 state before changing live values. VFS
quota is checked first; a failed host publication rolls back live state and the
field file. Apply resets spool, recordings, byte lanes/counters and caches. The GUI
asks for confirmation, while `russl apply` is the terminal's explicit instruction.
A full backup is needed to preserve the old transient session.

The existing HPU2/volume/filesystem schemas are unchanged. A fixture produced by
the actual unmodified 2.1.1 HPU loads and saves byte-identically in the new code.
Worker tests exercise staged-file plus applied-field persistence across restart
using explicit storage/lock doubles. This does not establish actual browser
IndexedDB durability in the policy-blocked environment.

## 4. Image and metadata security scope

Generic decoding is bounded to 4 MiB, 262,144 samples, 128 tags and 64 KiB tag
metadata. Atlas input is bounded further to 192 KiB and the exact Float64 profile.
The decoder rejects unsupported compression, RGB/palette/alpha, tiles, chained
pages, semantic metadata, bad counts, unsafe offsets, overlaps and nonfinite
samples. Orientation is retained by the generic inspector, never silently
normalized; live atlas import requires orientation 1.

The original file snapshot is retained by generic decoding for exact-container
recovery. No URL/path embedded in metadata is followed, and metadata is never
executed. Local import requires the user-selected file. Unknown generic opaque
tags are reported; the stricter atlas import rejects them. Full TIFF support or
in-place preservation of every TIFF tag through arbitrary edits is not claimed.

BigTIFF is supported only within the small memory limit, not as terabyte spooling.
One default independent unsigned BigTIFF fixture had 4-mod-8 out-of-line values;
it is deliberately rejected by the strict alignment check. Valid independent
fixtures exercise both byte orders and all four dtypes. This compatibility limit
is documented rather than hidden by relaxing checks.

CRC32 detects accidental corruption and supports cooperative stale-UI checks. It
is not collision-resistant authentication. SHA-256 receipts distinguish exact
file bytes, canonical sample bytes and the explicitly declared JA21 logical
identity. They are not signatures, `.russ` roots, or proof of physical provenance.
The logical identity domain is defined in docs/RUSSL_PIXEL_PROFILE.md.

## 5. Verification performed

| Gate | Result | Evidence |
|---|---:|---|
| Core Node regression suite | **244/244 passed; 0 failed; 0 skipped** | audit/TEST_RESULTS.tap; VERIFICATION.json |
| Included Windows launcher contracts | **18 static checks** | Same TAP; not Windows execution |
| Active JS syntax and local imports | **53 parsed; 58 imports resolved** | RELEASE_CHECKS.json |
| Corpus address coverage | **All 16,384 vectors** | tests/russl.test.mjs; independent ordinal check |
| Independent TIFF checks | **12 passed** | RUSSL_INTEROP_RESULTS.json |
| External writer interoperability | **16 valid fixtures** | tests/fixtures/independent-tiff/manifest.json; Node tests |
| Existing independent TIFF/GIF checks | **3 passed** | CODEC_RESULTS.json |
| Offline Chromium UI | **15 scenarios; 0 page errors** | BROWSER_OFFLINE_RESULTS.json |
| Native HTTP browser startup | **Blocked by administrator policy** | NATIVE_BROWSER_PROBE.json |
| Actual Windows .cmd/PowerShell/run-time download | **Not tested here** | Manual acceptance remains required |

The 244 Node tests include the inherited 153-test gate plus 91 new tests/subtests.
The exhaustive vector coverage is one full-domain assertion, not 16,384 extra
test cases added to inflate the total. Actual Node workers exercise management
RPCs; their storage and locking are explicit test doubles. The offline UI uses
the real app, TIFF codec and HPU model with a clearly labeled in-memory link.
Its fifteen scenarios include capture, staged edits, failed derivative writes,
cancel/accept apply, TIFF download, valid endian-variant import, failed truncated
replacement, desktop/mobile layout and lifecycle controls.

The independent reader compared every Float64 sample bit in three field TIFFs,
every u16 sample in phase and seven processor TIFFs (both tifffile and Pillow),
and every ordinal pixel against the corpus fixture and reviewed Python helper.
The independent writer supplies classic/BigTIFF × little/big-endian × four dtypes,
including multistrip images, negative zero and finite floating edge cases.
The sample-export/UI download is actual TIFF bytes rather than a screenshot.

Node ran as v22.16.0 on Linux; optional audit tools were tifffile 2026.5.15,
NumPy 2.3.5 and Pillow 12.3.0. Python/native browser
packages are QA-only, not new application dependencies. No npm installation is
required. The private Windows bootstrap remains pinned to Node 24.21.0; its
Windows executable was not run here.

## 6. Test-discovered corrections and limitations

Early runs caught a stale launcher-version assertion, a VFS decorated-buffer
equality assertion, the reserved external `shape` metadata convention and the
independent BigTIFF alignment difference. The version matcher and buffer-value
assertions were corrected, metadata was renamed, and alignment stayed strict with
an explicit negative fixture. All listed successful gates were rerun afterward.
No earlier failing run is counted as a pass. Active code and selected Python QA
sources were parsed; native C#/PowerShell and original research binaries were not
newly compiled or semantically certified.

Normal HTTP navigation was attempted without changing managed browser policies
and returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` at the loopback URL. The Node
static host did start. Screenshots label the offline fixture and were visually
checked at desktop and 430-pixel mobile widths. Actual browser worker/IndexedDB/
Web Locks/Web Crypto/CSP integration therefore remains a native acceptance gap,
as does Windows startup/provisioning. The root baseline's blanket licensing is
unresolved; the corpus's GPL source and other notices remain intact.

No complete RUSSL/MSSL parser or evaluator, `.russ` executable container, OME-Zarr
adapter, virtual-axis-to-time/space guess, independent image execution, physical
XPU/GPU/quantum acceleration, or new hardware throughput was implemented or
certified. The result is host software operating on typed image data.

## 7. Upgrade and use

Export a full-volume backup, close the old app/host, extract the complete 2.2.0
package to a short folder such as `D:\JA21_2.2.0`, and run Start-Console.cmd. The
private runtime bootstrap is included, so no global Node/PATH installation is
required. Runtime bytes are not bundled: first provisioning needs the exact
cached archive or access to the official runtime source. Do not disable device
security or clear browser storage. Keep the same browser profile and origin
`http://127.0.0.1:8788/` for the existing virtual volume.

Open TIFF pixel lab, capture or import an atlas, read/edit a real/imaginary site,
then explicitly apply when ready. Download the TIFF/receipt separately from the
full-volume backup. The samples-only ZIP contains the same twelve example TIFFs
and receipts as examples/tiffs/. Reference archives and old user files remain
unchanged. `tests/MANUAL_ACCEPTANCE.md` lists remaining native device checks.

## 8. Source and evidence navigation

- docs/RUSSL_PIXEL_PROFILE.md: complete implementation profile and loss/safety boundaries.
- COMMANDS.md / TIFF pixel lab: command and GUI workflows.
- audit/TIFF_UPDATE_CHANGES.json and TIFF_UPDATE_PATCH.diff: current changes versus 2.1.1.
- audit/TIFF_SOURCE_PROVENANCE.json: original-reference, corpus-copy and old-state fixture hashes.
- FILES_MANIFEST.json: current package file hashes; excludes itself and SHA256SUMS.txt.
- audit/INHERITED_EVIDENCE.md: old audit scope distinguished from this update.
- THIRD_PARTY_NOTICES.md: source-license scope and unresolved combined redistribution rights.

Primary external specifications/checksum sources consulted:
https://libtiff.gitlab.io/libtiff/specification/coverage.html
https://libtiff.gitlab.io/libtiff/specification/bigtiff.html
https://ngff.openmicroscopy.org/0.5/ (boundary review; no adapter claim)
https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt
https://nodejs.org/en/blog/release/v24.21.0
