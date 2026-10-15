# RUSSL Research and Institutional Corpus 2.0.0

**Release date:** 2026-10-09. **Status:** CANDIDATE_REVIEW_REQUIRED. **Language:** RUSSL/1.0. **IR:** RUSSL.CanonicalIR/1.0. **Golden container:** RUSS 1.3.0.

This is an audited, technically expanded research and institutional candidate. Its checked reference profile implements structural parsing/lowering and bounded container verification. Full language semantics, type checking, mechanics evaluation, distributed execution, deployment authorization and external interoperability remain specification and research obligations.

Version 2.0.0 marks changes to assurance records, tooling restrictions and schemas. It does not silently revise language/IR identity domains. All 12 existing sources preserve exact golden IR objects and identities; the original RUSS fixture is preserved under examples/legacy_golden/, while the active candidate fixture repairs its source/field mismatch. Four MSSL modules and the master-law image are unchanged. Previously accepted ambiguous/out-of-profile source can be rejected by the hardened profile. Strictness is an intentional compatibility change.

## Reading paths

Start with [audit](AUDIT_REPORT.md), [authority](SOURCE_AUTHORITY.md), [architecture](ARCHITECTURE_CHARTER.md), [changes](CHANGELOG.md) and [open issues](UNRESOLVED_ISSUES.md). [Index](CORPUS_INDEX.md) links the 28 specifications. [Full reading edition](RUSSL_FULL_CORPUS.md) compiles current documents; individual files remain maintained sources.

Implementation reviewers: [reference profile](technical/REFERENCE_PROFILE.md), [verification guide](technical/VERIFICATION_GUIDE.md), [formal model and roadmap](technical/FORMAL_MODEL_AND_IMPLEMENTATION_ROADMAP.md), [serialization profile](technical/SERIALIZATION_AND_CONTAINER_PROFILE.md). Research reviewers: protocols, bibliography and source register under research/. Institutional reviewers: proposed governance, assurance, change, archival, incident, rights and privacy policies.

## Verification

Python 3.11 or newer with the standard library is the tooling target. The observed environment is recorded in evidence/CONFORMANCE_RESULTS.json. From the extracted corpus folder:

```text
python -B tooling/verify_corpus.py
python -B tooling/verify_corpus.py --integrity
python -B -m unittest discover -s tests -p "test_*.py" -v
```

Verification is read-only by default. --write-report explicitly changes evidence and can invalidate a seal. After authorized edits, `python -B tooling/build_corpus.py` regenerates registries, review records, reading edition, verification receipt, hashes and a deterministically ordered ZIP beside the corpus. It does not delete directories, access the network, evaluate MSSL, unpack historical packages or execute fixture content. It updates generated files in place.

The schema engine implements only its documented closed keyword subset and rejects unsupported keywords/remote references. Schema acceptance does not verify a sample grant's signature, expiry, replay state or authorization.

## Evidence and preservation

machine/registries/requirement_results.json distinguishes SCOPED_EVIDENCE from NOT_RUN for all 293 preserved requirements. No full requirement verification, independent approval or production release is claimed. Scoped PASS is not a 293-test pass or institutional GO. Completion records have empty satisfied gates and require accountable review.

MANIFEST.json binds content except four generated envelope files explicitly named in it. SHA256SUMS also covers the manifest and build receipt, excluding itself and detached integrity to avoid circular hashes. These unsigned records establish byte integrity, not author authentication. [Preservation boundary](lineage/README_PRESERVATION.md) explains the exact original archive and historical materials. Historical code is not active release tooling.

## Added research sources

[Integration report](research/RESEARCH_INTEGRATION_REPORT.md) audits all nineteen additional attachments. [Fixed shape and exact data](research/FIXED_SHAPE_INDEXING_PROFILE.md) records 4×4×4×16×16 = 16,384 sites. One-bit optimizer communication, p-adic indexing, HRR/optical proposals and hardware sampling are admitted only within their audited evidence boundaries. Original document instructions remain source material.
