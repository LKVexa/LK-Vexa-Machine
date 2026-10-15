# JA21 Silicon Console 2.1.1 — startup repair audit

Date: 2026-10-12. Baseline: the supplied JA21 Silicon Console 2.1.0 audited package.
Status: **offline gates passed; native Windows acceptance remains pending.**

## Reported failure and applied repair

The old `Start-Console.cmd` checked `where node`, then printed the missing-Node/PATH
error and stopped. No server/XPU boot had occurred. `Verify.cmd` had the same external
prerequisite. The launcher now supplies a private runtime, without requiring a global
Node installation. This repairs provisioning; it does not eliminate Node from the
software architecture or claim native silicon/XPU execution.

The complete package is version 2.1.1. The separate launcher also recognizes the
existing 2.1.0 package for a minimal repair, and reports application and launcher
versions separately rather than claiming it upgraded the application itself.

## Change scope

- A readable standalone .cmd with identical reviewed source in
  `scripts/windows/bootstrap.ps1`; native Windows architecture detection, private
  Node.js 24.21.0 LTS provision/reuse, preflight and verify modes, diagnostic logs,
  absolute PowerShell/runtime invocation, and visible failures.
- Runtime/cache content SHA-256 pins transcribed from the official release document.
  The ZIP is validated before extraction; the executable is independently checked
  before execution. Only node.exe, LICENSE and README.md are extracted. Normal TLS
  validation, official HTTPS host/port restriction, no redirect following, byte/time
  limits, random partial filenames, exact-entry extraction, staging and exclusive
  provisioning lock. Reparse-point private locations and altered/incomplete runtimes
  fail closed.
- No installer, npm install, system PATH dependency or mutation, elevation, registry,
  execution-policy, antivirus or firewall modification. Inherited Node/OpenSSL
  execution-related environment settings are cleared only in the child environment.
- The same loopback host and default port 8788 are retained. Browser virtual-volume
  contents, wire v3, filesystem snapshot format, volume v2 and HPU2 are unchanged.
- UI/package/worker version 2.1.1, corrected documentation, 18 explicitly static
  launcher contracts, and verification reports that invalidate stale PASS status
  and report actual pass/skip counts.

Runtime binaries could not be downloaded by the build tools in this environment.
**They are not bundled.** First startup downloads the exact official runtime ZIP,
or uses a manually supplied matching offline archive. This is not an offline-ready
Windows binary distribution.

## Verification performed for this repair

| Gate | Evidence | Outcome |
|---|---|---|
| Existing Node suite | `audit/TEST_RESULTS.tap` | 135 passed |
| New launcher source/packaging contracts | same TAP; `tests/launcher-contract.test.mjs` | 18 passed; static only |
| Combined Node suite | `audit/VERIFICATION.json` | 153 passed, 0 failed, 0 skipped |
| Active JavaScript syntax / local imports | `audit/RELEASE_CHECKS.json` | 47 parsed / 45 resolved |
| Offline Chromium UI fixture | `audit/BROWSER_OFFLINE_RESULTS.json` | 8 scenarios passed, 0 page errors |
| Independent TIFF/GIF decode | `audit/CODEC_RESULTS.json` | 3 checks passed |
| Baseline reference files | `audit/STARTUP_REPAIR_SUMMARY.json` | 33 files; SHA-256 unchanged: true |
| Native Windows cmd/PowerShell execution and AST parse | unavailable | **NOT TESTED** |
| Actual Windows runtime transfer/extraction/probe | unavailable | **NOT TESTED** |

Node tests ran with v22.16.0 on Linux. That is test-environment evidence,
not a claim that Windows Node.js 24.21.0 executed here. The 18 launcher tests verify
source/packaging contracts; they are not a PowerShell interpreter or Windows VM.
The offline browser run substitutes an explicitly labeled in-memory link adapter,
so it does not certify real browser IndexedDB/Web Locks/worker/CSP integration.
The desktop screenshot was visually checked and shows the 2.1.1 fixture label.

The first new contract run caught a test matcher incorrectly treating an explanatory
comment about not installing npm as an npm invocation. The matcher was corrected to
ignore comment lines, then the complete gate was rerun successfully. No failing
run has been represented as a pass.

## Remaining acceptance and trust limits

On a Windows device, first verify the no-Node/no-PATH case, second launch without
network, Verify.cmd, interrupted downloads, hash tampering rejection, locked or
read-only package folders, existing-port errors, paths with spaces/special characters,
and x64/ARM64 architecture selection. Device security/application-control behavior
must be verified locally. Do not disable protection to make the package run.

The checksum source was obtained over the official HTTPS site. Its OpenPGP signature
was not independently verified here. A local actor able to alter the launcher can
alter its pins. The private runtime is pinned, not automatically upgraded: review
future upstream security releases and update the version/checksums as a new release.

This is a focused startup repair, not a new semantic certification of the original
8,752-record research/toolchain inventory or hardware throughput. The preceding
full audit is retained at `audit/baseline-2.1.0/AUDIT_REPORT.md`; historical evidence
and new evidence are distinguished in `audit/INHERITED_EVIDENCE.md`.

## User procedure and sources

See `WINDOWS_STARTUP_FIX.md` and `QUICKSTART.txt`. Use the same browser profile/address
for saved data; export backups before changing applications. Never clear browser
storage to fix missing Node.

Official release and checksum sources checked 2026-10-12:

- https://nodejs.org/en/blog/release/v24.21.0
- https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt
- https://nodejs.org/download/release/v24.21.0/
