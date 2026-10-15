# JA21 Software CPU Console 1.2.0 integration

The attached JA21 Blank Console now embeds the selected JA21 software CPU/XPU engine 2.2.2. Double-click `Start Console.cmd` to run the normal native executable and display the CPU terminal, virtual files, byte lanes, field previews and TIFF tools inside the console window. Node and an ARM64 operating-system boot are not required for this launch.

## What is implemented

- Complete 2.2.2 software source, assets, tests and provenance retained under `applications/silicon/`.
- Sealed local WebView2 HTTPS mapping of the static `dist` closure to `https://ja21-silicon.invalid/`, normalized to the entry document. The address has no public DNS or HTTP-server dependency.
- Stable embedded origin and portable WebView2 profile under `workspace/` for the existing transactional IndexedDB volume and single-writer Web Lock.
- Exact origin and resource checks, restrictive CSP/referrer page overlay, owned Blob exports, unavailable-live-renderer refusal, SDK integrity checks and runtime-file tamper rejection.
- Native Windows x64 application compiled from seven included C# units. The main launcher runs this executable directly. `--preflight` checks prerequisites without opening a browser; `--blank` retains the original empty surface.
- Native, automated `Test Silicon CPU.cmd` exercises actual worker startup, byte lanes, commit/backup, reload, writer refusal and malformed/valid restore through the production bridge using its own new test profile.

The embedded component is the JA21 JavaScript CPU/XPU software model the user selected. It is not an ARM instruction-set emulator. The console itself requires Windows x64, .NET Framework/WPF and the installed Microsoft WebView2 Runtime. Readable source and build commands are included; native presenter compatibility remains 9.8.7, while the integration version is 1.2.0.

## Current verification

| Check | Result |
|---|---|
| Software CPU core | 308 passed, 3 skipped, zero failed of 311 tests |
| Native host compilation | PASS, x64 Framework compiler, warnings treated as errors |
| Exact origin / mapped tree / metadata / tampering | 28 native checks PASS |
| Main launcher / arguments / path punctuation | 15 checks PASS |
| Actual native main-launcher preflight | PASS for default and explicit blank modes |
| Static module / CSP / seal integration | 4 focused Python tests PASS |
| Full console Python gate | 213 passed, 3 skipped, zero failed of 216; nested substrate 29 passed / 1 skipped |
| Package/source/IR/seal gate | Exact final result in integration evidence |
| Native live WebView2 | BLOCKED_ENVIRONMENT; CPU Online never observed |
| Live IndexedDB persistence / writer lock / restore | NOT_RUN because browser initialization failed |

The native live attempt verified the sealed app and SDK, detected WebView2 155.0.4283.45 and created the QA WPF window. Browser initialization then reported “Catastrophic failure / Window creation request failed”; readiness timed out after 30 seconds. No worker or persistence scenario was completed. The failure is preserved in `evidence/integration-1.2.0/WEBVIEW2_LIVE_RESULTS.json`. The package is not described as a fully passed live-browser release.

The inherited 2.2.2 reference compilation passed 598 C# assertions and independent pixel checks of 35 native plus 35 JavaScript TIFFs. That evidence remains under the imported component and covers the software reference, separately from this embedded-host run. Three CPU-core skips concern unavailable dynamic link creation.

## Run and finish live acceptance

Extract the full ZIP into a writable folder, then double-click `Start Console.cmd` from a normal Windows session. Use `help`, `xpuinfo` or `hpu bytes` in the embedded terminal. The Storage view saves and exports full backups. Moving from the older local browser edition requires explicit backup/import because its origin and profile are separate.

Run `Test Silicon CPU.cmd` to execute the live acceptance checks automatically. Keep its QA window open. It prints the path to a fresh `silicon-webview2-acceptance.json` under `workspace/silicon-acceptance/`. Share that JSON and its PNG if present, rather than the whole profile directory. A completed live result must record PASS, fixture=false, observed CPU Online, browser_validation_passed=true, all scenario checks passed and a finish time. Prerequisites alone do not certify browser persistence. See `docs/SILICON-WEBVIEW2-ACCEPTANCE.md`.

## Integrity and preserved source

`FILES_MANIFEST.json` and `SHA256SUMS.txt` cover exact shipped bytes. Native `engine/ja21/runtime.integrity.json` seals the app closure, SDK and startup inputs; `package.integrity.json` retains the console's source/package verification scheme. Integrity hashes are not signatures. The original console and 2.2.2 release ZIPs remain unchanged; their input SHA-256 values, HTML overlay and change ledger are recorded in integration evidence.

All JavaScript CPU modules retain the 2.2.2 implementation; the page's metadata overlay and refreshed manifests are explicitly recorded. Attached document instructions were treated as source data. The original console's absent historical references remain recorded, and component notices are retained without replacing them. No platform protection or PowerShell execution policy was changed. Historical alternate development launchers remain provenance; the integrated application and its live QA launch native executables directly.

Microsoft documents local mapping, worker loading and origin-based storage in [Using local content in WebView2 apps](https://learn.microsoft.com/microsoft-edge/webview2/concepts/working-with-local-content). Mapped responses do not raise `WebResourceRequested`, so this integration uses sealed document metadata plus the native resource/navigation boundary. HTTP-only frame-ancestor and cross-origin-isolation headers are not claimed from the metadata overlay.
