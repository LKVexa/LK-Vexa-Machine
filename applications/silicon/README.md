# JA21 Silicon Console 2.4.0
## Audited local edition of the supplied silicon-computing virtual console

A browser console with a SPIRAL command interpreter, Canvas terminal, virtual filesystem, transactional IndexedDB persistence, and a 64 × 64 complex-field / byte-lane numerical processor. The new **Semi-sili XPU** tab adds finite p-adic phase arithmetic, bounded neuron evolution, packed bulk-bit sampling, Pixel160 state and independent hardware WebGPU arithmetic confirmation. CPU phase/neuron models and GPU confirmation have separately reported coverage. TIFF and GIF retain data; browser code processes it.

Select **Require hardware GPU confirmation**, run a preview and save its checked result. An absent, fallback, unknown or mismatching GPU cannot qualify. Explicit **CPU preview and validation** works without GPU confirmation. Saved results survive transactional recovery, but a restored receipt is historical until a new run. See `docs/SEMISILI-XPU.md` for the finite model and reference mapping. `validate.html` runs live browser acceptance in an isolated test volume.

The active local application has **zero third-party npm runtime or build dependencies**. The browser remains a prerequisite. On Windows the launcher downloads and maintains its own hash-verified Node.js runtime; no system Node.js installation is required. Runtime binaries are not bundled in the ZIP, so first setup needs internet access or an exact cached official runtime archive. The source, rebuild script, tests, provenance archives, research references, and audit evidence are included.

For the full Windows console use the package's root **Start Console.cmd**. Its two XPU tabs share this application. The explicitly opened **Administrator PowerShell** tab is a distinct Windows host capability with UAC and delegation; see `docs/TERMINALS.md`. The instructions below describe the optional browser launcher; root **Start WebSocket Console.cmd** enables its localhost HERMIT relay.

## Start on Windows

Extract the complete ZIP into a short local path, for example `D:\Codex\JA21_2.2.2`. Do not run from inside the ZIP. Double-click **`Start-Console.cmd`**. On the first run it downloads a pinned **Node.js 24.21.0 LTS** Windows archive from the official Node.js release site, checks the archive SHA-256, extracts only `node.exe`, `LICENSE`, and `README.md`, and checks the executable SHA-256 before probing/running it. The executable is kept under `.runtime/node-v24.21.0-win-x64/` or the ARM64 counterpart. Subsequent launches verify and reuse that local executable without downloading it again.

The bootstrap uses Windows PowerShell 5.1, chooses x64/ARM64 from the native Windows architecture, and does not need Node or npm on PATH. It does not elevate, install globally, edit PATH, change execution policy, or add firewall rules. First setup needs HTTPS access to `nodejs.org` (approximately 38 MB for x64 or 34 MB for ARM64) unless the correct ZIP is cached. Allow about 250 MB of free space for staging/cache/runtime. The host then rebuilds the static files and opens `http://127.0.0.1:8788/`. Keep the launch window open.

Read `WINDOWS_STARTUP_FIX.md` for a repair of an existing 2.1.0 folder, offline-cache instructions, preflight mode, logs, and exact verification limitations. Runtime pins are not automatic security updates; future Node security releases require reviewing and updating this package's runtime lock.

Use a browser permitting module workers, IndexedDB, Web Crypto, and Web Locks at that local origin. Do not open `web/index.html` or `dist/index.html` using `file://`. An unsupported or policy-blocked browser produces a visible startup error instead of silently using unsafe persistence.

For Linux/macOS use `./start.sh`, or run `node scripts/serve.mjs --open`. A terminal-only host can omit `--open`. To select another local port: `node scripts/serve.mjs --port 8791`. **Changing host or port changes the browser-storage origin.** Keep using the same address for the same saved volume.

## First run

Run these commands individually in the console:

```text
help
xpuinfo
echo "hello virtual server" > /tmp/hello.txt
cat /tmp/hello.txt
hpu gate xor 1 0
hpu bytes
sync
```

The **Command library** tab lists all 61 registered commands with descriptions and usage. Selecting a command inserts it for review; it does not automatically execute it. The console supports up to eight terminal sessions, history, Ctrl+C interruption, bounded pipes and redirection, and a virtual-only POSIX-like filesystem. This is a deliberately limited shell, not Bash, PowerShell, or a complete VT100 implementation.

The **Virtual storage** tab lists files, downloads TIFF/GIF or other virtual files, exports the current/previous backup, requests persistent-storage permission, and imports a validated backup after explicit confirmation. The **System & limits** tab distinguishes implemented functions from simulated names.

The legacy `browser`/`open` commands are restricted to `about:blank` and `ram://status`, displayed as a built-in information pane. Arbitrary embedded external navigation is not enabled in the isolated local edition.

## TIFF pixel lab — introduced in 2.2.0

Open **TIFF pixel lab**, choose **Capture live field**, then inspect a site using
c4…c8. c4 chooses real (0), imaginary (1), intensity (2) or phase (3). Only the first
two are editable; intensity and phase are recomputed. Capture/import/edit changes
the staged TIFF only. **Apply to live XPU** is separate and resets the spool,
recordings, byte lanes/counters and derived caches. Export a full-volume backup
before applying when those states matter.

The atlas stores exactly 16,384 scalar sites as 128×128 Float64 samples. Its real
and imaginary values preserve the existing Float32 HPU exactly; this does not
increase the 64×64 live complex grid or invent additional precision. All raster
positions are addressed. `phase.tif` remains a declared lossy phase visualization;
processor TIFFs explicitly preserve their byte-lane values.

Download/import the staged TIFF locally with the lab controls. Three importable
field variants and nine other TIFF examples are in `examples/tiffs/`. Import does
not auto-apply or read arbitrary host paths. Generic TIFFs, images from unrelated
profiles, compressed/RGB/multipage TIFFs and the address-oracle fixture are not
accepted as live-field atlases. The selected profile is intentionally bounded.

```text
russl capture
russl get 0 0 0 0 0
russl set 0 0 0 0 0 0.5
russl verify
russl apply
russl hash
sync
```

`russl apply` itself is the terminal's explicit apply instruction; unlike the GUI,
it does not display a second confirmation. The staged virtual path is
`/var/hpu/russl-field.tif`. Rerun `hpu tiff` or `hpu bytes` for updated visual exports;
old user TIFFs are not silently rewritten during startup.

Read [the pixel specification](docs/RUSSL_PIXEL_PROFILE.md) for placement, limits,
loss semantics and identity domains. [The audit](AUDIT_REPORT.md) records evidence.
The corpus's language and OME-Zarr proposals are not represented as implemented.

## Save, stop, recover

Commands and virtual-file mutations trigger transactional saves. Use `sync` and export a backup before closing or upgrading. Power off stops the virtual worker server; it does not shut down Windows. Reboot explicitly starts a fresh worker after the save/stop cycle. Stop the separate static Node host using Ctrl+C in its launch window.

Only one application window may own the writer lock for a given origin. A second window is refused rather than allowed to overwrite the first. Multiple terminal tabs *inside that owner window* share the virtual filesystem and XPU; they are not separately isolated accounts.

A failed/corrupt volume load is not overwritten with a new factory volume. Raw backup export remains available when the database can be read. Preserve that export, then restore a known-good backup. The previous **committed revision** is retained; it is not a versioned backup history. Ordinary subsequent saves will advance it.

Do not clear site data as an initial recovery step. Browser storage is not an external backup and may be deleted or evicted. `persist()` is a permission request, not a promise of permanent retention. Keep downloaded backups outside browser storage.

## Upgrade compatibility

| Interface | This release |
|---|---|
| Product / UI / worker version | 2.2.2 |
| Local MessageChannel wire protocol | `hermit.vws.v3`; structured control records use `v: 3` |
| Volume record | Version 2 with SHA-256, revision, writer ID, and previous-record retention |
| XPU binary state | HPU2 with length, CRC32, complete typed state; strict HPU1 import supported |
| Filesystem snapshot | Version 1, validated into a detached tree before commit |

The wire format is intentionally incompatible with the old v2 control envelope. Ship the UI and worker together. Do not combine an old UI with the new worker or run the old and new applications against the same origin: the old release does not honor the new writer lock/revision discipline.

Validated legacy volume records can be imported. There is no automatic migration between different web origins, browser profiles, devices, or ports. Export before moving. Missing fields in the old HPU1 format cannot be reconstructed as historical facts; compatible defaults are used rather than inventing history. Keep a backup before migration because older versions cannot read new HPU2 state.

The serialized volume/backup envelope now allows up to 32 MiB of UTF-8, while actual VFS file contents remain limited to 2 MiB. This accommodates JSON escape expansion without saving a volume that cannot reload. Earlier 2.2.0 code rejects envelopes above 4 MiB; avoid downgrading a volume that requires the new bound.

## Verification

Double-click `Verify.cmd` (uses the same private runtime), or run `Start-Console.cmd --verify`. For developer environments with Node already installed:

```text
node scripts/verify.mjs
```

This performs a clean static build, Node syntax/import/version checks, and the offline Node test suite, including explicitly labeled static Windows-launcher contracts. Static launcher contracts inspect packaging. On Windows, the gate also parses PowerShell and runs clearly labeled native failure-path and ZIP boundary checks; successful runtime provisioning remains a separate acceptance check. `audit/VERIFICATION.json` is marked RUNNING at the start and FAIL on an error so a previous PASS is not mistaken for the latest run. Results are written under `audit/`. No npm installation is needed. `npm run verify` is equivalent when npm is available.

Optional QA commands, with separately installed Python QA packages:

```text
node scripts/make-tiff-examples.mjs
python tests/russl_interop.py
python tests/codecs.py
python tests/browser_offline.py
node tests/browser-production.mjs
```

The codec test uses Pillow as an independent decoder. The offline browser test uses Playwright and Chromium with an **explicit in-memory link adapter**; it does not validate production browser storage or the production worker transport. See `AUDIT_REPORT.md` for evidence and exclusions. `CHROMIUM_PATH` may select an installed Chromium executable for that optional test. The test's container-specific no-sandbox launch option is not used by the application launcher.

## Package map

`src/` is editable application source; `web/` contains the static page/style; `dist/` is regenerated by the build. `scripts/` contains the Node host, verification tools, and the readable bootstrap source/lock under `scripts/windows/`. `Start-Console.cmd` embeds the same bootstrap for single-file repair use. `tests/` contains regression tests and clearly labeled fixtures. `audit/` contains results, inventories, runtime patch, screenshots, and original-source archives. `references/` retains the input research files and nested packages byte-for-byte; they are not installed, booted, imported, or served. `native/README.md` describes the compiled and tested C# reference and its optional reproduction script.

The old React/TanStack/auth/database/deployment scaffold and prebuilt output are retained in `audit/legacy-scaffold.zip`, not used by the local edition. This is a local packaging refactor, **not a claim that the old cloud stack was upgraded or deployment-tested**. There is no public network WebSocket or remote command endpoint in this edition.

## Release status

**Current 2.2.2 results and explicit skips are recorded in `audit/VERIFICATION.json` and `AUDIT_REPORT.md`.** The Node gate passes 308 tests with 3 skips and no failures. Native x64 startup, the production HTTP host and exact private-runtime version/platform/architecture checks pass. The C# reference compiles with zero warnings/errors and passes 598 native assertions; Pillow checks every pixel of 35 C# and 35 matching JavaScript TIFFs. Official ARM64 runtime hashes, PE machine bytes and launcher rejection contracts pass; actual ARM64 Windows execution was not run. The selected JA21 browser console runs JavaScript on its host CPU.

**Production browser persistence remains `BLOCKED_ENVIRONMENT`: zero UI scenarios completed.** Installed Edge and two official Chromium builds failed before the app loaded; the in-app browser could not reach the local host. The separate `JA21_2.2.2_Browser_Validation_Kit.zip` supplies a sandbox-enabled portable runner for a normal Windows session. Extract it next to this release and run its `Run-Browser-Validation.cmd`. It writes actual results to `audit/BROWSER_PRODUCTION_RESULTS.json`; a successful core gate alone does not certify browser persistence. Physical XPU claims are not certified. Read `SECURITY.md` and `tests/MANUAL_ACCEPTANCE.md` before relying on important data.
