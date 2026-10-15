# OME-Zarr / NGFF Adapter Profile

**Profile ID:** `RUSSL-OME-ZARR/2.0.0`. **Status:** proposed external adapter; not implemented or certified by this corpus. **Core:** RUSSL/1.0.

## Versions and source contract

Pin [OME-Zarr / NGFF 0.5](https://ngff.openmicroscopy.org/0.5/) and [Zarr core specification 3.1 as observed 2026-10-09](https://zarr-specs.readthedocs.io/en/latest/v3/core/index.html). `zarr_format` remains 3; it is distinct from the core document minor version. NGFF 0.5 uses Zarr v3 with OME metadata under `attributes.ome` in `zarr.json`. Multiscale arrays have 2–5 axes, ordered time, channel/custom, then space; array `dimension_names` match declared axis names. Dataset transforms contain scale and optional following translation, with group transforms applied afterward. Labels use integer types. These facts define the external boundary; accessed 2026-10-09.

The Zarr latest URL is mutable: capture exact text/commit and codec specifications before deployment. This receipt pins the reviewed document version/date, not a future website state. Do not interpret 0.4/v2 `.zattrs`, `dtype`, `compressor` or `order` as 0.5/v3 metadata without an explicit migration profile. The minimum proposed writer uses the ordinary named codec-object form compatible with the reviewed v3.0 subset, with every codec/version separately pinned; unknown extensions are not executed.

## Exact RUSSL axis permutation

The RUSSL profile chooses core axis order `(t,z,c,y,x)` = `(n4,n5,n6,n7,n8)`. This is an adapter convention, not an alteration of WP04. Standard-name example `(t,c,z,y,x)` becomes `(t,z,c,y,x)` via permutation `(0,2,1,3,4)`. For dimensions `(T,C,Z,H,W)`, output shape is `(T,Z,C,H,W)` and `F[t,z,c,y,x]=A[t,c,z,y,x]`.

| Declared input axes | Core shape | Mapping |
|---|---|---|
| `(y,x)` | `(1,1,1,H,W)` | Singleton time/depth/channel anchors 0 |
| `(z,y,x)` | `(1,Z,1,H,W)` | Depth to n5 |
| `(c,y,x)` | `(1,1,C,H,W)` | Channel to n6 |
| `(t,y,x)` | `(T,1,1,H,W)` | Time to n4 |
| `(c,z,y,x)` | `(1,Z,C,H,W)` | Permute c/z and insert singleton time |
| `(t,c,z,y,x)` | `(T,Z,C,H,W)` | Permutation above |

Axis names in NGFF need not be these strings. The adapter requires a supplied map based on unique names, types and intended meaning; it never guesses from shape. Nonstandard/custom axes, missing spatial semantics, multiple multiscales and collections need explicit selected-image/profile records. More than five logical dimensions, zero-length dimensions or unsupported sample types cannot become a valid nonempty core field by dropping information; reject or archive opaquely.

## Coordinate and pyramid treatment

Preserve physical units/calibration independently of normalized coordinates. For a non-singleton core axis, `c=-1+2*i/(n-1)`; for singleton `c=anchor` (default 0). The physical map is retained as a distinct ordered transform expression. For explicit dataset scale/translation `p=s*i+b` followed by group `p'=g*p+h`, record composed `p'=(g*s)*i+(g*b+h)` with every vector permuted consistently. Negative/zero/nonfinite scales require explicit supported-domain review; never silently resample them.

Each level has its own samples, shape, declared physical transform and root relationship. Preserve the normalized root extent contract while recording physical center/edge extent differences. Odd sizes and cropping can make exact physical extents differ; this is not repaired by forcing the normalized endpoints to imply equal physical coverage. If no valid WP04 relationship is established, retain separate derived fields and mark pyramid association unresolved. Unknown downsampling method remains unknown; do not manufacture a reproducible reduction from a method label.

## Metadata and sample policy

Chunks, shards, storage transformers and keys remain physical placement, never logical core coordinates. Record supported codec chain, dtype, chunk grid/key encoding, fill policy and metadata snapshot. Decode supported samples exactly; missing chunks use a validated declared fill policy, while fetch failures/corruption remain errors. Do not collapse missing-data masks into numeric zero. A nonfinite float fill encoded as a string in Zarr metadata is not permission to emit invalid numeric NaN in identity-critical JSON; bitwise floating samples need a separate binary identity profile.

Labels become separate integer fields with image association, coordinate mapping, label properties and unknown metadata retained. Rendering windows/colors are display metadata and never modify canonical intensities. Plate/well/series organization stays provenance/collection metadata; flattening it into time/depth without an explicit map is prohibited. Preserve source `zarr.json` bytes and unknown attributes as opaque evidence with sensitivity review.

## Loss and proposed acceptance

Rechunking/recompression may preserve declared logical samples while changing bytes. Lossless field equivalence is different from complete source-store reconstruction. Declare lost labels, rendering metadata, units, collections, transforms, fill distinctions, dtype narrowing or resampling per property. `REVERSIBLE_WITH_METADATA` requires a tested inverse; unavailable codec/extension/transform yields `UNSUPPORTED` rather than a fabricated mapping.

Tests need genuine 0.5/v3 fixtures and independent tools: 2D through 5D, nonstandard axis names with explicit maps, all axis permutations, multiple levels with odd sizes, scale/group composition, integer labels, fill/missing chunks, codec allowlist, collection metadata and round trips. Adverse tests cover escaping paths, remote references, unknown required extensions, mixed metadata versions, mismatched dimensions, huge shapes, malformed codec chains, source changes during reads and corrupt chunks. Record exact fixture hashes, tools/spec snapshots and observed sample/metadata results.

No such external-format execution results are supplied by writing this profile. Current coordinate fixtures establish only their own core behavior. Adapter conformance and production availability remain unresolved.
