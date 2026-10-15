# WP14 — RUSSL Imaging Profile

**Version:** 2.0.0  
**Status:** Hardened Research / Institutional Candidate — unratified  
**Normative class:** Profile / Governance / Research  
**Corpus:** RUSSL Research & Institutional Corpus 2.0.0  
**Language/profile:** RUSSL/1.0 hardened reference profile (corpus 2.0.0)

## 1. Scope
Defines pixels/samples, color/channels, bit depth, masks, metadata, tiles, and pyramids on the Penteract field.

This 2.0.0 specification supersedes the unsupported blanket Internal GO implication of the original package. It is a proposed technical contract with scoped implementation evidence, not ratification or external certification. The language header remains RUSSL/1.0. Section 6 preserves the original requirement IDs and normative statements for traceability. Sections 7–13 add technical interpretation, design obligations, examples, and verification boundaries; they introduce no new normative requirement IDs.

Dependencies below are architectural relationships, not an instruction to execute attached content or proof that those dependencies have been implemented. Baseline mechanics remain experimental; absent external authorization and research source material remain absent.

## 2. Non-goals
- It does not make a storage backend the semantic definition of RUSSL.
- It does not treat mathematical admission as cryptographic or organizational authorization.
- It does not invent missing external attestations, source documents, or scientific validation.

## 3. Normative terminology
`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are requirement terms. "Core" means language/IR/tuple/field semantics independent of physical storage. "Profile" means a scoped interoperability or deployment contract.

## 4. Definitions and dependencies
**Dependencies:** WP04, WP03, WP13.

**Mandatory deliverables:**
- sample model
- color/channel metadata
- numeric rules
- pyramids
- masks/regions
- metadata

## 5. Normative model
### Imaging data model
An imaging field sample declares dtype and either scalar intensity or a pixel/vector channel structure. Channel semantics, alpha, color space/profile, transfer characteristics, orientation, and calibration are explicit metadata. Tiles are logical regions; a physical adapter may store them however it chooses.

Lossless profile operations preserve sample values. Multiresolution image levels are derived projections with recorded reduction kernels and parent identities.

## 6. Normative requirements
| Requirement | Normative statement | Conformance mapping |
|---|---|---|
| `WP14-REQ-0001` | An imaging sample MUST declare numeric type, bit depth, and channel interpretation. | `WP14-TEST-0001` |
| `WP14-REQ-0002` | Channels MAY be packed in a sample or mapped to a Penteract axis, but the choice MUST be explicit. | `WP14-TEST-0002` |
| `WP14-REQ-0003` | Color profile and transfer metadata MUST be preserved when supplied. | `WP14-TEST-0003` |
| `WP14-REQ-0004` | Masks and regions MUST share or explicitly transform the parent field coordinate system. | `WP14-TEST-0004` |
| `WP14-REQ-0005` | Image pyramids MUST declare per-level reduction transforms. | `WP14-TEST-0005` |
| `WP14-REQ-0006` | Lossless imaging profiles MUST preserve source sample values exactly. | `WP14-TEST-0006` |
| `WP14-REQ-0007` | A 2D image MUST be representable as a Penteract field population. | `WP14-TEST-0007` |
| `WP14-REQ-0008` | The specification MUST preserve the architecture boundary `RUSSL → MSSL → RUSS tuple-executable → Penteract field → distributed fabric`. | `WP14-TEST-0008` |
| `WP14-REQ-0009` | Normative requirements MUST distinguish core semantics from adapter/profile behavior. | `WP14-TEST-0009` |
| `WP14-REQ-0010` | Unresolved required references, ambiguous authority, or incompatible major versions MUST fail closed. | `WP14-TEST-0010` |
| `WP14-REQ-0011` | Every testable MUST in this specification MUST be traceable to a conformance test or validation rule. | `WP14-TEST-0011` |

## 7. Technical interpretation and algorithms

### Sample representation and metadata
An imaging contract declares signedness, numeric width, packing, byte order, channel model, and sample-presence policy. Color channels, scientific channels, and alpha are distinct meanings. A packed RGB vector and a scalar channel-axis field are equivalent only under an explicit reversible mapping; their encoded payload identities can differ.

Color metadata identifies a supplied profile, transfer function, alpha association, and orientation. Absence of an ICC profile does not authorize inventing one. Lossless migration preserves stored sample values before any display conversion; conversion to linear light, alpha unpremultiplication, color gamut mapping, or orientation normalization is a recorded derivation.

### Pyramids, boundaries, and masks
A reduction profile records kernel, support radius, phase, edge extension, channel/alpha treatment, rounding, clipping, and output dtype. A box mean over unsigned integers specifies whether accumulation widens and how ties are rounded. Integer overflow in the accumulator is not a valid lossless reduction. Pyramid values are derived even if their coordinate extent is preserved.

Masks and label maps declare alignment with the parent field. Nearest-neighbor label reduction has different semantics from averaging intensity samples. Region and ROI geometry states whether bounds address pixel centers, pixel edges, or logical indices. Packed-channel metadata and axis-channel metadata have explicit channel labels and ordering.

### Equality domains
Exact sample equality compares decoded sample values under the same dtype and layout policy. Bitwise equality additionally distinguishes representational cases such as signed zero or NaN payloads when allowed by the sample encoding profile. Display equality, visual similarity, and scientific feature agreement are weaker application observations and do not prove a lossless sample contract.

## 8. Worked example

A 2×2 u16 plane with samples `[[0,2],[4,6]]` embedded as shape `(1,1,1,2,2)` has a box mean of 3 using exact integer accumulation. A 1×1 derived level binds that reducer and an anchor choice. It does not replace the four original samples.

For RGBA data, averaging premultiplied channels and averaging straight channels can yield different pixels near transparent edges. The pyramid profile therefore states alpha association rather than relying on an application default.

## 9. Boundary and adversarial cases

| Missing or wrong declaration | Consequence |
|---|---|
| RGB/BGR order is inferred from three channels | Channel meaning is ambiguous. |
| Orientation is applied but not recorded | Coordinates and original samples are no longer reconstructible. |
| Label masks are linearly interpolated | Label semantics are corrupted. |
| Alpha association is dropped | Subsequent reductions are ambiguous. |
| Sample clipping occurs in a claimed lossless migration | Exact-value obligation fails. |
| NaN metadata enters identity-critical JSON | WP17 rejection applies even if binary pixels can carry NaN. |

## 10. Security and failure considerations

Large dimensions, codec expansion, malformed metadata, and accumulator overflow need bounded validation. No claim of clinical suitability, measurement accuracy, or standardized color management follows from structural corpus validation.

## 11. Verification obligations and current evidence boundary

Required imaging evidence includes packed/axis channel round trips, endian and dtype boundaries, orientation transformations, mask alignment, alpha-sensitive reductions, and sample-exact migration vectors. The delivered profile is a detailed candidate contract; a full imaging executor is not supplied.

The requirement-to-test mapping in Section 6 is a traceability plan. A registered test identifier is not an executed pass. The final machine registries and verification report identify actual evidence; mandatory unexecuted obligations prevent GO for a claim that includes them.

## 12. Research and institutional boundary

P5×S³/8S mechanics are experimental inputs. Mathematical definitions, preserved bytes, deterministic computation, simulation, empirical observation, and external replication have separate evidence grades. Institutional approval, authentic grants, independent certification, and empirical validation are claimed only when separately supplied and verified. This package does not fabricate those artifacts.

Additional image-format proposals are audited in the [research integration report](../research/RESEARCH_INTEGRATION_REPORT.md). GIF89a image encoding and a proposed Gaussian Interaction Frame are different uses of the acronym. Optical/phase/vector samples require explicit signal/units/quantization contracts; a one-bit optimizer communication claim does not establish one-bit image fidelity.

## 13. Cross-specification consistency

WP04 supplies geometry; WP03 supplies dtype/rank constraints; WP16 supplies projection provenance; WP23 supplies TIFF mapping.

## 14. Change history

- **2.0.0:** Replaced generic repeated algorithm/example text with work-package-specific technical detail, formal invariants, boundary cases, and explicit implementation/verification limits. Preserved the original normative requirement table and language version; superseded blanket Internal GO and placeholder-test conformance implications.
- **1.0.0:** Initial corpus candidate generated from the serialized 28-work-package construction workflow; retained as original audit evidence.
