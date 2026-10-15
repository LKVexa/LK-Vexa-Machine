# Changelog

## 2.4.0 - 2026-10-14 - HERMIT transport and terminal delegation

Add shared XPU terminals over private channels or an optional exact-origin localhost WebSocket relay. Add an explicit, separate Administrator PowerShell capability and actual command-completion delegation to existing XPU sessions. Bound tickets, queues, frames, output and concurrent work; refuse replay and stale sessions. Cancel pending terminal opens, retain real worker error details, and clear failed worker state before notifying the interface. Add command access to checked XPU previews and explicit save tokens. Source documents remain reference data. Live checks and remaining elevated-host validation are recorded separately from protocol fixtures.

## 2.3.0 - 2026-10-14 - Finite phase/neuron XPU and actual GPU confirmation

Add five exact residue-ring operations, guarded numerical phase readout, independent BigInt checks, bounded p-adic congruence-ball neuron updates and packed 64-sample bit planes. Store five canonical 32-bit words per neuron in bounded state and TIFF byte carriage. Dispatch a literal WebGPU integer shader and compare every result; fallback, fixtures and unknown adapter identity never meet the hardware requirement.

Keep runs detached until an explicit Save, validate Float32 publication, reject stale previews and quota failures, protect the commit point from misleading cancellation, and treat restored receipts as historical. Add an isolated browser kit for real worker/storage/GPU tests. Existing byte processors, optical models and native reference harness retain their earlier semantics.

## 2.2.2 - 2026-10-13 - Native reference and startup validation

Fix native result mutation, incomplete publication, concurrent TIFF export mixing and incorrect physical TIFF calibration. Harden native OS selection, PE machine validation and exact runtime version/platform/architecture checks. Add reproducible native and browser acceptance runners and invalidate stale native validation results.

Validation: 308 Node tests pass, 3 explicit skips, zero failures of 311; 598 compiled C# assertions pass, with every pixel checked across 35 native and 35 JavaScript TIFFs. Native x64 runtime/production HTTP startup and ARM64 bytes/contracts pass. Actual ARM64 execution was not run. Production browser persistence remains BLOCKED_ENVIRONMENT with zero completed UI scenarios; the separate portable kit enables that remaining gate in a normal Windows session. See AUDIT_REPORT.md for scope.

## 2.2.1 - 2026-10-13 - End-to-end software hardening

Fix numerical/state rollback, zero-amplitude reconstruction, OAM boundary/coercion/count errors, mutable LUTs, metadata/TIFF semantic validation, shell cancellation and stale pipeline input, completion injection, UTF-8/session quotas, management races and queued interruption, power interruption, path/revision bounds, terminal cursor/conceal/color handling, Unicode command behavior, Windows filename aliases, launcher hashing/reparse cleanup, staged build/recovery and version/verification consistency. Raise the shared serialized volume/backup envelope to 32 MiB so admitted escaped-text volumes can reload/restore; the actual VFS content quota stays 2 MiB.

Validation: 304 passed, 3 explicit dynamic-link skips, zero failed of 307 Node tests; 12 independent TIFF checks and 3 TIFF/GIF decoder checks pass. Native PowerShell parsing and 3 native boundary groups pass. Production browser acceptance remains blocked by the managed environment. See AUDIT_REPORT.md for exact evidence and limitations. Source/provenance archives and compatible v3/volume-v2/HPU2 formats are preserved.

## 2.2.0 — 2026-10-12 — RUSSL corpus TIFF / pixel-logic integration

Implemented exact [4,4,4,16,16] addressing and an explicit 128×128 Float64 atlas for
the existing 64×64 complex HPU's real, imaginary, intensity and phase components.
Added a bounded typed TIFF decoder/encoder (classic/BigTIFF, II/MM, finite scalar
u8/u16/f32/f64), loss-aware visual export metadata, SHA-256 identity receipts,
revision-checked staging, real/imaginary edits and explicit guarded apply.

Added the TIFF pixel lab and `russl` terminal command, preserved HPU2/volume schemas,
private Windows Node bootstrap and original references, and regenerated twelve
sample TIFFs. Added corpus provenance, source licensing notices and full-domain
addressing checks against all 16,384 corpus vectors. Metadata uses `logicalShape`
to avoid an external library's reserved TIFF-series `shape` interpretation.

Core verification: 244 tests pass, including 18 static launcher checks; 15 offline
browser UI scenarios pass; 12 new independent TIFF checks and 3 inherited TIFF/GIF
checks pass. Native HTTP browser navigation was attempted and blocked by managed
administrator policy. Native Windows launch/download is not tested here. See
AUDIT_REPORT.md for exact scope, strict BigTIFF compatibility and acceptance gaps.

## 2.1.1 — 2026-10-12 — missing-Node startup repair

Removed the Windows launcher's dependency on `where node`/system PATH. A readable,
self-contained .cmd now provisions a pinned, official, hash-verified Node.js 24.21.0
runtime under `.runtime`. Supports Windows x64/ARM64, exact offline archive caching,
SHA-256 checks before extraction/execution, bounded HTTPS transfer, exact-entry ZIP
extraction, staging/locking, and bootstrap logs. No global installation, npm install,
PATH edits, elevation, security-policy edits, or firewall changes.

`Verify.cmd` uses the same private runtime. Added `--preflight` and `--verify` to
`Start-Console.cmd`. The single launcher also repairs an unchanged 2.1.0 package;
its log distinguishes launcher version from application version. The complete
package updates UI/worker/package metadata to 2.1.1. Wire, volume, and XPU formats
are unchanged. The verification report now distinguishes pass/skip counts and
invalidates stale PASS status before each run.

Validation: 135 existing Node tests + 18 static launcher contracts passed; 47 JS
files parsed; 45 local imports resolved; 8 offline UI fixture scenarios and 3
independent TIFF/GIF decoder checks passed. No Windows PowerShell AST parse, Windows
execution, real runtime download, or full-browser persistence certification is
claimed. See AUDIT_REPORT.md and WINDOWS_STARTUP_FIX.md.

## 2.1.0 — 2026-10-12 — local audit/hardening edition

The source identified the old UI as 1.4.0 and the worker as 2.0.0-ramws.1; the original root package did not declare a product version. This release unifies package, UI, worker, documentation, and release metadata at 2.1.0. An embedded VB-JA21 desktop label is provenance, not this release's version.

### Fixed

Shell single/double/mixed quotes, empty quoted arguments, escaping, comment boundaries, execution-time variable expansion, `$?`, aliases with nested quotes, argument counts, negative numbers, `head`/`tail -n 0`, newline-based `wc -l`, bounded `seq`, sleep cancellation, SIGINT while reading, prototype-sensitive environment names, `find` flag parsing, and `man` width rendering.

VFS root mutation/move, directory cycles, incompatible/nonempty destinations, partial recursive-mkdir quota failures, recursive-mkdir-on-file behavior, stale touch persistence, buffer aliasing, untrusted snapshot names/shape/quota, and nondeterministic factory hashes.

Incomplete/malformed HPU state restore, nonfinite inputs, stale byte views, zero valuation, Kerr truncation normalization, and encoder input/geometry limits. Persist all HPU2 state instead of only selected arrays.

### Hardened

Fail-closed volume recovery; single-writer Web Locks; transactional revision checks; SHA-256-protected volume records; previous-record retention; bounded restore; backup export; quiesced power operations. New wire protocol v3 validates control envelopes, sessions, sequences, kinds, sizes, flow credit, and terminal geometry; client teardown settles outstanding work. Regexes run in a disposable time-limited worker. VFS, sessions, input, output queues, snapshots, and image exports have explicit limits.

Local Node-only static host: loopback binding, strict Host/Origin/path checks, no symlink serving, method and resource limits, CSP/security headers, no command-execution endpoint. Windows launchers keep errors visible and make no administrative/security-policy changes.

### Changed / compatibility

Replaced unused cloud/UI scaffold dependencies with a native-module local UI; preserved originals in audit archives. Added a 60-command reference tab, backup/restore/file-download controls, explicit power-off/reboot behavior, and accurate software-only XPU descriptions. `hermit.vws.v3` must be used by both ends; volume v2/HPU2 writes are not downgrade-compatible. C# `Cpu`/`Gpu` method names are retained as reference compatibility identifiers; both are software loops.

### Evidence / outstanding

Node regression results, independent TIFF/GIF decoding, offline Chromium UI fixtures, and recursive inventory are included. Native Windows execution, real-browser IndexedDB/Web Locks/worker/CSP integration, .NET compilation, old cloud deployment, and hardware performance are not claimed as tested.
