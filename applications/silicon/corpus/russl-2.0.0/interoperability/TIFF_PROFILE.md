# TIFF, BigTIFF and Cloud Optimized GeoTIFF Adapter Profile

**Profile ID:** `RUSSL-TIFF/2.0.0`. **Status:** versioned design candidate; no implemented importer/exporter or external conformance claim. Core language remains RUSSL/1.0.

## External source pins

The source contract uses **TIFF Revision 6.0, final 1992-06-03**, authored by Aldus and available as an [ITU-hosted original specification](https://www.itu.int/itudoc/itu-t/com16/tiff-fx/docs/tiff6.pdf). Classic headers distinguish byte order and use version 42/32-bit offsets. **BigTIFF** is the [LibTIFF BigTIFF Design](https://libtiff.gitlab.io/libtiff/specification/bigtiff.html), observed in LibTIFF documentation 4.7.2: version 43, 8-byte offsets, reserved field zero, 16-byte header and 20-byte directory entries. **COG** is [OGC 21-026, version 1.0, 2023-07-14](https://docs.ogc.org/is/21-026/21-026.html), with tiled imagery, overviews, GeoTIFF keys and HTTP range conformance classes. Accessed 2026-10-09.

The TIFF mirror supplies the original text; BigTIFF documentation URL is mutable and has no separately asserted numbered design revision. A production profile must preserve a checked specification snapshot and independently pin decoder/codec versions. BigTIFF is not a compression codec. A tiled TIFF alone is insufficient evidence of COG conformance.

## Proposed RUSSL mapping

The initial review subset accepts supported grayscale or RGB samples with an exact decoded dtype and a rectangular plane. Other variants remain explicitly unsupported until tested. Map decoded input row/column `(y,x)` to core indices `(0,0,k,y,x)` of shape `(1,1,C,H,W)` for scalar channel planes; a packed pixel alternative requires a separately identified sample profile. `C=1` for scalar grayscale. Endianness belongs to byte decoding, not coordinates.

| Imported property | RUSSL-side rule |
|---|---|
| Image dimensions and sample descriptors | Preserve width/height, sample count, integer signedness/float width/bit depth and declared interpretation in receipt; reject inconsistent counts |
| Contiguous/planar storage | Decode same logical channel samples; physical organization does not change core axes |
| Orientation | Preserve raw decoded row/column order plus orientation metadata; a display-normalized derivative records explicit permutation/reflection and inverse |
| Photometric interpretation / palette / alpha | Preserve interpretation, color table and associated/unassociated-alpha meaning; do not convert colors or unpremultiply samples implicitly |
| Resolution and units | Preserve declared calibration separately from normalized Penteract coordinates; unspecified physical units remain unspecified |
| Multiple image directories | Each image is a separate field by default; page order is provenance, never inferred time/depth. Combining into axes requires explicit reviewed mapping |
| Reduced-resolution images | Separate derived levels with known parent/scale relation; do not mistake them for independent samples or invent reduction algorithm |
| Tags/private metadata | Preserve typed values and raw source reference; uninterpreted tags remain opaque rather than asserted semantic mappings |
| Strips/tiles/offsets/codecs | Adapter-only acquisition metadata, absent from core coordinates and source-program operands |
| Georeferencing | Preserve CRS/calibration/GeoTIFF metadata and unknown keys; normalized coordinates are not geographic coordinates |

Reject nonrectangular stacking, unsupported predictors/codecs, ambiguous sample widths, unsupported YCbCr/CMYK/CIELAB interpretation and transformations requiring unimplemented color semantics. Float nonfinite values, signed zero and NaN payloads require a declared binary-sample equivalence profile; JSON numeric serialization is insufficient to preserve them. The minimal finite-sample subset rejects unsupported representations explicitly.

## Equivalence, export and loss

Maintain original source bytes for archival exactness. Repacking tags, endianness or compression can preserve decoded samples while changing byte hash. A `LOSSLESS` logical export preserves exact sample bits/declared interpretation and calibration; it does not promise original byte layout. `REVERSIBLE_WITH_METADATA` requires an exercised inverse with all retained mapping/tag information. Quantization, color conversion, resampling, lost georeferencing/private metadata or alpha changes are `LOSSY`, each described. Unsupported variants are rejected, not relabeled lossless.

Export chooses classic TIFF only after proving every offset/count fits the chosen format and decoder capabilities; otherwise explicitly select BigTIFF. Overview generation records method, parameters and loss separately from full-resolution samples. COG export and hosting require the declared OGC conformance classes and their Annex A tests; HTTP range hosting is a deployment property that cannot be inferred from file layout.

## Proposed tests and abuse cases

Use genuine fixtures from an independently pinned writer and read the output through at least one independent decoder. Cover both byte orders, classic/BigTIFF, strips/tiles, supported planar modes, singleton/non-square dimensions, all supported orientation mappings, RGB/alpha metadata, multipage ambiguity, dtype boundaries and overviews. Check bitwise full-resolution samples and semantic metadata separately from byte equality.

Adverse fixtures cover cyclic/overlapping/out-of-bounds directory chains, enormous counts, truncated tiles, inconsistent channel descriptors, integer overflow in dimension products, unsupported codec/predictor, forged BigTIFF header fields, private metadata with executable-looking text, and concurrent source mutation. Set memory/CPU/expansion bounds before decoding.

The current corpus's field/coordinate vectors are not actual TIFF/BigTIFF/COG round trips. External acceptance remains open until real fixture hashes, tools/versions, reader outputs and class-specific results are recorded.
