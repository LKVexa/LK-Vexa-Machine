# End-to-end audit and hardening report
## JA21 Silicon Console — release 2.1.0

**Audit date:** 2026-10-12  
**Input:** `3CfF2osTJPreoEbM-grok-workspace.zip`  
**Input SHA-256:** `230427a64dfeccc1b83b90cd263ec360fc2cf30cb494f718aebe96bf70b6f2e4`  
**Disposition:** source fixes applied and a dependency-free local edition rebuilt. **Offline regression gate passed; normal-browser persistence/worker integration and native Windows execution remain unverified.** This is not a blanket production/security certification.

## 1. What was actually supplied, and what is released

The active input application is a browser implementation of a virtual console, command interpreter, filesystem, and numerical field/byte processor. A MessageChannel connects the page to a JavaScript worker. The shell and XPU operations execute in that worker. Virtual files are mirrored to IndexedDB. The input UI calls itself 1.4.0; the worker declares 2.0.0-ramws.1. The root npm package has no product version. A separate 9.8.7 desktop-presenter label is not evidence that the browser is executing a native JA21/DF virtual machine.

The rebuilt product is **2.1.0**, consistently declared by package, UI, worker, and release metadata. The local wire protocol is separately bumped to **hermit.vws.v3**, because structured control records and flow acknowledgements are incompatible with the old control format. Volume records are version 2; the full processor state envelope is HPU2. These are distinct version namespaces, not conflicting product versions.

The browser execution chain remains real software:

```text
Start-Console.cmd / start.sh
  -> Node core HTTP static host (127.0.0.1:8788)
  -> native-module UI / Canvas terminal
  -> MessageChannel, wire v3
  -> worker / SPIRAL interpreter
  -> bounded VFS + numerical HPU
  -> transactionally committed IndexedDB record
```

There is **no hardware GPU API, native PTY, remote command-execution service, real NVMe controller, physical CXL fabric, booted hypervisor, quantum device, or independent execution from a TIFF/GIF image** on this path. The original nested packages are reference inputs, not automatically active components.

The old React/TanStack/auth/database/deployment scaffold was removed from the active build graph and preserved in `audit/legacy-scaffold.zip`. The custom worker, shell, VFS, VT, and HPU logic were retained and repaired; the UI was rebuilt around native browser modules. This is a local packaging refactor, not an assertion that the original cloud scaffold or its dependencies have been repaired or deployed. It intentionally does not expose arbitrary external browsing or a public WebSocket endpoint. Reusing that old cloud stack would require a separate dependency, identity, database, and deployment acceptance exercise.

## 2. Inventory and parsing coverage

The audit used safe ZIP traversal, hashes, text/structured-data parsing, source parsing, targeted implementation review, regression tests, and independent image decoding. The complete outer input is preserved across reference and original-source archives.

| Coverage | Result |
|---|---:|
| Original top-level files, excluding directory entries | 313 |
| Recursively inventoried files, including nested ZIP/JAR contents | 8,752 |
| Bytes inspected across those records | 126,884,793 |
| Research PDFs | 23 |
| PDF pages text-extracted without OCR | 334 |
| JavaScript/TypeScript-family files syntax-parsed | 219 |
| Python source files AST-parsed | 368 |
| Strict JSON files parsed | 4,053 |
| JSONL files parsed | 48 |
| CSV files parsed | 5 |
| Gzip payloads decompressed with bounded output / integrity checks | 7 |
| Parsed standalone image structures | 45 |
| Original files preserved with matching SHA-256 | 313 / 313 |
| Archive traversal/duplicate-path warnings | 0 |
| Reported parse/CRC errors in the performed passes | 0 |

The recursive count includes repeated copies at different archive paths, containers and their members; it is **not a unique-component count**. Byte totals are not a runtime-memory or throughput measurement. JAR traversal added 42 entries beyond the initial ZIP-only inventory. The JSONC-style original `tsconfig.json` has comments and is not strict JSON; it is recorded as such rather than falsely counted as a broken application file.

All PDF pages had their available text extracted. A first-page contact sheet of the 23 references was rendered and visually inspected. This does not mean every equation/figure was independently verified or every claim in each paper was reproduced. No research attachment is treated as proof of hardware acceleration. Original papers were not rewritten.

Custom-language files such as `.mssl`, `.lctl`, `.ja*`, and `.deepml` were decoded where textual and inventoried; their complete semantics were **not** validated against a language toolchain. Native C/C#/PowerShell files were inspected as text, not all compiled/executed. 160 records remained binary-inventoried and 29 were binary or non-UTF8 rather than text-parsed. Native DLLs, compiled classes, object files, signatures, and keys were not executed. These limitations are part of “parse everything”: every record has a disposition, but unsupported binaries do not acquire a fictitious semantic pass.

Evidence: `audit/INPUT_MANIFEST.json`, `RECURSIVE_PARSE_INVENTORY.json`, `SOURCE_PARSE.json`, `PDF_REFERENCE_PARSE.json`, `PROVENANCE_CHECK.json`, and `pdf-reference-contact-sheet.png`. The input JavaScript parser was TypeScript 5.8.3; the active release additionally passes Node syntax checks. Parsing is not a proof of correctness or absence of vulnerabilities.

## 3. Findings and applied remedies

Severity is a qualitative ranking for this local application, not a CVSS score or an externally assigned CVE. “Applied” means code changed and the listed evidence exists; it does not silently extend test-double results to a real browser or Windows host.

| ID | Severity | Finding | Applied change |
|---|---|---|---|
| F01 | High | Volume recovery could proceed from failed/invalid state into new writes | Fail-closed startup; detached validation; raw backup path; no implicit factory overwrite. |
| F02 | High | Multiple windows and nontransactional save completion risked lost updates | Exclusive same-origin writer lock; revision compare-and-swap; transaction-complete saves; previous committed record. |
| F03 | High | HPU save/restore omitted state and accepted insufficiently validated data | HPU2 complete typed state with length/CRC; strict bounds; detached load; bounded legacy migration. |
| F04 | High | Virtual transport trusted malformed controls, credit and session/sequence values | Wire v3; validated envelopes, geometry, kinds, sequences, flow acknowledgements, size/session/rate limits. |
| F05 | High | Arbitrary regular expressions could occupy the shell execution thread | Disposable worker with 750 ms deadline; bounded pattern/input/output; interrupt support. |
| F06 | High | Filesystem operations could corrupt root/tree relationships or expose mutable byte aliases | Root/cycle/destination guards; quota reservation; byte copies; detached validated snapshots. |
| F07 | Medium | Shell quoting, comments, variable expansion and aliases changed user command meaning | Fragment-aware parser; deferred expansion; preserved single quotes/empty arguments; bounded single-command aliases. |
| F08 | Medium | Environment unset/prototype handling and flag parsing were inconsistent | Parent-shadowing unset; null-prototype flattened maps; negative arguments and valued option validation. |
| F09 | Medium | Core utilities had edge-case correctness and resource-limit failures | Zero-line head/tail; newline wc; finite seq/sleep; bounded glob matching; corrected file operations. |
| F10 | Medium | SIGINT, client disposal and power-state transitions could leave work or sessions alive | Pending promise settlement; generation guards; session close/abort; quiesced off/reboot/restore. |
| F11 | Medium | Touch did not reliably trigger persistence and factory hashes included incidental timestamps | Mutation notification and deterministic canonical content digest. |
| F12 | Medium | HPU numeric edge cases and cached views could be invalid or stale | Finite/range checks; v2(0) convention; normalized truncated Kerr coefficients; cache invalidation. |
| F13 | Medium | Image encoders lacked strict public input/geometry validation | Typed input and bounded dimension/frame checks; exact TIFF/GIF decode validation. |
| F14 | Medium | Reported GPU, NVMe, CXL, optical/quantum and throughput labels exceeded implemented hardware evidence | Explicit CPU software backend; modeled-counter labels; no physical hardware or autonomous-image claims. |
| F15 | Medium | Cloud/auth/database scaffolding expanded the build/runtime surface without supplying the virtual compute engine | Native-module local UI and Node-core static host; zero npm runtime/build packages; unused scaffold outside dist. |
| F16 | Medium | No dedicated hardened local static host / clear Windows start workflow | Loopback-only static host; Host/Origin/method/path checks; CSP/headers; no admin/security-policy changes. |
| F17 | Low | UI command discovery, exports, restore confirmation and lifecycle controls were incomplete | 60-command searchable catalog; virtual file downloads; current/previous backups; explicit restore; off/reboot distinction. |
| F18 | Low | Versions and release evidence were inconsistent or absent | Unified product 2.1.0; protocol v3; reproducible checks; manifests, patch, provenance and explicit test gaps. |
| F19 | Informational | Reference packages contain development keys, binary toolchains and deep custom-language material | Retained byte-for-byte but inert, unserved, and not certified safe to execute; dev-only key called out. |

The machine-readable findings contain source paths and test mappings in `audit/FINDINGS.json`. Changed original runtime files are listed in `audit/RUNTIME_CHANGES.json`; `RUNTIME_PATCH.diff` records modifications against preserved originals. Added safety modules are included as normal source files.

### 3.1 Command interpretation and terminal lifecycle

The parser now preserves single-quoted literals, double-quoted variable expansion, mixed quoted fragments, empty arguments, escaped metacharacters, and boundary-only comments. Expansion can be deferred until each command runs, so `export A=hello; echo "$A"` sees the updated value and `$?` follows execution. Malformed or oversized input is rejected. Aliases are parsed as a bounded single command instead of allowed to introduce arbitrary control syntax. Negative arguments no longer disappear into option parsing, and known value-taking options reject missing values.

Core utilities were corrected for `head -n 0`, `tail -n 0`, newline-based `wc -l`, finite/bounded `seq`, bounded/cancellable sleep, path/name handling, and `find` options. Glob matching is bounded dynamic programming rather than a generated arbitrary regular expression. `grep` regex evaluation runs in a disposable worker terminated after 750 ms, with bounded pattern/text/output sizes. This is a practical resource control, not a mathematical proof that all regex workloads are equally cheap.

SIGINT now settles interactive reads as well as aborting running commands. Session disposal is idempotent. Client generation guards prevent messages from a replaced worker from reopening stale sessions. Pending status/RPC/open promises have deadlines and are settled when the client is destroyed. Power off, reboot, and restore quiesce producers before the final persistence operation; off does not secretly become reboot.

The Canvas terminal and line reader remain intentionally partial terminal implementations. Supplementary Unicode code points receive improved cursor/deletion handling; complete grapheme-cluster, bidirectional-text, wide-character, accessibility, and xterm/VT100 conformance are not claimed.

### 3.2 Virtual filesystem and durable state

Root replacement/removal/moves are rejected. Directory cycles, incompatible replacements, and nonempty destination replacement are blocked. Recursive directory creation reserves the whole missing suffix before mutation, including node-quota failure cases; an existing file is not accepted as a directory. Public read/write buffers are copied to prevent external mutation through shared backing arrays. Touch notifies persistence. Canonical factory snapshots sort names and omit incidental timestamps.

Snapshot imports validate type, names, mode/time metadata, encodings, tree depth, node count, and content size into a detached tree before replacing live state. Default VFS limits are 2 MiB of file contents and 1,500 nodes. Those limits exclude the overhead of JS objects, transient copies, images, and the UI; “2 MiB quota” does not mean the entire process uses 2 MiB RAM.

Startup must acquire the same-origin writer lock and successfully read/validate the stored record. A read error or malformed saved state stops initialization rather than silently treating the volume as empty. Saves are only reported as committed after transaction completion. Revision compare-and-swap and previous-record retention occur within the write transaction. Debounced writes coalesce dirty state; commands request a flush after execution.

The stored SHA-256 covers the serialized filesystem snapshot; HPU2 includes CRC32/length protection and detailed state validation. These checks detect accidental corruption, **not malicious provenance**. An attacker able to rewrite both data and checksum can construct a valid checksum. “Image seal” is now explicitly a canonical content digest, not a signature or remote attestation.

A known-good backup can be validated and restored explicitly. Current and previous records can be exported. A corrupt payload with intact revision metadata can be replaced through that path. If the database itself cannot be read or the record's revision envelope is too damaged to support safe compare-and-swap, recovery may require importing a known-good export into a fresh origin; the release does not bypass that safety check. Do not delete the only copy or clear site data as the first recovery step.

### 3.3 XPU, numerical behavior, and image encoding

The actual field is a 64 × 64 complex sample grid. The byte engine runs scalar and 32-wide batched JavaScript loops over the same lookup tables, and compares them. The C# reference's historically named `Gpu` method is also a CPU loop. Its method name is retained for compatibility and documented accurately; no native compilation result is claimed.

All six tables contain 256 byte entries. Exhaustive comparison shows four distinct transformations: lanes 1, 3, and 6 are identical; lane 4 is constant 255; lane 5 is constant 0; lane 2 is a separate repeating byte transform. The seventh selector chooses the largest absolute change from the input byte and resolves ties to the lowest lane index. It is not a learned scheduler or proof that the selected output is scientifically optimal. The comparisons test the implemented rules, not the validity of arbitrary application claims about those rules.

HPU2 persists the complete represented field/spool/ledger state using bounded typed-array encodings. Decode and validation occur on a detached instance; invalid data does not partly overwrite the live processor. Legacy HPU1 files receive strict structural checks. State absent from an old format cannot be retroactively recovered as real historical data. Nonfinite/malformed arrays and inconsistent routing data are rejected.

Numerical repairs include finite argument/range checks, a consistent zero-valuation convention, normalized coefficients after truncated Kerr-state construction, reporting truncation loss, and byte-cache invalidation when the field changes. The propagation implementation is described as sampled angular spectrum; it is not presented as a fully validated anti-aliased band-limited propagation solver. Bloch-vector and heat/Landauer displays are model proxies, not measurements of a quantum state or dissipated joules. No stability/convergence study, hardware calibration, large-scale benchmark, or experimental paper replication was performed.

TIFF/GIF entry points now validate exact typed input, dimensions, and frame limits. Pillow independently decoded a 16-bit TIFF, a two-frame GIF, and a high-entropy GIF; all expected pixel values matched. The export is a data representation. Neither correct image encoding nor fast LUT retrieval establishes extra computational work performed by the image itself.

### 3.4 Local host and dependency surface

The new Node host uses built-in modules only. It binds 127.0.0.1, accepts GET/HEAD, validates Host and supplied Origin, rejects cross-site fetch metadata, decodes and rejects traversal/hidden/invalid paths, refuses symlink files, applies size/time/connection limits, and serves only a narrow MIME allowlist from `dist`. Real Node HTTP tests exercised these boundaries.

CSP denies external connections, frames, objects, arbitrary script sources, form submissions, and base changes; other headers restrict framing, referrers, MIME sniffing, and sensitive browser permissions. Header presence and HTTP behavior were tested, but enforcement within the production browser was not, because navigation was blocked by managed policy. The browser application has no native shell or public remote execution endpoint.

The active npm manifest/lock contain no third-party runtime or build packages. This removes the old dependency graph from execution, not its obligations if reused. The baseline install failed with `EAI_AGAIN` resolving the npm registry, and peer-resolution warnings were recorded. There is no successful original-build, live advisory scan, or “zero CVEs” claim. Node, browser, operating system, and custom-code risks remain. Select a current supported LTS Node release rather than treating the test container's Node 22.16.0 as a security-pinned distribution.

## 4. Executed verification and exact limitations

| Gate | Observed result | What it establishes / does not establish |
|---|---|---|
| Active release build and syntax/import/version checks | PASS | Static artifact rebuilt; 45 JS-family files syntax-checked at this gate; local imports and versions agree; no npm package graph |
| Node regression suite | 135 PASS, 0 FAIL, 0 skipped | Core, VFS, shell, codecs, flow, real Node HTTP and worker logic tests |
| Worker integration | PASS within Node suite | Real Node worker/MessageChannels; **fake IndexedDB and a test lock broker**, not native browser durability |
| Gate truth tables | All 20 modeled AND/OR/NAND/XOR/XNOR combinations PASS | Deterministic implemented logic; not quantum-hardware validation |
| C#/JS LUT parity and routing | PASS | Table/text/algorithm parity; C# was not compiled |
| Pillow image decode | 3 scenarios PASS | Every expected TIFF/GIF sample matched; no physical storage/performance claim |
| Offline Chromium UI | 8 scenarios PASS; no page errors | Actual DOM/native UI/Canvas/kernel/HPU with an **in-memory link replacement** |
| Desktop/mobile layout | Visually inspected; 430px width check PASS | Screenshots marked as offline fixtures; not broad accessibility/browser certification |
| Original provenance reconstruction | 313/313 hashes PASS | Original material is preserved, not silently lost in the refactor |
| Normal browser HTTP navigation | BLOCKED | Managed policy returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`; policy was not modified |
| Native IndexedDB/Web Locks/CSP integration | NOT RUN | Not inferred from Node doubles or offline UI |
| Native Windows `.cmd`, WebView2/desktop binaries | NOT RUN | Launchers text-reviewed; no Windows host in the container |
| .NET/C#/native compile and execution | NOT RUN | No .NET build result claimed |
| Old cloud auth/database/deployment | NOT RUN | Archived reference, not part of local release acceptance |
| Physical XPU/GPU/quantum throughput or energy | NOT RUN / NOT IMPLEMENTED | Software counters cannot establish these claims |

The default repeatable command is `node scripts/verify.mjs` or `Verify.cmd`. It does not silently count optional Python/browser evidence as rerun. `tests/codecs.py` requires Pillow; `tests/browser_offline.py` requires Playwright and an installed Chromium. Optional QA packages are not application runtime dependencies. No browser security policy was bypassed, and no original native binary was executed to make these results appear broader.

Artifacts: `audit/TEST_RESULTS.tap`, `VERIFICATION.json`, `RELEASE_CHECKS.json`, `CODEC_RESULTS.json`, `BROWSER_OFFLINE_RESULTS.json`, `OFFLINE_UI_DESKTOP.png`, `OFFLINE_UI_MOBILE.png`. The screenshots themselves display the fixture boundary. Pass counts describe tests, not exhaustive branch/line coverage; no coverage percentage is claimed.

## 5. Release and operational acceptance

The result is suitable for **further local evaluation with exported backups**. It is not approved by this audit as a public, multiuser, mission-critical, physically accelerated, or experimentally verified system. Use `tests/MANUAL_ACCEPTANCE.md` to close the remaining real-browser and Windows gates before relying on durable data.

Run from an extracted short path with a supported Node LTS runtime. No administrator elevation, execution-policy bypass, firewall modification, npm install, Python runtime, PyTorch, or .NET runtime is required for this browser edition. Keep the static host open. Use the same host, port, and browser profile for the same saved volume; different origins are different storage. A second application window is intentionally refused while another owns the writer lock; terminal tabs within one window are supported.

Export before upgrading or changing origins. The wire v3 UI and worker must be shipped together. Do not mix the old and new release against one database. Do not downgrade over new HPU2 data without a preserved old-format backup. Prefer the current and previous export controls over deleting state. A previous record is only the immediately preceding committed revision and is overwritten by subsequent commits; it is not a full rollback journal.

References were preserved unmodified and are not served or booted. This includes a nested `DEV_ONLY_DO_NOT_DEPLOY/dev.key`, public keys, SDK/native binaries, and experimental language tooling. Their presence is recorded without treating them as active credentials or certifying their supply chain. Root metadata remains UNLICENSED rather than assigning a new blanket license to third-party papers and packages.

**Final assessment:** important parser, data-loss, state-integrity, resource-boundary, lifecycle, and presentation defects were repaired. The release is rebuilt and reproducibly tested within the stated environment. Full normal-browser storage/worker behavior, Windows launch behavior, original cloud deployment, and native/hardware performance remain explicit open acceptance items rather than fabricated passes.

External implementation guidance and access dates are in `audit/REFERENCES.md`; those sources guide the controls but do not certify this implementation.
