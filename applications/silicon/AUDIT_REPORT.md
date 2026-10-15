# JA21 Silicon Console 2.2.2 audit

The 2.2.2 package fixes the native reference and strengthens Windows runtime validation. **Core, native C# and x64 startup gates pass. Production browser persistence remains `BLOCKED_ENVIRONMENT` with 0 completed UI scenarios.** This package is verified within the scopes below; it is not a fully passed production-browser release.

The user selected the JA21 browser console. It runs JavaScript on the host CPU; it does not boot an ARM64 operating system. The supplied archive is a software CPU/XPU simulator and reference collection. Physical silicon, hardware acceleration and VM startup are outside the supplied implementation.

## Current evidence

| Gate | Result | Evidence |
|---|---|---|
| Node core and regression tests | 308 passed / 3 skipped / 0 failed, 311 total; Windows Node v24.21.0 | `audit/VERIFICATION.json`, `audit/TEST_RESULTS.tap` |
| Active source parsing and local imports | PASS | `audit/RELEASE_CHECKS.json` |
| Native C# build and execution | PASS: 598 assertions, 368,640 lane-input comparisons, 20,480 selector samples, 128 concurrent wraps; zero build warnings/errors | `audit/NATIVE_CSHARP_RESULTS_2.2.2.json`, validation log |
| Native/reference TIFF pixels | PASS: 35 C# + 35 JavaScript files, 143,360 pixels per implementation, all pixels and metadata checked in Pillow | `audit/NATIVE_CSHARP_TIFF_RESULTS_2.2.2.json` |
| Independent application codecs | PASS: 12 TIFF/atlas + 3 TIFF/GIF checks; regenerated writer fixtures | `audit/RUSSL_INTEROP_RESULTS.json`, `audit/CODEC_RESULTS.json` |
| Native Windows x64 startup | PASS: private runtime, version/platform/architecture, full core gate and actual production HTTP page/worker/module responses with CSP | `audit/NATIVE_ACCEPTANCE_x64.json` |
| Windows ARM64 runtime | PASS for official hashes, actual PE32+ machine 0xAA64 and provisioning/rejection contracts; native execution NOT_RUN | `audit/ARM64_VALIDATION.json` |
| Production browser worker/storage | BLOCKED_ENVIRONMENT; no page/UI scenarios completed | `audit/BROWSER_PRODUCTION_RESULTS.json`, `audit/PRODUCTION_BROWSER_ATTEMPT_2.2.2.log` |

Three core skips concern dynamic symlink/junction creation unavailable under this managed environment. Skips are not passes. The native test compiled the exact distributed C# source using Microsoft .NET SDK 8.0.426, runtime 8.0.32 and Roslyn 4.11 on Windows x64. The official SDK SHA-512 was checked against [Microsoft release metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json); exact tool provenance is in `audit/NATIVE_CSHARP_SDK_2.2.2.json`. The SDK is optional QA tooling and is excluded from the application package.

## Repairs in 2.2.2

- C# result getters exposed mutable arrays. Defensive snapshots now protect verified outputs; input is cloned and one complete result is published atomically.
- Concurrent `Wrap` calls could export another call's result. Each call now encodes its own complete snapshot. Native mutation and 128 concurrent-call assertions pass.
- Byte/selector TIFFs incorrectly claimed physical calibration at 3175 pixels/inch. They now explicitly represent uncalibrated unsigned data, with top-left orientation and bounded indices/arguments.
- Windows architecture detection now checks native OS architecture before environment fallbacks. Hash-verified files must also be PE32+ with the expected machine, and their probe must exactly match Node version, platform and process architecture before promotion/use.
- Added reproducible native C# and Windows acceptance runners. Browser acceptance uses bounded launch, checkpoint-scoped terminal checks and persistent-state assertions; it reports environment blockage rather than a false pass. Native reruns invalidate stale result reports and record aggregate state.

The 2.2.1 transaction, shell, HPU, terminal, bounded TIFF, volume and host fixes remain included. The full prior report and exact delivered evidence are preserved in `audit/baseline-2.2.1/`. Protocol v3, volume v2, FS v1 and HPU2 remain compatible. The application retains zero third-party npm runtime/build dependencies. Native C# is inspectable reference source; the browser does not invoke .NET.

## Browser persistence gate

Installed Edge and two official Chrome for Testing headless-shell builds were attempted with the Chromium sandbox enabled. They failed before page creation, with native crash/access errors or a launch timeout. The current matched-browser attempt exited 0x80000003 before loading the application. In-app browsing to the confirmed local host timed out. These facts establish an environment blocker; they do not demonstrate that application persistence passes or fails.

The optional `JA21_2.2.2_Browser_Validation_Kit.zip` contains portable Playwright 1.62.1, its driver package, matched official Chrome 151.0.7922.34 and upstream notices/licenses. Chrome provenance comes from [official Chrome for Testing metadata](https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json) and the official storage response hash. Exact archive hashes and attempted launches are recorded in `audit/browser-runtime-2.2.2/`; the kit carries its own file manifest. Kit plumbing checks use labeled fixtures and are not browser acceptance.

The final kit's `--check-only` also passed against the actual 2.2.2 application: all kit hashes, argument selection, private Node preflight and copied Playwright import passed. This check did not launch a browser or test persistence. Its log is `audit/BROWSER_QA_KIT_CHECK_2.2.2.log`.

Extract the main release and kit as sibling folders on a normal Windows x64 session. Run the kit's `Run-Browser-Validation.cmd`; alternatively pass the extracted release directory as its first argument. It provisions/verifies the release's private Node, uses a fresh temporary browser profile, keeps the browser sandbox enabled and runs the shipped production suite. Review `audit/BROWSER_PRODUCTION_RESULTS.json` and generated screenshots. The suite checks real worker transport, IndexedDB commit/backup, single-writer refusal, file/HPU/staged-TIFF reload and reboot, malformed/valid restore, field export/apply and controls. No browser-storage clearing or security-policy changes are required.

Actual browser eviction, abrupt termination, long-duration recovery and fresh deployment-machine behavior remain target checks. Actual ARM64 Windows launch is separately reproducible with `Native-Acceptance.cmd arm64`; it was not executed on this x64 host. The selected virtual browser console does not supply an ARM64 OS test.

## Reproduce and package integrity

Use `Verify.cmd` or `node scripts/verify.mjs` for the core gate; `Native-Acceptance.cmd x64` for host acceptance; `native/Validate.ps1` for C# with .NET SDK 8 and Python/Pillow. See `native/README.md` and `tests/MANUAL_ACCEPTANCE.md`. Optional independent codecs are `tests/russl_interop.py` and `tests/codecs.py` after regenerating examples.

The release includes the exact source, rebuilt `dist`, tests, audit evidence and byte-preserved research/corpus provenance. Private runtimes, downloaded SDKs, browser profiles, logs outside audit, Git data and transient test outputs are excluded. `FILES_MANIFEST.json` and `SHA256SUMS.txt` describe shipped bytes; the outer ZIP has a separate SHA-256. They are integrity checks, not signatures. A normalized patch and before/after SHA ledger compare this release against the delivered 2.2.1 ZIP.

Original intake inspected 11,215 records across 20 archives, including 25 PDFs, and matched all 280 original manifest entries. That intake evidence is preserved; historical nested binaries/packages remain inert and were not all compiled or upgraded. Instructions in attached documents were treated as source material, not authorization to execute them. The original attachment SHA-256 is `802e2a7ed8838c49f5a93c5b149abc3f2cf0817a1b723687051d6210c6af74bf`.

Official Node 24.21.0 pins were checked against [Node SHA-256 checksums](https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt). Their OpenPGP signature was not independently verified. Existing notices and original-source archives are retained; the private root declaration does not replace per-file license obligations.
