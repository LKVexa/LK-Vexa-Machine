# Finite phase-coded XPU specification and source audit

This specification turns the supplied papers into a finite numerical processor that can run on the laptop's existing CPU and GPU. The papers are research material, not instructions to run embedded commands. All ten assigned PDFs were extracted read-only, with their source SHA256 hashes and page counts recorded in `PDF_EXTRACTION_MANIFEST.json` (134 pages total). Important equations lost by text extraction were checked visually in `bit-anti-05.png`, `bit-anti-06.png`, and `geometric-asm-04.png`.

## Mathematical types and limits

Value arithmetic uses the finite residue ring `R = Z/(p^k Z)`, with prime `p`, integer `1 <= k <= 16`, and `M = p^k <= 65536`. A residue is an exact integer in `[0,M-1]`. This is a ring; it is not a field when `k > 1`, and division is permitted only for invertible elements. The current core implements addition, subtraction, multiplication, modular negation and digit complement. Default `p=2,k=8` gives the familiar 8-bit wraparound domain. `[p-adic Bit and Anti-bit, pp.5-6](<C:/Users/russe/Downloads/p-adic Bit and Anti-bit.pdf>)` explicitly connects finite registers with `Z/(2^N Z)`.

Complex carriers are ordinary Float64 numerical pairs. Optical display/storage components use canonical Float32 values. These are different types from residues and from real neuron states. A value-precision `k` must not silently become the precision of coordinate addresses: 4,096 neurons need 12 binary address digits, even if each arithmetic value uses only 8 digits. Canonical input count is `1..4096`; the integrated model uses exactly 64x64 samples.

## Phase arithmetic and independent confirmation

Encode `a` as `C(a) = exp(2*pi*i*a/M)` using the half-open phase interval `[0,2*pi)`. In exact mathematics:

- `C(a+b) = C(a)*C(b)` implements residue addition.
- `C(a-b) = C(a)*conjugate(C(b))` implements subtraction.
- `C(a*b) = C(a)^b` implements multiplication by integer exponentiation; repeated squaring bounds its work to 16 exponent bits.
- `C(-a) = conjugate(C(a))` implements modular negation.
- `C(M-1-a) = C(M-1)*conjugate(C(a))` implements digit complement.

The distinction between the last two operations matters. For binary `M=2`, modular negation leaves 0 and 1 unchanged, while Boolean complement swaps them. Two's complement is digit complement followed by addition of one, as shown in the visually reviewed source pp.5-6. An antipodal phase shift is also a separate operation; it has no exact residue interpretation for odd `M` and is not implemented as an implicit substitute.

The phase decoder rejects nonfinite components, zero/unreadable amplitude and insufficient decision margin. It computes `round(M*arg(C)/(2*pi)) mod M`. Decision margin is measured in residue-cell units, with 0.5 at an ideal code point and 0 at a rounding boundary. Default required margin is 0.49. Every CPU phase batch is compared against direct BigInt modular arithmetic before it is returned; malformed operands never produce a partially returned batch. This is a numerical correctness check, not evidence of physical light propagation.

An actual GPU integer shader can independently calculate the same residue operations and confirm every CPU phase readout. A CPU loop named GPU is not a GPU backend. GPU phase arithmetic and GPU neuron evolution remain separate claims until those algorithms are implemented and tested on an actual GPU. Maximum products fit unsigned 32-bit arithmetic: `65535*65535 = 4294836225 < 2^32`.

## Sampling, packed bit planes, and neuron addresses

For a numerical complex field, `I_i = re_i^2 + im_i^2`. The sampler uses `q_i = round((M-1)*I_i/max(I))`, with all-zero input explicitly producing zero codes. This is relative-peak quantization and discards absolute intensity scale. Neuron drive is `U_i = 2*q_i/(M-1)-1`, a real value in `[-1,1]`. A threshold bit and its Boolean anti-bit satisfy `b + anti_b = 1`; neither is a negative-energy state.

Bit-plane packing uses 64-sample storage blocks, two uint32 words per plane/block, with bit-major layout. It packs 8-bit values into exactly 8 data bits per sample; it does not create additional information capacity. Padding is zero and validated on unpack. Packing blocks are a memory layout, not automatically the same thing as neural neighborhoods.

For integer addresses, `v_p(n)` counts factors of `p`, with `v_p(0)=infinity`; `d_p(a,b)=0` when equal and otherwise `p^(-v_p(abs(a-b)))`. Congruence balls are sets sharing low base-p digits. The 64x64 binary grid uses coarse-first Morton digits, so a level-6 address ball contains an 8x8 region (64 neurons). A normal high-to-low image hierarchy requires this explicit digit mapping; ordinary consecutive pixel indices alone do not prove spatial locality. Odd-prime domains use an explicitly labeled finite integer-address hierarchy.

These definitions follow the valuation/norm discussions in [P-adic Hologram Processing Architecture, pp.4-5](<C:/Users/russe/Downloads/P-adic Hologram Processing Architecture.pdf>) and [p-adic Architecture in Image Formats, pp.2-3](<C:/Users/russe/Downloads/p-adic Architecture in Image Formats.pdf>). The finite model is not the whole infinite field `Q_p`.

## Bounded hierarchical neuron evolution

[p-adic Architecture in Image Formats, pp.6-7](<C:/Users/russe/Downloads/p-adic Architecture in Image Formats.pdf>) describes real-valued cells on p-adic addresses, a reaction/diffusion equation and the clipped sigmoid `f(x)=(abs(x+1)-abs(x-1))/2`. The implemented finite approximation is:

`x_i_next = (1-dt*(leak+coupling))*x_i + dt*(reaction*f(x_i) + coupling*mean_ball(x)_i + drive*U_i + bias)`.

All outputs use the same previous state (double buffering). Defaults are `dt=.25`, `leak=1`, `reaction=1.5`, `coupling=.25`, `drive=.5`, `bias=0`, `stateLimit=4`. The mean is over a finite normalized congruence ball, including the cell itself. This is an explicit finite kernel, not a claim to implement the full Vladimirov integral.

The invariant bound is proved by requiring `dt <= 1/(leak+coupling)` and `reaction+drive+abs(bias) <= leak*stateLimit`, with `abs(U)<=1`, `abs(x)<=stateLimit`. The coefficient of the old state is nonnegative; applying the triangle inequality gives `abs(x_next)<=stateLimit`. The sigmoid is genuinely nonlinear outside `[-1,1]`; default `reaction>leak` permits bistable behavior. Boundedness does not imply a unique stationary state, image-denoising accuracy or learned intelligence. No trained parameters or labeled task dataset were supplied for this core.

After canonical Float32 neuron rounding, amplitude coupling is `A_i = 1 + g*f(x_i)`, `0 <= g < 1`, default `g=.5`. The persisted carrier is `A_i*C(q_i)`; its phase must still decode to the confirmed residue. The positive amplitude preserves readability. This is a declared numerical coupling between a neuron state and a displayed carrier, with dimensionless units.

## Source constraints and unsupported extrapolations

| Source | Relevant material | Operational decision or limitation |
|---|---|---|
| P-adic Hologram Processing Architecture, pp.2-3, 4-7 | LAMB moment/error-feedback updates; valuations; wavefront LUTs | Use finite valuations and explicit CPU/GPU computations. Do not claim LAMB training or an O(N) full hologram merely from table lookup; fetched pattern size and accumulation remain work. Its p.2 adaptive-update notation is malformed and must not be copied blindly. |
| p-adic Architecture in Image Formats, pp.2-4, 6-7 | Residues, FCSR, CNN equation and sigmoid | `Z/(p^r)` is not a Galois field for r>1. Negative additive inverses exist. Finite registers overflow/wrap. FCSR seeds are not cryptographic authenticity. The paper's `mu<=0` statement alone does not prove stability with unrestricted reaction terms. Use the explicit bound above. |
| Holographic Geometric Diffusion Computing, pp.4-9 | Angular-spectrum propagation, sampling and relocation cycle | Numerical ASM can be backtested with plane waves and conservation/reversal checks. The continuous Fourier pair on p.4 omits the inverse `(2*pi)^-2` normalization under its angular-frequency convention; the finite implementation must define normalization explicitly. MHz rates, SLMs, photodetectors, ADCs and DMA are physical devices absent from the laptop software model. |
| Quantum States Digital Holography, pp.2-6, 9-13 | Bit/anti-bit models, quantum holography and physical capture hardware | Dual-rail bits and complex samples can be represented numerically. Toy theories, photonic capture and proposed bypasses of Landauer's bound are not demonstrated by these computations. |
| Quantum Computation and Circuit Evolution, pp.1, 4-7 | Normalized complex state vectors, unitary gates, Clifford/non-Clifford distinctions | A separate finite quantum-state simulator would require normalized states and explicitly defined gates/measurement. This phase ring is not an arbitrary quantum circuit simulator or a physical qubit. |
| Quantum Computation Equations Overview, pp.1-5, 8-11 | Density operators, QFT, walks and Hamiltonian/Lindbladian evolution | Physical density matrices need Hermiticity, positive semidefiniteness and trace one. A general complex field or modular phase carrier does not satisfy those requirements automatically. FFT, QFT and a p-adic transform are distinct operations. |
| p-adic Bit and Anti-bit, pp.2, 5-7, 10-15 | Valuation, finite two's complement, proposed p-adic quantum/entropy theories | Finite modular arithmetic and complement distinctions are implementable. Negentropy or negative-energy interpretations are not measured by ordinary RAM samples and are excluded from runtime claims. |
| Black_Hole_Master_Equations, pp.1-4 | Classical black-hole laws, Hawking formulas, Kerr/Newman and Teukolsky equations | These equations specify astrophysical variables and assumptions. No mapping from laptop neuron buffers to those physical quantities was supplied. They are contextual references, not CPU/GPU kernel specifications or evidence of a black-hole device. |
| p-Adic 1-Bit LAMB Architecture, pp.1-2, 6-11 | Warmup/frozen variance and proposed p-adic hardware optimization | A real LAMB implementation needs gradients, moment tensors, error feedback, optimizer schedules and task-level convergence evidence. Binary neuron thresholding is not 1-bit LAMB. Exact residue arithmetic alone does not prove real-valued optimizer convergence or network speedup. |
| p-Adic Architecture Unification, pp.2-10 | Broad p-adic geometry, physics and learning analogies | Valuation/congruence hierarchy is retained. Claimed resolutions of singularities, emergent gravity or inference accuracy require separate mathematical/physical evidence and are not runtime assertions. |

## Acceptance evidence

`CORE_INDEPENDENT_RESULTS.json` records 344,580 phase arithmetic/readout checks, 25,440 packed samples, 16,384 valuation cases, 98,304 ultrametric triples, 262,208 bounded-neuron samples and 13 malformed-input guards, all PASS. The phase tests include all 65,536 byte pairs for add/sub/mul, all 65,536 phase codes at maximum modulus, prime-3 and prime-5 domains, binary complement versus negation, boundary operands and seeded inputs. Bit-plane words are compared with a separate BigInt bit-sum oracle. The neuron step is checked against a dense distance-based operator and the differential form of the equation, followed by 64 bounded full-field steps.

These tests establish the declared finite numerical rules. Integrated model persistence, real GPU execution and browser UI operation have their own acceptance gates and must not inherit PASS merely from this core report.
