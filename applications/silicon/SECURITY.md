# Security boundaries — local edition 2.2.2

## Intended trust model

A single local user runs a native presenter or optional localhost host and one browser-owned virtual volume. XPU terminal commands stay in that numerical worker. The explicit Administrator PowerShell capability runs privileged Windows programs after UAC; it is a separate process with an authenticated pipe, bounded JSON bridge, current-document/session fences, and cleanup on disconnect. See docs/TERMINALS.md. The shell accepts untrusted command text but exposes only registered virtual operations; it does not execute OS programs. Terminal tabs share state and are not mutually hostile security principals. MessagePorts are capabilities inside the page/worker boundary, not authenticated public WebSockets.

The static host binds only 127.0.0.1. It serves only the generated `dist` tree and allowed MIME types, rejects hidden/traversal/symlink paths and disallowed Host/Origin/methods, bounds requests, and emits restrictive headers. This is deliberately **not a public multiuser service**. Do not bind it to a public interface or publish the source/reference directory as a website. Authentication, TLS termination for public hosting, multiuser authorization, and native command execution are not implemented.

Storage controls use a same-origin writer lock plus transactional revision checks. Snapshot validation takes place before swapping live state. CRC32 and SHA-256 detect accidental corruption; neither is a signature, identity check, encryption scheme, or guarantee against a same-origin attacker able to rewrite both content and checksum. An attacker controlling the browser, extensions, local OS account, or application origin is outside this model.

## Operational limits

8 sessions; 4096-character shell lines; 512 tokens; 2 MiB file-content quota; 1500 VFS nodes; path depth 64; frame payload maximum 16 KiB (input capped to 8 KiB); bounded input/flow/output queues; regex deadline 750 ms; HPU2 envelope up to 1 MiB; serialized volume/backup envelope up to 32 MiB of actual UTF-8. JSON escaping expands legal file text and names, so the envelope budget exceeds the file-content quota. Save, reload, export, restore and the UI share this bound. Limits are rejection boundaries, not evidence that arbitrary workloads finish instantly or consume zero memory.

Never store credentials or irreplaceable data only in this virtual volume. Export backups. Persistent-storage permission is optional and can be refused. Clearing site data, browser-profile changes, eviction, abrupt termination before commit, filesystem failure, or a compromised origin can lose data. A previous committed revision is not an independent backup history.

The new writer lock does not coordinate with old releases that do not request it. Do not run mixed releases on one origin. Preserve exports before changing host/port/profile or downgrading.

## Inert reference material

`references/`, `audit/legacy-scaffold.zip`, and `audit/original-runtime.zip` are not part of the served dependency graph. They contain original third-party/research material, old build outputs, native binaries, and nested experimental tooling. These are inventoried, not certified safe to execute. A nested path explicitly named `tests/keys/DEV_ONLY_DO_NOT_DEPLOY/dev.key` is development-only material; never reuse it as a deployment credential. Public PEM keys are also present. No embedded key is used by the active application.

## Validation gaps / reporting

Read the exact exclusions in `AUDIT_REPORT.md`. There was no exhaustive live advisory-database scan of the old npm stack, no completed production browser persistence test in this managed environment and no ARM64/fresh-machine full startup acceptance. The C# reference compiled and executed with .NET 8 on Windows x64. Official x64 runtime download, both pinned hashes, minimal install, exact version/platform/architecture probe, offline cache reuse, full launcher verification and production HTTP host checks passed. Native PowerShell parsing and safe launcher failure-path/ZIP boundaries passed. Zero npm dependencies does not mean zero risk: Node, the browser, OS and custom code still require maintenance.

Report a finding to the package owner with version, operating system/browser, minimal reproduction, redacted logs, and whether the issue affects the active local code or inert references. Do not include live secrets or unredacted personal backups. This package does not establish an external security-response endpoint.

## Private Windows runtime bootstrap (2.2.2)

First setup adds an explicit outbound HTTPS dependency on the official Node.js release site. The browser application itself still has the same isolated local connection policy. Runtime files/cache and bootstrap logs are not copied into `dist` or served over HTTP.

The readable `Start-Console.cmd` embeds `scripts/windows/bootstrap.ps1` and invokes that local payload using system Windows PowerShell `-NoProfile -NonInteractive -Command`. It does not fetch/evaluate remote script text. There is no `-ExecutionPolicy Bypass`, `Set-ExecutionPolicy`, `Unblock-File`, elevation, certificate-validation override, firewall edit, registry edit, or global PATH change. A managed language/application restriction is reported instead of disabled. This packaging does not guarantee acceptance by Smart App Control, WDAC, AppLocker, antivirus, or a corporate proxy.

Version-specific archive and executable SHA-256 pins come from the official HTTPS checksum document and are embedded in the launcher. The companion JSON lock is documentation; the executable launcher is the operative pin source. The OpenPGP signature was not independently verified in this build environment. The pins protect against substitution at download/cache time only while the launcher itself is trusted. They do not protect against a local attacker able to edit the launcher or replace both code and pins.

The downloader accepts only HTTPS to `nodejs.org:443`, rejects redirects and non-200 results, retains normal TLS validation, bounds bytes/time, and uses random partial filenames. ZIP extraction is limited to three exact entries with duplicate/length checks, never arbitrary archive paths. The executable is hashed before use; incomplete or altered installations fail closed. Runtime staging is atomically renamed only after validation. A file lock prevents concurrent bootstrap provisioning. Private runtime/log paths reject reparse points; deletion is limited to the bootstrap's own temporary file/staging directory.

Inherited Node/OpenSSL option variables are cleared in this process, not globally. No system Node on PATH is probed or executed. The original browser-storage host/port remains unchanged, and setup never resets browser state. The runtime lock is pinned, not an automatic updater; it must be reviewed with future upstream security updates.


## TIFF / pixel adapter boundary in 2.2.2

Untrusted TIFF bytes are copied, bounded, decoded and semantically validated
before staged-file replacement. Generic TIFF is limited to 4 MiB / 262,144
samples; the application atlas is limited to 192 KiB / 16,384 samples. Header,
directory, metadata and strip overlaps, malformed offsets/counts, nonfinite
samples, ambiguous page mapping and unsupported codecs/semantic tags fail closed.
No metadata evaluation, external-resource fetch, code plug-in or arbitrary host
path read is permitted. Local import requires a file selected by the user.

Capture/import/edit does not auto-apply to the HPU. The GUI requires confirmation
for apply; the shell command `russl apply` is itself an explicit write. Stale UI
state is rejected and cleared on start/stop. The CRC32 revision is cooperative
concurrency protection, not authentication against hostile chosen collisions.
SHA-256 receipts likewise are hashes, not signatures. An attacker able to modify
the application/worker or all file contents is outside checksum-only protection.

Apply resets transient HPU state. It preflights the VFS replacement and rolls back
publication errors. Existing transaction and browser-storage protections remain
required. A staged TIFF is not a full session backup. Keep full exported backups.
Complete constraints and intentionally unsupported image profiles are documented
in docs/RUSSL_PIXEL_PROFILE.md; generic TIFF/OME-Zarr conformance is not claimed.

## 2.2.1 additional bounds and transaction protections

Environment storage: 256 own slots (including tombstones), 64 KiB UTF-8 per scope; aliases: 128 entries, 64 KiB UTF-8. Expanded words: 16 KiB; total expanded arguments/redirects: 64 KiB. Pipeline captures and stderr are bounded in UTF-8 bytes. SIGINT cancels the entire submitted command list. Completion escapes filename syntax before insertion. UI command submission rejects all terminal controls.

TIFF management holds a command barrier through commit. Power operations refuse other active sessions and interrupted power commands. HPU shell commands snapshot field/caches/files and roll back on numerical limits, quota failure or publication error; success output is deferred until commit to live state. TIFF tone curves, sample min/max, volume and raw-DNG transforms are rejected by the bounded grayscale profile. Static hosting rejects Windows alternate streams, reserved devices and filename aliases. The private launcher also checks ancestor reparse points and uses core .NET streaming SHA-256. Simultaneous hostile local filesystem replacement remains outside this single-user model.

## 2.2.2 native reference and startup checks

The C# reference clones input, publishes one complete immutable result, returns defensive output copies and exports each concurrent call's own snapshot. Byte TIFFs explicitly describe uncalibrated unsigned data. The Windows bootstrap validates the native OS architecture, SHA-256, PE32+ machine and exact Node version/platform/process architecture before promoting or executing a private runtime. These checks passed on Windows x64; the ARM64 byte and rejection contracts passed without executing ARM64 code.

The optional browser QA runner uses a new temporary profile and keeps the Chromium sandbox enabled. Browser launch restrictions on the audit host prevented production persistence validation. A core or native-reference PASS does not certify browser storage; exact browser status is recorded separately.
