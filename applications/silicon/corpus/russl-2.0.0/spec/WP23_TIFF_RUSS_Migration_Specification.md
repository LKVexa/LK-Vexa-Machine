# WP23 — TIFF→RUSS Migration Specification

**Version:** 2.0.0  
**Status:** Hardened Research / Institutional Candidate — unratified  
**Normative class:** Profile / Governance / Research  
**Corpus:** RUSSL Research & Institutional Corpus 2.0.0  
**Language/profile:** RUSSL/1.0 hardened reference profile (corpus 2.0.0)

## 1. Scope
Defines loss-aware migration between TIFF-family image structures and Penteract field populations.

This 2.0.0 specification supersedes the unsupported blanket Internal GO implication of the original package. It is a proposed technical contract with scoped implementation evidence, not ratification or external certification. The language header remains RUSSL/1.0. Section 6 preserves the original requirement IDs and normative statements for traceability. Sections 7–13 add technical interpretation, design obligations, examples, and verification boundaries; they introduce no new normative requirement IDs.

Dependencies below are architectural relationships, not an instruction to execute attached content or proof that those dependencies have been implemented. Baseline mechanics remain experimental; absent external authorization and research source material remain absent.

## 2. Non-goals
- It does not make a storage backend the semantic definition of RUSSL.
- It does not treat mathematical admission as cryptographic or organizational authorization.
- It does not invent missing external attestations, source documents, or scientific validation.

## 3. Normative terminology
`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are requirement terms. "Core" means language/IR/tuple/field semantics independent of physical storage. "Profile" means a scoped interoperability or deployment contract.

## 4. Definitions and dependencies
**Dependencies:** WP14, WP04, WP13.

**Mandatory deliverables:**
- IFD/tag mapping
- strips/tiles
- metadata
- BigTIFF
- sample preservation
- field placement
- round-trip classes

## 5. Normative model
### Migration mapping
TIFF-family input is treated as an adapter source. Logical samples map into a Penteract field according to an explicit placement profile: image plane coordinates map to two axes; page/channel/time/depth may map to remaining axes or packed sample metadata. IFD/tags and embedded metadata are preserved in a provenance namespace when no direct RUSS profile field exists.

Round-trip classification is `LOSSLESS`, `REVERSIBLE_WITH_METADATA`, or `LOSSY`; byte-for-byte TIFF reconstruction is not required unless a profile explicitly stores the original bytes.

## 6. Normative requirements
| Requirement | Normative statement | Conformance mapping |
|---|---|---|
| `WP23-REQ-0001` | TIFF migration MUST classify each mapping as lossless, reversible-with-metadata, or lossy. | `WP23-TEST-0001` |
| `WP23-REQ-0002` | Pixel/sample values MUST be preserved exactly in a lossless migration. | `WP23-TEST-0002` |
| `WP23-REQ-0003` | TIFF pages, channels, tiles/strips, and pyramid levels MUST map through an explicit Penteract placement profile. | `WP23-TEST-0003` |
| `WP23-REQ-0004` | ICC/EXIF/XMP or equivalent source metadata MUST be preserved or explicitly reported unsupported. | `WP23-TEST-0004` |
| `WP23-REQ-0005` | BigTIFF offset width MUST NOT alter logical sample semantics. | `WP23-TEST-0005` |
| `WP23-REQ-0006` | Round-trip tests MUST compare sample values and preserved metadata, not byte-for-byte container identity. | `WP23-TEST-0006` |
| `WP23-REQ-0007` | The specification MUST preserve the architecture boundary `RUSSL → MSSL → RUSS tuple-executable → Penteract field → distributed fabric`. | `WP23-TEST-0007` |
| `WP23-REQ-0008` | Normative requirements MUST distinguish core semantics from adapter/profile behavior. | `WP23-TEST-0008` |
| `WP23-REQ-0009` | Unresolved required references, ambiguous authority, or incompatible major versions MUST fail closed. | `WP23-TEST-0009` |
| `WP23-REQ-0010` | Every testable MUST in this specification MUST be traceable to a conformance test or validation rule. | `WP23-TEST-0010` |

## 7. Technical interpretation and algorithms

### TIFF-family ingestion stages
The candidate migration procedure separates container inspection, sample decoding, placement, metadata preservation, field construction, and round-trip assessment. Inspect byte order, classic TIFF versus BigTIFF header, IFD graph, tags, sample dtype/width, photometric interpretation, planar layout, compression, orientation, strips/tiles, and subimage relationships before allocating or decoding.

Offset and count arithmetic is checked against file bounds; IFD cycles, overlapping ranges, excessive tag counts, codec expansion, and unsupported codecs produce explicit failures. Classic/BigTIFF offset width is a container concern, not a change to decoded sample semantics. The official libtiff documentation describes TIFF support and its tools; exact adapter implementation/version still requires its own declared profile. [libtiff documentation](https://libtiff.gitlab.io/libtiff/)

### Placement and metadata mapping
Map image-plane y,x to two explicitly chosen logical axes. Pages, channels, time, depth, and pyramid levels use declared mappings; page index is not assumed to mean z or t. Preserve original orientation and raw sample order for sample-exact migration, or apply an identified orientation transform to a derived field.

Retain unfamiliar tags and ICC/EXIF/XMP blocks in a namespaced provenance record when safe and supported. Opaque metadata bytes can be preserved without claiming semantic understanding. Referenced external resources are not fetched automatically. Associated alpha, palette lookup, YCbCr subsampling, and codec-specific conversions are reviewed separately from simple grayscale sample copying.

### Round-trip domains and classification
LOSSLESS means exact decoded sample values under the declared dtype/placement and required semantic metadata contract. REVERSIBLE_WITH_METADATA means the declared source-level information can be reconstructed using preserved side information. LOSSY means required information cannot be reconstructed. State these domains rather than suggesting that every TIFF file can be rebuilt byte-identically.

Original-file preservation can support exact container recovery as a separate archival claim. Re-encoding, tag ordering, strip/tile layout, compression, and offsets commonly change file bytes while samples remain equal. A migration receipt binds source file digest, source profile/version, target root, mapping, losses, and unsupported features.

## 8. Worked example

A grayscale TIFF plane with dimensions H×W can map to shape `(1,1,1,H,W)`. Tile boundaries are decoding/storage metadata; sample coordinate (y,x) stays the same regardless of tiling. Multiple pages require an explicit page-axis meaning.

A TIFF with orientation metadata can be imported with unchanged stored samples plus preserved orientation. A normalized displayed orientation is a separate derived transform and gets a separate provenance record.

## 9. Boundary and adversarial cases

| Defect | Migration classification/failure |
|---|---|
| Page index implicitly treated as depth | Placement semantics are guessed. |
| Unsupported compression accepted as empty pixels | Sample preservation fails. |
| Palette expanded to RGB without provenance | Stored sample representation changes. |
| Orientation/ICC dropped | Required interpretation metadata is lost. |
| IFD offset overflows host arithmetic | Reject before decoding. |
| Re-encoded bytes compared as sole sample oracle | Container equality is confused with sample equality. |

## 10. Security and failure considerations

TIFF is a complex attack surface; a production adapter relies on maintained decoders, bounded allocation, and adversarial tests. This package defines a migration candidate and examples, not an implemented TIFF decoder or certified archival workflow.

## 11. Verification obligations and current evidence boundary

Future evidence covers endian variants, sample widths, planar/packed channels, strip/tile partitions, pyramids, BigTIFF, orientation, palettes, metadata retention, malformed offsets, and unsupported codecs. No successful runtime round trip is asserted without actual source/output files and comparison evidence.

The requirement-to-test mapping in Section 6 is a traceability plan. A registered test identifier is not an executed pass. The final machine registries and verification report identify actual evidence; mandatory unexecuted obligations prevent GO for a claim that includes them.

## 12. Research and institutional boundary

P5×S³/8S mechanics are experimental inputs. Mathematical definitions, preserved bytes, deterministic computation, simulation, empirical observation, and external replication have separate evidence grades. Institutional approval, authentic grants, independent certification, and empirical validation are claimed only when separately supplied and verified. This package does not fabricate those artifacts.

## 13. Cross-specification consistency

WP14 defines image meaning; WP04 defines placement; WP13 defines adapter roles; WP17 separates source-file bytes from logical/root identities.

## 14. Change history

- **2.0.0:** Replaced generic repeated algorithm/example text with work-package-specific technical detail, formal invariants, boundary cases, and explicit implementation/verification limits. Preserved the original normative requirement table and language version; superseded blanket Internal GO and placeholder-test conformance implications.
- **1.0.0:** Initial corpus candidate generated from the serialized 28-work-package construction workflow; retained as original audit evidence.
