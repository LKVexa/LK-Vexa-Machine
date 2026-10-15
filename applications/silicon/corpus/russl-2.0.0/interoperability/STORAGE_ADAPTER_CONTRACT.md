# Storage Adapter Contract — Research Candidate

**Profile:** `RUSSL-ADAPTER/2.0.0`; core language compatibility RUSSL/1.0. This expands the WP13 design boundary. No backend, transaction engine or deployment implementation is established by this document.

## Semantics and identities

An adapter translates physical bytes/locations to logical immutable handles. Physical keys, TIFF offsets, Zarr paths, object-store ETags and filesystem names never become core field coordinates or authorization. Distinguish `source_blob_sha256` (exact imported bytes), core domain-separated identities (WP17), decoded logical-sample equivalence, and derived export bytes. Identical decoded fields can have different source/export hashes.

## Required abstract interface

| Operation | Precondition and result | Failure/limit |
|---|---|---|
| `put(bytes) → digest` | Accept bounded byte string; compute content digest; publish immutable content only after complete write and verification | Partial writes not discoverable as complete; caller receives a stable failure |
| `get(digest) → bytes` | Exact digest-bound object, verified before returning trusted bytes | Missing, denied and corrupt are distinct outcomes; no silent substitute |
| `has(digest) → bool` | Advisory availability at observation time | Not proof of integrity, durability, permission or future availability |
| `verify(digest, bytes)` | Recompute selected digest with explicit domain/algorithm | Fail on malformed digest or mismatch; never trust ETag as equivalent |
| `capabilities() → record` | Profile ID/version, size limits, integrity mode, consistency, atomicity, permitted methods, supported codecs | Unsupported capability remains absent; do not infer it from provider brand |

Logical WP13 methods are retained; this document specifies review obligations rather than adding core operators. A backend that only stores mutable paths needs an immutable object mapping before conforming.

Optional `get_range` uses checked half-open byte ranges and total-object identity. Range bytes alone cannot verify a whole-file digest: obtain complete object or a separately defined authenticated chunk/Merkle proof. Optional `get_region` returns requested logical intervals, sample/type metadata, membership evidence and declared missing samples. Optional pin/replication/listing methods record availability hints, never redefine core meaning. A promised compare-and-swap or transaction needs a precise deployment linearization point and fault tests; unsupported multi-object atomicity cannot be synthesized from `put`.

## Adapter receipt

A receipt identifies adapter/profile and implementation version, source and output identities, standards versions, input inventory, logical shape/type, axis permutation, coordinate transforms/units, codecs, metadata preservation map, output classification, observed losses, resource limits, runtime environment and actual test results. `LOSSLESS` refers to declared logical-sample/semantic equivalence; exact source-byte recovery is a separate property. `REVERSIBLE_WITH_METADATA` requires all inverse information preserved and exercised. `LOSSY` lists each changed/discarded property and error metric. `UNSUPPORTED` yields a rejection or explicitly separate opaque archival object; it is not a successful lossless field import.

## Hardening and trust

Treat headers, dimensions, strides, counts, ranges, codec names, nested metadata and referenced paths as untrusted. Before allocation, bound every dimension/product and decoded size, recursion/IFD count, path depth, codec expansion, CPU time and metadata bytes. Parse declaratively; use a supported-codec allowlist and isolated decoders. Reject path traversal, absolute/drive/network paths and references escaping an approved dataset root. Retrieval of remote linked content requires a deployment allowlist and authorization; importing a URI does not authorize its fetch.

An absent Zarr chunk, failed network request, corrupt object, transparent pixel and sparse undefined sample are distinct states. Capture snapshots/version IDs or complete digest inventories to prevent mixing source versions during partial reads. Enforce access independently of deduplication; content-addressed names can leak existence. Do not log credentials or personal metadata into unrestricted provenance.

## Proposed acceptance matrix

| Obligation | Positive test | Adverse test | Current evidence |
|---|---|---|---|
| Adapter substitution | Same declared field under two backends | Backend key leaks into core identity | Core design/fixtures only |
| Integrity | Complete verified put/get | Corruption/truncation/ETag substitution | Deployment test required |
| Resource limits | Bounded exact decoded size | Overflow, huge shape, expansion bomb | Adapter implementation required |
| Consistency | Immutable snapshot retrieval | Mutation during import | Backend evidence required |
| Loss accounting | Reversible import/export through independent reader | Dropped tag/axis/dtype/transform | External adapter evidence required |
| Authorization | Approved effect with real trust verification | Missing/expired/revoked/wrong-scope grant | Deployment evidence required |

Tests are proposed adapter acceptance obligations, not newly claimed executed results. A conformance report identifies implemented capabilities and unsupported cases explicitly.
