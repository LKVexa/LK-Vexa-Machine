# WP04 — Penteract Field Specification

**Version:** 2.0.0  
**Status:** Hardened Research / Institutional Candidate — unratified  
**Normative class:** Core  
**Corpus:** RUSSL Research & Institutional Corpus 2.0.0  
**Language/profile:** RUSSL/1.0 hardened reference profile (corpus 2.0.0)

## 1. Scope
Defines the storage-independent five-dimensional sample field used in place of a TIFF-like raster.

This 2.0.0 specification supersedes the unsupported blanket Internal GO implication of the original package. It is a proposed technical contract with scoped implementation evidence, not ratification or external certification. The language header remains RUSSL/1.0. Section 6 preserves the original requirement IDs and normative statements for traceability. Sections 7–13 add technical interpretation, design obligations, examples, and verification boundaries; they introduce no new normative requirement IDs.

Dependencies below are architectural relationships, not an instruction to execute attached content or proof that those dependencies have been implemented. Baseline mechanics remain experimental; absent external authorization and research source material remain absent.

## 2. Non-goals
- It does not make a storage backend the semantic definition of RUSSL.
- It does not treat mathematical admission as cryptographic or organizational authorization.
- It does not invent missing external attestations, source documents, or scientific validation.

## 3. Normative terminology
`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are requirement terms. "Core" means language/IR/tuple/field semantics independent of physical storage. "Profile" means a scoped interoperability or deployment contract.

## 4. Definitions and dependencies
**Dependencies:** WP03, Imaging requirements, P5×S³ research input.

**Mandatory deliverables:**
- field model
- coordinate normalization
- dense/sparse realizations
- regions/chunks
- multiresolution pyramids
- slicing/population

## 5. Normative model
### Field definition
For finite domains `Da={0,…,na−1}`, the canonical logical field is `F:D4×D5×D6×D7×D8→S`. For `na>1`, `φa(i)=-1+2i/(na−1)`. For `na=1`, `φa(0)=anchor_a`, with default `anchor_a=0`. This defines Penteract coordinates independent of storage.

A 2D raster of height `H` and width `W` can be embedded as shape `(1,1,1,H,W)` with `c4=c5=c6=0`, `c7=φ7(y)`, `c8=φ8(x)`. RGB may use a packed pixel sample or shape `(1,1,C,H,W)` with `c6` as channel. Sparse and dense realizations are logically equivalent where samples are defined.

A logical region is the Cartesian product of five half-open index intervals. A pyramid level declares a deterministic reduction transform and maintains the same normalized field extent.

## 6. Normative requirements
| Requirement | Normative statement | Conformance mapping |
|---|---|---|
| `WP04-REQ-0001` | The canonical Penteract field MUST be storage-independent. | `WP04-TEST-0001` |
| `WP04-REQ-0002` | A finite dense realization MUST declare shape `(n4,n5,n6,n7,n8)` with each `na ≥ 1`. | `WP04-TEST-0002` |
| `WP04-REQ-0003` | For `na>1`, the default normalized coordinate MUST be `ca=-1+2*i/(na-1)`. | `WP04-TEST-0003` |
| `WP04-REQ-0004` | For singleton axes, the coordinate MUST use an explicit anchor in `[-1,1]`, defaulting to `0`. | `WP04-TEST-0004` |
| `WP04-REQ-0005` | Sparse realizations MUST preserve the same logical coordinate semantics as dense realizations. | `WP04-TEST-0005` |
| `WP04-REQ-0006` | A 2D raster embedding MUST be expressible by fixing three axes and varying two axes. | `WP04-TEST-0006` |
| `WP04-REQ-0007` | Multiresolution levels MUST preserve the same logical field extent and record their reduction transform. | `WP04-TEST-0007` |
| `WP04-REQ-0008` | Logical regions/chunks MUST be defined by coordinate ranges independent of physical object layout. | `WP04-TEST-0008` |
| `WP04-REQ-0009` | The specification MUST preserve the architecture boundary `RUSSL → MSSL → RUSS tuple-executable → Penteract field → distributed fabric`. | `WP04-TEST-0009` |
| `WP04-REQ-0010` | Normative requirements MUST distinguish core semantics from adapter/profile behavior. | `WP04-TEST-0010` |
| `WP04-REQ-0011` | Unresolved required references, ambiguous authority, or incompatible major versions MUST fail closed. | `WP04-TEST-0011` |
| `WP04-REQ-0012` | Every testable MUST in this specification MUST be traceable to a conformance test or validation rule. | `WP04-TEST-0012` |

## 7. Technical interpretation and algorithms

### Index geometry and exact coordinates
The authoritative finite index space is `D=∏a=4..8 {0,…,na−1}`. Its size is `N=∏na`, computed with checked arithmetic before allocation. Normalization maps indices to logical coordinates; it does not convert them into length or time. For `na>1`, evaluate the rational expression `(2i−(na−1))/(na−1)`; endpoints are exactly −1 and +1 mathematically. Floating implementations specify rounding and tolerance separately.

The inverse is `i=(c+1)(na−1)/2`, valid only when it is an integer in range. A nearest-neighbor policy can map other coordinates to indices, but that resampling policy is profile behavior. For a singleton axis, an explicit finite anchor in `[-1,1]` represents its location; there is no inverse that recovers multiple indices.

### Regions, dense traversal, and sparse absence
A region is `R=∏[la,ua)` with integer bounds `0≤la≤ua≤na`; empty regions have a zero extent on at least one axis. The dense field itself still has positive dimensions. A useful canonical sample traversal is lexicographic index order with c8 fastest, followed by c7 through c4; any implementation adopting it records dtype, byte order, and sample packing in the payload profile. This traversal proposal is not inferred from physical chunk filenames.

Sparse realizations distinguish an absent coordinate from an explicitly stored zero, null sample, mask, or NaN in a numeric payload. A sparse contract declares coverage and absence behavior. Dense/sparse equivalence is extensional equality on the same declared domain and sample-presence policy; matching values only at stored points is insufficient.

### Pyramids and extent
A pyramid descriptor binds parent root, per-level shape, reduction kernel, boundary policy, sampling phase, and coordinate transform. Preserving logical extent means coarse-level coordinates remain related to the same parent domain; it does not mean a downsampled image preserves sample values. A singleton coarse axis needs a chosen anchor. Overlapping regions agree on any shared defined sample or produce an explicit conflict; insertion order cannot decide authoritative value.

## 8. Worked example

For shape `(1,1,1,3,5)` with default singleton anchors, index `(0,0,0,1,3)` maps to `(0,0,0,0,1/2)`. Region `[0,1)×[0,1)×[0,1)×[1,3)×[2,5)` contains six samples and excludes y=3 and x=5.

A level with shape `(1,1,1,2,3)` can span the same normalized endpoints as the parent. Its middle x coordinate is 0, while the parent has more samples. The recorded reducer explains how those new values were generated; coordinate agreement alone does not establish value equivalence.

## 9. Boundary and adversarial cases

| Boundary case | Required interpretation of existing requirements |
|---|---|
| Zero or negative dense dimension | Invalid finite realization. |
| Anchor NaN or infinity | Not an element of the normalized interval. |
| Fractional, boolean, or out-of-range index | Not a domain index. |
| Overflow in product of dimensions | Reject before allocation. |
| Sparse absence silently filled with zero | Coverage semantics change. |
| Two chunks claim different values at the same logical coordinate | Conflict is unresolved. |
| Pyramid shape changes without reduction/placement metadata | Extent and sample meaning are not reconstructible. |

## 10. Security and failure considerations

Shape multiplication, region fan-out, and decompression can exhaust resources before mechanics evaluation. Validation precedes materialization. Coordinate normalization supplies a geometric indexing convention only; it does not establish a five-dimensional physical space or validate P5×S³ mechanics.

## 11. Verification obligations and current evidence boundary

Coordinate-vector and strict-input tests exercise `phi` for singleton and nonsingleton axes. Full field conformance needs payload cardinality, dtype, endian, region partition, overlap, sparse-coverage, and pyramid-reduction tests. Metamorphic checks include endpoint preservation, monotonicity, and independence from chunk partition.

The requirement-to-test mapping in Section 6 is a traceability plan. A registered test identifier is not an executed pass. The final machine registries and verification report identify actual evidence; mandatory unexecuted obligations prevent GO for a claim that includes them.

## 12. Research and institutional boundary

P5×S³/8S mechanics are experimental inputs. Mathematical definitions, preserved bytes, deterministic computation, simulation, empirical observation, and external replication have separate evidence grades. Institutional approval, authentic grants, independent certification, and empirical validation are claimed only when separately supplied and verified. This package does not fabricate those artifacts.

Additional research selects the explicit 4×4×4×16×16 finite domain. The informative [fixed-shape indexing profile](../research/FIXED_SHAPE_INDEXING_PROFILE.md) supplies 16,384 exact ordinal/index pairs, rational normalized coordinates and an optional 2-adic ordinal metric. The optional topology does not replace P5 geometry or physical calibration.

## 13. Cross-specification consistency

WP14 and WP15 attach imaging or scientific meaning through profiles. WP12 indexes immutable regions, and WP13 changes physical layout without changing logical coordinates. WP03 owns rank/refinement typing.

## 14. Change history

- **2.0.0:** Replaced generic repeated algorithm/example text with work-package-specific technical detail, formal invariants, boundary cases, and explicit implementation/verification limits. Preserved the original normative requirement table and language version; superseded blanket Internal GO and placeholder-test conformance implications.
- **1.0.0:** Initial corpus candidate generated from the serialized 28-work-package construction workflow; retained as original audit evidence.
