# WP17 — Canonicalization and Cryptographic Identity

**Version:** 2.0.0  
**Status:** Hardened Research / Institutional Candidate — unratified  
**Normative class:** Core  
**Corpus:** RUSSL Research & Institutional Corpus 2.0.0  
**Language/profile:** RUSSL/1.0 hardened reference profile (corpus 2.0.0)

## 1. Scope
Defines canonical source/data forms, digest domains, and identity URIs.

This 2.0.0 specification supersedes the unsupported blanket Internal GO implication of the original package. It is a proposed technical contract with scoped implementation evidence, not ratification or external certification. The language header remains RUSSL/1.0. Section 6 preserves the original requirement IDs and normative statements for traceability. Sections 7–13 add technical interpretation, design obligations, examples, and verification boundaries; they introduce no new normative requirement IDs.

Dependencies below are architectural relationships, not an instruction to execute attached content or proof that those dependencies have been implemented. Baseline mechanics remain experimental; absent external authorization and research source material remain absent.

## 2. Non-goals
- It does not make a storage backend the semantic definition of RUSSL.
- It does not treat mathematical admission as cryptographic or organizational authorization.
- It does not invent missing external attestations, source documents, or scientific validation.

## 3. Normative terminology
`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are requirement terms. "Core" means language/IR/tuple/field semantics independent of physical storage. "Profile" means a scoped interoperability or deployment contract.

## 4. Definitions and dependencies
**Dependencies:** WP01, WP06, WP07.

**Mandatory deliverables:**
- Unicode normalization
- numeric representation
- map ordering
- canonical JSON
- domain hashes
- test vectors

## 5. Normative model
### Canonical identities
Canonical source uses UTF-8/NFC/LF/no-BOM/trailing-whitespace removal. Corpus canonical JSON sorts object keys and emits no insignificant whitespace; NaN and infinities are invalid. Identity domains are prefixed with an ASCII domain and NUL separator before hashing.

Domains include `RUSSL-SOURCE/1.0`, `RUSSIR/1.0`, `RUSS-TUPLE/1.0`, `RUSS-PAYLOAD/1.0`, and `RUSS-EVIDENCE/1.0`, preventing cross-domain digest confusion.

## 6. Normative requirements
| Requirement | Normative statement | Conformance mapping |
|---|---|---|
| `WP17-REQ-0001` | Canonical RUSSL source MUST be UTF-8, NFC, LF-terminated, BOM-free, and free of trailing SP/TAB. | `WP17-TEST-0001` |
| `WP17-REQ-0002` | Identity-critical JSON MUST use UTF-8, sorted keys, no insignificant whitespace, and MUST reject NaN/Infinity. | `WP17-TEST-0002` |
| `WP17-REQ-0003` | Identity-critical exact decimals SHOULD be represented as canonical strings where binary-float ambiguity would alter identity. | `WP17-TEST-0003` |
| `WP17-REQ-0004` | Source, RUSSIR, tuple, payload-root, and evidence identities MUST use domain-separated hash inputs. | `WP17-TEST-0004` |
| `WP17-REQ-0005` | SHA-256 is the baseline digest algorithm for corpus 1.0. | `WP17-TEST-0005` |
| `WP17-REQ-0006` | Cross-version identities MUST include the defining schema/version domain. | `WP17-TEST-0006` |
| `WP17-REQ-0007` | The specification MUST preserve the architecture boundary `RUSSL → MSSL → RUSS tuple-executable → Penteract field → distributed fabric`. | `WP17-TEST-0007` |
| `WP17-REQ-0008` | Normative requirements MUST distinguish core semantics from adapter/profile behavior. | `WP17-TEST-0008` |
| `WP17-REQ-0009` | Unresolved required references, ambiguous authority, or incompatible major versions MUST fail closed. | `WP17-TEST-0009` |
| `WP17-REQ-0010` | Every testable MUST in this specification MUST be traceable to a conformance test or validation rule. | `WP17-TEST-0010` |

## 7. Technical interpretation and algorithms

### Exact preimages and separate identity levels
For a domain D and canonical payload B, `digest(D,B)=SHA256(ASCII(D)||0x00||B)`. The displayed `sha256:` or URI prefix is not part of B unless explicitly specified by that object's schema. Module/member file digests instead hash raw bytes; a verifier distinguishes these operations.

Source canonicalization decodes strict UTF-8, normalizes CRLF/CR to LF, applies NFC, removes trailing SP/TAB per line, removes excess trailing empty lines, and emits one final LF without BOM. Canonicalization is idempotent: `C(C(s))=C(s)`. It preserves comments and significant cell text. A strict ingestion policy can reject unsafe controls before normalization; normalization never establishes syntactic validity.

### Corpus JSON profile
The current serializer emits compact UTF-8 JSON with recursively sorted string keys, preserved array order, and finite numeric values. Python key ordering uses Unicode code-point order. Duplicate keys, nonfinite constants, invalid Unicode, and unsupported values are rejected by strict ingestion before identity reliance. Exact decimals can remain canonical strings with a declared decimal grammar; strings are not automatically converted into binary floats.

This is the corpus-specific Python serialization profile, not RFC 8785/JCS. JCS uses ECMAScript numeric serialization and UTF-16 property ordering, and preserves JSON string data without Unicode normalization. Cross-language consumers therefore use the published corpus bytes/vectors or implement the exact stated profile; substituting a JCS library can change identity. [RFC 8785, §§3.1–3.2](https://www.rfc-editor.org/rfc/rfc8785.html)

### Floating and migration boundaries
Finite `1`, `1.0`, and `-0.0` need not serialize identically in this profile. Numeric equality does not imply JSON-byte equality. Binary sample payload NaNs, if allowed by a separate dtype profile, are different from NaN in identity-critical JSON metadata.

The source/IR/tuple domains retain /1.0 because their defining language/profile remains 1.0. A new canonicalization rule requires an explicit migration and identity-domain decision. The corpus package version records document/tooling change; it is not silently substituted into an existing identity preimage.

## 8. Worked example

For object `{"b":2,"a":1}`, the corpus canonical JSON bytes are UTF-8 `{"a":1,"b":2}`. Domain-separated hashing prepends `RUSSIR/1.0`, a single NUL byte, and those bytes. Hashing the pretty-printed input or the textual characters `\\0` produces a different result.

Two source files differing only in CRLF versus LF canonicalize to the same source bytes. A source file with an extra retained comment can have different identity despite equivalent row behavior.

## 9. Boundary and adversarial cases

| Defect | Identity consequence |
|---|---|
| Duplicate JSON keys | Ambiguous object; reject before hashing. |
| NaN/Infinity JSON numbers | No valid finite canonical representation. |
| Sorting tuple-array elements | ABI order and identity change. |
| Hashing a raw module using the source domain | Wrong identity relation. |
| Swapping JCS for Python serializer without migration | Unicode/numeric outputs can diverge. |
| Excluding a security-sensitive field ad hoc | Identity no longer binds the complete contract. |

## 10. Security and failure considerations

SHA-256 equality assumes collision/preimage resistance and correct implementation. It supplies no signer authenticity, permission, or scientific validation. Canonicalization also does not eliminate visually confusable but distinct identifiers; authority-bearing syntax needs lexical restrictions and review.

## 11. Verification obligations and current evidence boundary

Current evidence includes source/hash vectors, strict JSON negatives, domain separation, idempotence, and golden identities. Independent cross-language numeric/Unicode vectors are still needed before claiming broad canonicalization interoperability. The package explicitly avoids a JCS conformance claim.

The requirement-to-test mapping in Section 6 is a traceability plan. A registered test identifier is not an executed pass. The final machine registries and verification report identify actual evidence; mandatory unexecuted obligations prevent GO for a claim that includes them.

## 12. Research and institutional boundary

P5×S³/8S mechanics are experimental inputs. Mathematical definitions, preserved bytes, deterministic computation, simulation, empirical observation, and external replication have separate evidence grades. Institutional approval, authentic grants, independent certification, and empirical validation are claimed only when separately supplied and verified. This package does not fabricate those artifacts.

## 13. Cross-specification consistency

WP01 fixes source canonical text; WP06 and WP07 state self-identity exclusion and tuple ordering; WP18 binds the exact serializer/toolchain in reproduction evidence.

## 14. Change history

- **2.0.0:** Replaced generic repeated algorithm/example text with work-package-specific technical detail, formal invariants, boundary cases, and explicit implementation/verification limits. Preserved the original normative requirement table and language version; superseded blanket Internal GO and placeholder-test conformance implications.
- **1.0.0:** Initial corpus candidate generated from the serialized 28-work-package construction workflow; retained as original audit evidence.
