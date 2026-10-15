# Live software CPU acceptance in the native console host

Double-click **Test Silicon CPU.cmd** in the fully extracted release. It runs the included native QA executable. No Node.js, Playwright, separate Chrome download, PowerShell launcher, installation, or policy change is involved.

The test opens one WPF window using the same compiled production host sources, pinned SDK loader, exact `https://ja21-silicon.invalid/` mapping, and request boundary as the console. The Microsoft WebView2 Runtime must already be available. Keep the window open while the test runs; commands, backup selection, and restore confirmation are automated. The ordinary console program entry point is not invoked.

Each run creates a fresh, short isolated workspace under `D:\Codex\hermit-native-validation\qa\<12hex>`, including an isolated WebView2 profile. The QA host explicitly permits this test-only external portable root. It never opens the ordinary console's storage or the user's Edge profile. It first writes a fresh `RUNNING` result before runtime verification or browser initialization. A missing runtime, initialization error, failed scenario, or incomplete run cannot reuse an earlier PASS. A failure also captures first-fault DOM JSON and a real SDK screenshot before disposal; share those small files rather than profile folders.

The live scenarios cover:

- Real module-worker boot, secure-origin APIs, and terminal MessageChannel.
- Rejection of cross-origin navigation by the production bridge.
- CPU byte lanes, exact field previews, IndexedDB commit, and production backup export.
- Reload restoring exact committed file content and CPU field previews.
- A second production surface being refused by the real single-writer Web Lock.
- Malformed restore preserving the running volume, followed by validated restore recovering the exact backed-up file and CPU state.

The synthetic backup is captured from the production UI's export Blob in memory; the test suppresses that one synthetic anchor download. Restore uses the production file-input handler and checksum validation. No test command executes a host shell.

The tool prints the path to `silicon-webview2-acceptance.json`. Share that file and, if present, the adjacent `silicon-webview2.png` screenshot. Do not attach the whole profile/state folder. A successful live result has `status: "PASS"`, `fixture: false`, `cpu_online_observed: true`, `browser_validation_passed: true`, all checks marked PASS, and `finished_utc`. A `RUNNING` result means the process did not finish; `PREFLIGHT_PASS` checks prerequisites only.

For prerequisites only, run `tools\Test-Silicon-WebView2.exe --preflight`. It verifies the runtime seal, mapped resources, and pinned SDK loading without creating a browser or test window. The supplied QA executable is a Windows x64 host; this test does not establish native execution on ARM64 hardware, an ARM64 instruction set, physical silicon, or a simulated host operating system.

Readable QA source is `tools/SiliconWebView2Acceptance.cs`. `tools/Build-Silicon-Acceptance.cmd` rebuilds it from the production host units plus that QA source using the local Windows .NET Framework compiler and the included pinned SDK. Rebuilding changes the executable hash; regenerate the package/runtime seals only when preparing a reviewed release. Ordinary console startup rejects profile paths above 150 UTF-16 characters before creating storage. Use a short extraction folder; existing profiles are never moved or reset automatically.

Python static integration checks run through `tools/verify_package.py` and `tests/test_silicon_integration.py`. They check the mapped distribution, metadata, document policy, and runtime-seal coverage; they do not certify live worker or persistence behavior. The inherited blank-window verification exercises the separate blank mode.
