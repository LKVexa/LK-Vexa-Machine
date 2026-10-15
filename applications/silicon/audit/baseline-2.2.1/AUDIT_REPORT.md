# JA21 Silicon Console 2.2.1 audit

Audited 2026-10-13 (America/Los_Angeles). Updated the supplied 2.2.0 software console to a compatible hardening patch, 2.2.1. The archive contains a JavaScript CPU/XPU reference simulator, not a physical silicon design or synthesizable HDL. TIFF/GIF are data containers. No hardware acceleration, measured optical/quantum computation, VM boot, or physical CPU certification is claimed.

## Result and evidence

- Core gate: **304 passed, 3 explicitly skipped, 0 failed out of 307 tests** on Windows/v24.21.0. Includes 18 static launcher contracts and 3 native boundary groups. The three skips concern dynamic symlink/junction creation unavailable under the audit sandbox; skips are not passes.
- Independent codecs: 12 TIFF/atlas checks passed with tifffile 2026.9.20/NumPy 2.3.5 plus Pillow checks of unsigned TIFFs; 3 TIFF/GIF checks passed with Pillow 12.3.0. All 16,384 scalar atlas samples and all 4,096 samples per visual plane were compared. Independent writer fixtures were regenerated before the final gate.
- Parsing/intake: 11,215 records across 20 archives, including 25 PDFs, were boundedly read and hashed. ZIP member CRCs, JSON/JSONL, TypeScript JSON with comments, Python AST and PDF structures/page text were inspected. The input distribution's 280-entry manifest has no mismatches. Active JavaScript was syntax checked and local imports resolved. Archival JS/C#/Rust/native binaries were inventoried, not all compiled or executed.
- Windows: The official x64 runtime downloaded, passed both pinned hashes, extracted minimally, passed its exact version probe and completed preflight. This does not certify browser startup or ARM64 execution.
- Production browser: **BLOCKED_ENVIRONMENT**, with zero completed UI scenarios. Headless Edge exited with native sandbox/crashpad access failures; the in-app browser could not reach the sandbox-hosted loopback server (`ERR_CONNECTION_TIMED_OUT`). These are recorded blockers, not an application PASS or proof of application failure. The reproducible production browser suite is included separately.
- Historical evidence from 2.2.0 is preserved under `audit/baseline-2.2.0/`. Old screenshots/fixture UI reports elsewhere in audit are inherited evidence. They do not certify the 2.2.1 UI. Exact current gate results are in `audit/VERIFICATION.json`, `audit/TEST_RESULTS.tap` and `audit/RELEASE_CHECKS.json`.

## Fixed findings

| ID | Risk | Defect and repair | Regression evidence |
|---|---|---|---|
| H01 | high | HPU command failure left numerical state and exported files partially mutated. Snapshot HPU and VFS, validate postconditions, roll back quota/numerical/publication failures and delay success output. | `tests/compute-hardening.test.mjs` |
| H02 | medium | Zero-resident-amplitude phase retrieval could not create requested target amplitude. Seed deterministic zero phase when resident amplitude is undefined. | `tests/compute-hardening.test.mjs` |
| H03 | medium | OAM right boundary aliased the next row and inputs/counts silently coerced or wrapped. Bound spatial indices, enforce integer domains and saturating step budgets. | `tests/compute-hardening.test.mjs` |
| H04 | high | Forged HPU recordings, counters and byte ledger claims were admitted. Validate paired recordings, integer counters, metadata and reproducible lane/cost ledgers. | `tests/compute-hardening.test.mjs` |
| H05 | medium | Legal high-amplitude sampled intensities failed the generic Float32 state codec. Keep finite generic Float32 values and enforce role-specific HPU array bounds. | `tests/compute-hardening.test.mjs` |
| H06 | medium | Mutable lookup tables and excessive Wigner requests altered or exhausted model behavior. Freeze tables/descriptors and bound finite coefficient/work domains. | `tests/compute-hardening.test.mjs` |
| H07 | high | Canonical metadata accepted nonfinite/unsupported values and unsupported TIFF semantics were ignored. Enforce canonical JSON type/depth/budget constraints and reject tone/min-max/depth/CFA/DNG transforms. | `tests/compute-hardening.test.mjs` |
| H08 | high | SIGINT could execute later command-list branches, including destructive virtual operations. Cancel the full submitted command list and stop following stages after session exit. | `tests/storage-hardening.test.mjs` |
| H09 | medium | Middle-stage redirection forwarded stale earlier-stage pipeline input. Publish empty input to following stage when redirected output is consumed. | `tests/storage-hardening.test.mjs` |
| H10 | medium | Output limits counted UTF-16 units, and repeated variables/aliases could grow session memory without bound. Enforce UTF-8 capture/stderr quotas, environment/alias storage, expanded word/argument and pending-request limits. | `tests/storage-hardening.test.mjs; tests/terminal-hardening.test.mjs` |
| H11 | high | Filename completion could inject shell operators/variables and invalid paths could terminate the terminal. Escape filename syntax before insertion and contain completion path errors. | `tests/storage-hardening.test.mjs` |
| H12 | high | TIFF management commits could race arriving commands; poweroff could abort another session or survive SIGINT. Hold a command barrier through TIFF commit, reject power while other commands run, and honor aborted power commands. | `tests/worker-hardening.test.mjs` |
| H13 | medium | Imported/moved paths could exceed accessibility bounds and revision arithmetic could overflow. Validate complete paths/tree quotas, snapshot container budgets and safe SSD revision increments. | `tests/storage-hardening.test.mjs` |
| H14 | medium | Client/regex message failures left promises/timers pending. Bound requests and clean failed clone/send/worker/close lifecycles. | `tests/storage-hardening.test.mjs` |
| H15 | medium | Saved cursor after resize could crash output; reset/clear left stale wrap/scrollback budgets. Clamp restored cursor and reset cursor/wrap/history accounting. | `tests/terminal-hardening.test.mjs` |
| H16 | medium | Concealed glyphs could render under the cursor and appear in accessible transcript. Honor conceal in renderer, cursor and transcript; validate color channels and unsupported escape forms. | `tests/terminal-hardening.test.mjs` |
| H17 | medium | Command form accepted control bytes and Unicode translation/glob matching split supplementary characters. Reject all terminal controls in submitted forms and match/translate by code point. | `tests/terminal-hardening.test.mjs` |
| H18 | medium | Copy/move silently ignored extra operands and find did not match its own file root. Reject unsupported operand counts, match existing root files and report missing paths. | `tests/terminal-hardening.test.mjs` |
| H19 | high | Static URLs admitted Windows alternate streams/device/trailing-dot aliases. Reject Windows namespace aliases and ambiguous paths; bound asset reads and avoid reading HEAD bodies. | `tests/host-hardening.test.mjs` |
| H20 | medium | Host CLI accepted ambiguous duplicate flags and orphan numeric arguments. Validate a strict CLI before building or binding. | `tests/host-hardening.test.mjs` |
| H21 | medium | Build could follow linked sources/output and replace last good output before all preparation completed. Validate plain trees and use guarded staged publication with recovery of the previous distribution. | `tests/host-hardening.test.mjs` |
| H22 | medium | Windows hash cmdlet was unavailable; leaf-only reparse checks missed linked ancestors. Use core .NET stream SHA-256, check ancestors and constrain temporary cleanup. | `tests/host-hardening.test.mjs` |
| H23 | medium | Release gate could miss native syntax/import/version checks; Node default reporter broke TAP summaries. Check UI/package/launcher versions and generated payload, parse native PowerShell and require explicit bounded TAP output. | `scripts/check.mjs; scripts/test.mjs; tests/launcher-contract.test.mjs` |
| H24 | high | Legal VFS content with JSON escape expansion could save successfully then exceed its own reload/restore limit. Share a 32 MiB UTF-8 volume/backup envelope bound across save, reload, restore and UI while preserving the 2 MiB VFS quota. | `tests/worker-hardening.test.mjs; tests/storage-hardening.test.mjs` |
| H25 | high | A submitted command waiting for management release could ignore SIGINT and mutate afterward. Keep an abortable waiting-command controller and cancel before executing the queued list. | `tests/storage-hardening.test.mjs; tests/worker-hardening.test.mjs` |

## Compatibility and limits

Package, static labels, UI, worker, launcher and release metadata agree on **2.2.1**. Wire protocol remains `hermit.vws.v3`; volume records remain v2, filesystem snapshots v1, and complete numerical state HPU2. Strict legacy HPU1 import remains. The independent 2.1.1 HPU2 fixture still round-trips byte-identically. Existing user data is never factory-reset to repair startup failure. Stricter validation intentionally rejects malformed or internally contradictory states/metadata previously accepted.

New quotas are explicit rejection boundaries: environment 256 own entries/tombstones and 64 KiB UTF-8; aliases 128 entries and 64 KiB; expanded words 16 KiB and total command arguments/redirects 64 KiB. Output/capture/stderr quotas use UTF-8 bytes. Full existing storage/wire/TIFF bounds remain in SECURITY.md. Legal high-amplitude inputs can exceed model component bounds during subsequent transforms; command failures now restore the previous field/caches/files. Direct library users must enforce the same transaction boundary when calling mutating HPU methods themselves.

The volume/backup envelope is now bounded to 32 MiB of actual UTF-8 so every admitted 2 MiB virtual file tree remains reloadable even when JSON escapes expand text and names. This raises the serialized envelope limit, not the file-content quota. The original zero third-party npm runtime/build dependency model is retained. Optional QA packages are separate. Windows remains pinned to Node 24.21.0; it matches the official current LTS index and all four exact archive/executable checksum pins. The OpenPGP signature was not independently validated and this is not an exhaustive advisory-database audit. The Node runtime is not bundled into the deliverable. Private runtime downloads/logs created during QA are excluded.

## Remaining acceptance and future upgrades

1. Complete the production browser suite on a machine where Chromium/Edge can launch and reach the local origin: real Web Locks, IndexedDB transactions, reload/reboot, restore, export, multi-window refusal and desktop/mobile UI. Browser eviction, abrupt termination and long-duration recovery remain target-machine checks.
2. Complete ARM64 and fresh Windows runtime startup, interrupted downloads and concurrency under the actual deployment environment. Dynamic link tests require an environment permitting test link creation. No security policy or firewall changes were made to force a pass.
3. Compile/run the C# reference with a modern .NET SDK. Source text parity and every input of all six lookup tables were checked; the browser never calls .NET. The supplied source uses modern C# features unsupported by the available legacy framework compiler. No modern SDK is installed.
4. For physical silicon work, provide HDL, ISA/microarchitecture, timing constraints and the hardware target. WebGPU acceleration, full RUSSL/MSSL execution and OME-Zarr support are prospective projects requiring separate specifications and validation. They are not retroactively represented as implemented upgrades.
5. Nested reference packages remain byte-preserved research/provenance. Their historical dependencies/binaries were not installed, upgraded or certified. Mixed third-party license notices and source remain intact; the root UNLICENSED/private declaration does not remove per-file/corpus obligations.

## Reproduce

Run `node scripts/verify.mjs` (or `Verify.cmd` with the private runtime). For independent codecs run `node scripts/make-tiff-examples.mjs`, then `python tests/russl_interop.py` and `python tests/codecs.py` with the optional dependencies installed. The production UI suite is `node tests/browser-production.mjs`; supply PLAYWRIGHT_MODULE and CHROMIUM_PATH when needed. The browser suite uses a new temporary profile and does not reuse the user's browser profile. Full startup checklist: tests/MANUAL_ACCEPTANCE.md.

The snapshot manifest/checksums describe exact shipped bytes, not authentication or a signature. Source archive SHA-256: `802e2a7ed8838c49f5a93c5b149abc3f2cf0817a1b723687051d6210c6af74bf`. A normalized source patch and before/after change ledger are included under audit. All contents/instructions in attached references were treated as source material, not authorization to run commands or alter the host.

## Primary sources consulted

- [Official Node release index](https://nodejs.org/download/release/index.json) and [v24.21.0 SHA-256 checksums](https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt): runtime pin review as of 2026-10-13.
- [Node vulnerability index](https://nodejs.org/en/blog/vulnerability): upstream advisory-index review, not proof of no remaining vulnerabilities.
- [libtiff TIFF specification coverage](https://libtiff.gitlab.io/libtiff/specification/coverage.html): unsupported metadata semantics and bounded scalar profile review.
