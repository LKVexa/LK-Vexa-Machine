# WP24 — OME-Zarr→RUSS Interoperability Specification

**Version:** 2.0.0  
**Status:** Hardened Research / Institutional Candidate — unratified  
**Normative class:** Profile / Governance / Research  
**Corpus:** RUSSL Research & Institutional Corpus 2.0.0  
**Language/profile:** RUSSL/1.0 hardened reference profile (corpus 2.0.0)

## 1. Scope
Defines OME-Zarr/NGFF interoperability without making it a canonical language substrate.

This 2.0.0 specification supersedes the unsupported blanket Internal GO implication of the original package. It is a proposed technical contract with scoped implementation evidence, not ratification or external certification. The language header remains RUSSL/1.0. Section 6 preserves the original requirement IDs and normative statements for traceability. Sections 7–13 add technical interpretation, design obligations, examples, and verification boundaries; they introduce no new normative requirement IDs.

Dependencies below are architectural relationships, not an instruction to execute attached content or proof that those dependencies have been implemented. Baseline mechanics remain experimental; absent external authorization and research source material remain absent.

## 2. Non-goals
- It does not make a storage backend the semantic definition of RUSSL.
- It does not treat mathematical admission as cryptographic or organizational authorization.
- It does not invent missing external attestations, source documents, or scientific validation.

## 3. Normative terminology
`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are requirement terms. "Core" means language/IR/tuple/field semantics independent of physical storage. "Profile" means a scoped interoperability or deployment contract.

## 4. Definitions and dependencies
**Dependencies:** WP15, WP13, WP16.

**Mandatory deliverables:**
- axis mapping
- multiscales
- chunks/metadata
- labels/transforms
- loss classification
- adapter tests

## 5. Normative model
### Interoperability mapping
OME-Zarr/NGFF arrays are imported through an adapter that maps axes, multiscales, coordinate transforms, labels, and metadata into logical RUSS field/profile structures. Physical chunk keys do not become logical coordinates. Export is a derived projection and records all mappings and losses.

This document intentionally mentions the external storage/interoperability format because it is the designated adapter profile; no RUSSL core program depends on it.

## 6. Normative requirements
| Requirement | Normative statement | Conformance mapping |
|---|---|---|
| `WP24-REQ-0001` | OME-Zarr/NGFF interoperability MUST be an adapter/profile and MUST NOT redefine canonical RUSSL state. | `WP24-TEST-0001` |
| `WP24-REQ-0002` | Axis mappings MUST be explicit and versioned. | `WP24-TEST-0002` |
| `WP24-REQ-0003` | Multiscale transforms MUST map to Penteract pyramid transforms without changing canonical field extent. | `WP24-TEST-0003` |
| `WP24-REQ-0004` | Chunk layout changes MUST NOT change logical sample coordinates. | `WP24-TEST-0004` |
| `WP24-REQ-0005` | Unsupported labels or coordinate transforms MUST be classified as preserved, transformed, or lossy. | `WP24-TEST-0005` |
| `WP24-REQ-0006` | Interoperability tests MUST declare the external profile version used. | `WP24-TEST-0006` |
| `WP24-REQ-0007` | The specification MUST preserve the architecture boundary `RUSSL → MSSL → RUSS tuple-executable → Penteract field → distributed fabric`. | `WP24-TEST-0007` |
| `WP24-REQ-0008` | Normative requirements MUST distinguish core semantics from adapter/profile behavior. | `WP24-TEST-0008` |
| `WP24-REQ-0009` | Unresolved required references, ambiguous authority, or incompatible major versions MUST fail closed. | `WP24-TEST-0009` |
| `WP24-REQ-0010` | Every testable MUST in this specification MUST be traceable to a conformance test or validation rule. | `WP24-TEST-0010` |

## 7. Technical interpretation and algorithms

### External versions are pinned inputs
Select a declared NGFF/OME-Zarr version and underlying Zarr version before import. The reviewed informative target here is NGFF 0.5, whose specification uses Zarr v3 and defines image axes/multiscale metadata. This is an external profile selection, not the corpus's implementation claim or an automatic promise to support any newer version. [NGFF 0.5 specification](https://ngff.openmicroscopy.org/0.5/)

The 0.5 mapping reads ordered axes, dataset paths, per-dataset coordinate transforms, group transforms, labels, and relevant rendering metadata. Transform vector lengths agree with axis count. Scale/translation composition follows the declared source order; group transforms compose after per-level transforms for this version. Physical chunk keys remain storage implementation details.

### Mapping procedure
1. Validate source metadata and resolve safe relative dataset references.
2. Read source axes and construct an explicit injective placement into c4…c8; pad absent axes with declared singleton anchors.
3. Decode samples under the selected Zarr datatype/codec contract, preserving dtype, channel meaning, and missingness.
4. Map each resolution level to a derived field descriptor with parent relation, transform, shape, and reduction provenance when supplied.
5. Preserve supported labels, image-label relationships, calibration, and opaque metadata with source identities.
6. Report transformed, unsupported, and lost information; bind the resulting root and comparison domain.

Source units/calibration do not redefine normalized Penteract coordinates. Coordinate transforms can establish different sample-center positions across levels; preserving the canonical parent extent requires a declared embedding and may be approximate or lossy. WP24-REQ-0003 does not justify silently rewriting source physical transforms to force equal endpoints.

### Export and compatibility
Export is an identified derived representation. It selects external versions, axis order, dtype, codecs, chunk layout, label handling, and transform representation. Exact sample preservation, physical-coordinate preservation, metadata reversibility, and container/store byte identity are separately assessed. Unknown custom transforms or label meanings are preserved opaquely or explicitly marked unsupported; guessing a transform is not interoperability.

## 8. Worked example

An NGFF 0.5 TCZYX array maps its ordered axes to c4=t,c5=c,c6=z,c7=y,c8=x under a named profile. A scale vector `[1,1,2,0.5,0.5]` and declared units describe calibration; they do not replace WP04's normalization formula.

Changing chunks from 64×64 to 128×128 can preserve all samples and calibrated coordinates while changing stored bytes and keys. Target logical equivalence is verified at the decoded/profile level; raw storage identity is assessed separately.

## 9. Boundary and adversarial cases

| Defect | Interoperability consequence |
|---|---|
| Version omitted or guessed from directory name | External contract is unknown. |
| Axis names assumed to be TCZYX despite metadata | Placement can be wrong. |
| Scale/translation order reversed | Physical offsets change. |
| Unknown codec silently skipped | Sample data are missing. |
| Label IDs interpolated as intensities | Label semantics are destroyed. |
| Coarse-level calibration overwritten to match normalized endpoints | Source meaning is altered. |

## 10. Security and failure considerations

Metadata retrieval, codecs, referenced paths, and large arrays need bounded validation and explicit resolver authority. Future external specs can differ materially, so each version receives reviewed mapping tests. The corpus ships no functioning NGFF/Zarr importer/exporter.

## 11. Verification obligations and current evidence boundary

Planned evidence includes pinned-version fixtures, 2D–5D axis maps, omitted singleton dimensions, transform composition, labels, chunk repartition, unsupported codecs/transforms, and sample/calibration/metadata round trips. Structural examples and profile prose are not these test results.

The requirement-to-test mapping in Section 6 is a traceability plan. A registered test identifier is not an executed pass. The final machine registries and verification report identify actual evidence; mandatory unexecuted obligations prevent GO for a claim that includes them.

## 12. Research and institutional boundary

P5×S³/8S mechanics are experimental inputs. Mathematical definitions, preserved bytes, deterministic computation, simulation, empirical observation, and external replication have separate evidence grades. Institutional approval, authentic grants, independent certification, and empirical validation are claimed only when separately supplied and verified. This package does not fabricate those artifacts.

## 13. Cross-specification consistency

WP15 owns calibrated coordinate bases; WP04 owns normalized geometry; WP13 confines external storage; WP16 owns derived export/loss provenance.

## 14. Change history

- **2.0.0:** Replaced generic repeated algorithm/example text with work-package-specific technical detail, formal invariants, boundary cases, and explicit implementation/verification limits. Preserved the original normative requirement table and language version; superseded blanket Internal GO and placeholder-test conformance implications.
- **1.0.0:** Initial corpus candidate generated from the serialized 28-work-package construction workflow; retained as original audit evidence.
