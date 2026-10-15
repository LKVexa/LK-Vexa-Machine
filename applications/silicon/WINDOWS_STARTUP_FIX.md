# Windows startup repair — launcher 2.2.2

## Why the old launcher stopped

The 2.1.0 `Start-Console.cmd` ran `where node` and exited immediately when Node was
not discoverable on PATH. The server and XPU had not started. This repair supplies
a private runtime automatically; Node is still the HTTP host runtime, not removed
from the architecture.

## Preferred: complete application 2.2.2

Extract the complete 2.2.2 ZIP into a normal local folder such as `D:\Codex\JA21_2.2.2`,
then double-click `Start-Console.cmd`. Do not run inside the ZIP or as Administrator.
The first run downloads the official pinned Node.js 24.21.0 LTS archive (about
38 MB for x64 or 34 MB for ARM64). Archive and executable SHA-256 values are checked
against embedded pins, and only node.exe, LICENSE, and README.md are installed.

The ZIP contains the console source, built UI and bootstrap, **not Node binaries**.
First setup therefore needs working internet/TLS/proxy access to nodejs.org, or an
exact manually cached official runtime ZIP. Windows PowerShell 5.1 and a supported
64-bit Windows environment are required. An OS policy block is reported, not bypassed.

Setup stores only runtime/cache files under `.runtime`, and diagnostic logs under
`logs`. Later starts recheck and reuse the local node.exe without downloading it.
Node/npm do not need to be on PATH. No installer or global configuration is changed.
The same local address remains `http://127.0.0.1:8788/`.

## Small repair for the existing 2.1.0 / 2.1.1 folder

Replace `Start-Console.cmd` with the provided new file **beside package.json**, in
the already extracted console folder. Replace `Verify.cmd` too when using the small
launcher-repair ZIP. Run `Start-Console.cmd` again.

This small repair changes only the launcher: the existing application stays 2.1.0.
The log explicitly says `launcher 2.2.2 | application 2.1.0`. Use the complete
package for the application version bump, new test contracts, and updated reports.
Installing just the new Start-Console.cmd does not replace the old Verify.cmd;
use `Start-Console.cmd --verify` in that case.

## Commands

```bat
Start-Console.cmd
Start-Console.cmd --preflight
Start-Console.cmd --verify
```

Preflight provisions/verifies the runtime but does not start HTTP or a browser.
Verify provisions/verifies the same runtime and then runs the application's Node
test gate. Keep the normal startup console open while using the browser.

Optional settings in a Command Prompt (not needed for ordinary double-click use):

```bat
set JA21_OFFLINE=1
set JA21_NO_PAUSE=1
set JA21_NO_OPEN=1
set JA21_PORT=8788
```

Set only the options needed. `JA21_OFFLINE=1` forbids a runtime download; it does
not set an OS-wide firewall rule. `JA21_NO_PAUSE=1` is for scripted acceptance
runs. Changing port creates a different browser-storage origin; it is not an
in-place migration. No automatic port fallback is performed.

## Offline cache preparation

On a machine with permitted internet access, obtain the exact archive for the
target Windows architecture from the official release directory:

- x64: https://nodejs.org/download/release/v24.21.0/node-v24.21.0-win-x64.zip
- ARM64: https://nodejs.org/download/release/v24.21.0/node-v24.21.0-win-arm64.zip

Copy the unmodified ZIP into `<console folder>\.runtime\downloads\` (create those
directories when necessary). Do not rename a different version to look like this
one. The launcher checks the embedded archive/executable hashes before accepting it.
The lock values are also in `scripts/windows/runtime-lock.json` in the full release.

## Failures and data safety

A bootstrap log is saved to `logs\launcher-*.log` after package validation. Missing
package/PowerShell failures can occur before a log exists; their console error is
kept visible. The Node host's normal output is visible in the console, not duplicated
into the bootstrap log. Include the exact console error and most recent log when
reporting another failure; redact any personal path information before sharing.

For a SHA-256 mismatch, the runtime is not executed. Remove only the named corrupted
cache file or `.runtime\node-v24.21.0-win-...` directory and retry. An incomplete
runtime directory also fails closed rather than executing an arbitrary node.exe.
A blocked download or managed Windows execution restriction must be resolved through
the normal approved network/application process; this patch does not disable security.

The launcher does not clear browser storage, reset the virtual volume, or rewrite
Windows PATH, registry, execution policy, antivirus or firewall rules. Continue with
the same address and browser profile for the same saved volume. Export backups before
an application upgrade and stop the old host before starting a second one on 8788.

## Validation scope

For 2.2.2, native Windows PowerShell parsing, safe hash/ZIP boundaries, architecture detection, PE32+ machine validation and exact Node version/platform/architecture probes pass. The official x64 runtime downloaded, passed both pinned hashes, extracted minimally, completed preflight, reused its cache offline and ran the full --verify path. `Native-Acceptance.cmd x64` also started the actual production host and verified page/module responses and CSP. The official ARM64 archive and executable hashes and actual PE ARM64 bytes passed; native ARM64 Windows execution remains `NOT_RUN`. The selected browser-console use does not boot an ARM64 operating system. Interrupted live download, fresh target-machine behavior and production browser persistence remain acceptance gaps. Three dynamic symlink/junction tests skip where link creation is unavailable. Exact counts are in audit/VERIFICATION.json. Official checksum values were rechecked from HTTPS on 2026-10-13; their OpenPGP signature was not independently verified.

Use `Native-Acceptance.cmd x64` or `Native-Acceptance.cmd arm64` on the corresponding Windows operating system to reproduce the native startup checks. The runner records the actual architecture and stops its own test host. Browser persistence is a separate gate: the optional portable browser-validation kit supplies the browser and test driver, with its sandbox enabled.

## Upstream sources checked 2026-10-13

- Node LTS release: https://nodejs.org/en/blog/release/v24.21.0
- Official checksums: https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt
- Release directory: https://nodejs.org/download/release/v24.21.0/
