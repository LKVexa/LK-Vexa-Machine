# Native Windows startup acceptance — 2.2.2

Fresh target-machine and production browser checks are PENDING. Native x64 provisioning, cache reuse, exact runtime probes and production HTTP host acceptance passed on the audit host. ARM64 bytes and launcher contracts passed; actual ARM64 execution was not run. Native PowerShell also tests absent/corrupt-runtime refusal, hashes and ZIP boundaries. Those checks do not complete the target-machine/browser checklist. Preserve backup exports first.

| Check | Expected |
|---|---|
| Fresh x64 Windows without Node in PATH | Double-click Start-Console.cmd; download, hashes and probe succeed; browser opens 8788 |
| Fresh ARM64 Windows | Native ARM64 archive/executable chosen and starts |
| Launch again offline | Exact cached executable verified/reused; no download |
| Exact ZIP cached in .runtime/downloads, no executable | Offline setup verifies archive then creates the minimal runtime |
| Wrong ZIP or modified node.exe | Refused before execution; original browser data untouched |
| Interrupted transfer | Partial file not treated as valid archive/runtime; retry works |
| Duplicate launch during provisioning | Second launcher refuses the bootstrap lock; no torn installation |
| Read-only or linked private runtime location | Clear refusal; no write through a reparse point |
| Paths with spaces, apostrophe, ampersand, percent or exclamation | No argument reinterpretation; verify on native cmd.exe |
| Root or .runtime on OneDrive | Verify supported local access; linked private directories may be refused |
| Verify.cmd without system Node | Uses same private executable and shows actual results |
| --preflight | Verifies package/runtime only; no HTTP/browser startup |
| Host port already occupied | Original host error stays visible; no silent port/storage-origin switch |
| Native browser integration | Module worker, Web Locks, IndexedDB and CSP work without the test adapter |
| Managed application/language restrictions | Clear refusal; no protection is disabled |
| New console against existing volume | Same address/profile preserves volume; backup before testing |

Original full-application acceptance context is retained in the 2.1.0 audit report.


## 2.2.2 native Windows / TIFF lab acceptance

On a Windows x64 or ARM64 device, verify first launch without Node/PATH, second
launch from the private cache, interrupted/hash-mismatched runtime rejection,
Verify.cmd, paths containing spaces, port-in-use errors and visible diagnostics.
No security settings should be changed. Use an exported full-volume backup.

In the normal local browser origin, capture a field, read/edit its real component,
reject a derivative-plane write, cancel then explicitly confirm apply, and
download/reimport the three provided field TIFF variants. Export a SHA-256 receipt.
Confirm sample/logical hashes agree across container variants, while file hashes
differ. Reject truncated/unrelated/compressed/RGB/multipage images without losing
the valid stage. Verify the field and staged TIFF survive actual browser reload,
power cycle and transactional storage; verify another owner window is refused.
Check no transient HPU state is silently retained after explicit apply.

The x64 native startup and production HTTP response checks passed in 2.2.2. ARM64
runtime byte/architecture contracts passed, while actual ARM64 execution was not
run. Browser UI/persistence checks are separate from those host checks and from
the inherited offline fixture suite. The audit host could not start the tested
sandbox-enabled browsers or navigate the in-app browser to the local origin.

## 2.2.2 acceptance evidence

Optional `node tests/browser-production.mjs` uses a new temporary profile and the production server, CSP, worker, IndexedDB and Web Locks. Set PLAYWRIGHT_MODULE to an installed Playwright module if it is outside the project and CHROMIUM_PATH to a browser executable when needed. The separate browser-validation kit includes these optional tools: extract beside the release and run `Run-Browser-Validation.cmd`, or pass the extracted release directory as its first argument. It requires a normal Windows session where the browser can launch and reach loopback. This audit completed zero production UI scenarios: Edge and two official Chromium builds failed before page creation; in-app navigation timed out. These failures are recorded as environment blockers, not passes or application failures. Review the generated `audit/BROWSER_PRODUCTION_RESULTS.json` and any screenshots after running the kit.

The C# reference was compiled and executed on Windows x64: 598 assertions and all pixels of 35 native and 35 JavaScript TIFFs passed. See `native/README.md` and `native/Validate.ps1` for optional reproduction with a modern .NET SDK and Python/Pillow. No .NET installation is needed for the browser application.
