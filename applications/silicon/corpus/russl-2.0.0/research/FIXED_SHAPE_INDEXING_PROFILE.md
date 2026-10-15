# Fixed-Shape Indexing and Experimental Topology — 4×4×4×16×16

**Status:** experimental mathematical/indexing profile, corpus 2.0.0. **Evidence:** exact generated integer/rational data and scoped regression tests. This profile does not establish sample values, an optimizer, optical hardware, quantum state, p-adic physical dynamics or an evaluated mechanics model.

## Domain and exact quantities

Let `i=(i4,i5,i6,i7,i8)`, with `0≤i4,i5,i6<4` and `0≤i7,i8<16`. There are `4³×16²=16,384` scalar sites. Axes are c4–c8. The active coherent RUSS fixture declares this shape with scalar f64, while its source.state placeholder remains unresolved. Original contradictory bytes remain under examples/legacy_golden/ and are rejected by current field-binding verification.

| Representation | Ideal scalar payload | Scope |
|---|---|---|
| f64 | 131,072 bytes / 128 KiB | eight bytes per scalar |
| f32 | 65,536 bytes / 64 KiB | four bytes per scalar |
| u16 | 32,768 bytes / 32 KiB | two bytes per scalar |
| u8 | 16,384 bytes / 16 KiB | one byte per scalar |
| packed one-bit samples | 2,048 bytes / 2 KiB | representational minimum, not lossless f64 equivalence |

These figures exclude masks, coordinates, units, tensor/channel components, headers, manifests, compression, padding, indexes, allocator overhead, gradients, optimizer states, error buffers and shared GPU memory. A one-bit communication optimizer cannot justify substituting one bit for each field sample. A complex/vector sample needs an explicit component contract and a different payload calculation.

## Bijection and observable oracle

The selected ordering is row-major with c8 fastest:

`k=((((i4×4+i5)×4+i6)×16+i7)×16+i8)`.

Strides are `(4096,1024,256,16,1)`. The index bit widths `(2,2,2,4,4)` sum to fourteen. An equivalent packed ordinal is `(i4<<12)|(i5<<10)|(i6<<8)|(i7<<4)|i8`. A 16-bit transport representation would have two unused upper bits; their interpretation and byte order need a separately identified adapter contract. Code here operates on bounded mathematical integers, not a new wire ABI.

The inverse is `ij=(k//stride_j) mod shape_j`. [Layout registry](../machine/registries/fixed_shape_layout.json) fixes ordering, strides, cardinality and fixture digest. [Exhaustive vectors](../tests/vectors/field/fixed_shape_index_vectors.jsonl) contain every ordinal and index tuple in ascending ordinal order. They were generated from the explicit formula. Tests check all 16,384 pairs and endpoint/stride transitions, rejecting booleans, fractional values and out-of-domain coordinates. This provides a complete finite bijection check, not a benchmark.

Normalized coordinates are exact rationals: size-four axes have `(-1,-1/3,1/3,1)`; size-sixteen axes have `cj=(2ij−15)/15`. Spacings are 2/3 and 2/15. These normalized coordinates do not establish physical length, acquisition time, channel semantics or isotropic physical sampling. Physical calibration remains separately bound metadata.

## Optional 2-adic organization

A finite bit organization can embed ordinals as integers in Z₂ or use the residue ring Z/2¹⁴Z. The finite ring is not the p-adic field Q₂. The implemented experimental distance is `d₂(a,b)=0` when equal, otherwise `2^(−v₂(a−b))`. For distinct fourteen-bit ordinals, valuations are between zero and thirteen. The strong triangle inequality describes this metric's mathematical topology; it does not establish relevance to the mechanics or to an imaging task.

This ordering is sensitive to the packed index convention. `d₂(0,1)=1`, while `d₂(0,4096)=1/4096`. Thus a change along c4 can be 2-adically close and a one-step c8 change relatively far. This does not preserve the Euclidean neighborhoods of the normalized five-dimensional base. Low-bit congruence classes and high-bit prefix blocks are different trees. Bit reversal, Morton/interleaved codes and Monna-type maps are distinct mappings and require their own definitions, collisions/order tests and evidence. No mandatory p-adic reinterpretation is applied to the core field.

The utility module checks integer domains, exact rational coordinates, ordinal packing/unpacking and the optional distance. It evaluates no source row, sample array, field coupling, S³ fiber or module. Scientific claims cannot follow solely from the fact that the coordinates are powers of two.

## Research design

Experiment FS-01 compares row-major, an explicitly defined interleaved ordering and a low-bit residue hierarchy on the same lawful immutable sample payload. Preregister the locality/query task, indexes, original sample semantics, accuracy oracle, memory accounting, preprocessing amortization and hardware. Report both normalized Euclidean and selected hierarchy distances; choose no ordering after observing which yields a favorable metric. Storage layout is an adapter concern; ordinal identity and logical sample identity are assessed separately.

Experiment FS-02 tests representation changes using f64 as a specified reference, with f32/u16/u8/packed-bit transformations each defining calibration, quantizer, rounding, clipping, missingness and reconstruction. Measure error and task-specific information loss. Byte count reduction is a derived accounting fact; it is not evidence of preserved signal, optical fidelity, optimizer convergence or system energy efficiency.

Experiment FS-03 benchmarks hierarchy querying using identical samples and independently checked query outputs. Include index construction, serialization, transfer, decode and query time. The sixteen-thousand-site field is small; extrapolation to BERT-scale optimization, microscopy acquisition or distributed clusters requires new measurements. Exact index enumeration is the only completed data-producing experiment in this profile.

All three proposed experiments remain unexecuted. Their adoption requires a reviewed implementation and a result record that names inputs, code, platform, random seeds, uncertainty and negative outcomes. The source reviews explain which attached claims motivate a hypothesis and which are rejected.
