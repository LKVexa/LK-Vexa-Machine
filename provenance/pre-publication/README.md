# JA21 Semi-sili XPU Console

**Console 1.4.0 · JA21 CPU/XPU engine 2.4.0 · Windows x64**

Open the **Semi-sili XPU** tab to sample the resident 64 × 64 field, perform finite p-adic phase arithmetic, evolve bounded neurons and verify every arithmetic result on the available hardware GPU. **Run preview** checks a detached candidate; **Save result** commits its neuron bank and complex field together. CPU preview is an explicit option. GPU-required mode cannot save an unconfirmed result.

The pipeline uses the laptop's existing CPU and GPU. Its phase waves and neuron evolution are numerical models. The GPU independently confirms finite ring arithmetic; it does not run the phase or neuron stages. The 26 supplied references are mapped to equations, storage profiles and implementation limits in `docs/SEMISILI-XPU.md` and the three literature reports. Legacy byte lanes retain their audited CPU behavior.

The browser validation kit is linked from **System & limits**. It uses a separate test volume, reloads to check exact recovery, runs all five GPU operations and exports a JSON receipt. Close and reopen the complete application before its final restart check. Keep a full backup from **Virtual storage**.

The attached blank console now contains the JA21 software CPU/XPU. Run **Start Console.cmd** to open its terminal, virtual filesystem, byte lanes, complex-field displays and TIFF pixel tools inside the console window. There is no separate browser window or local Node server in this launch path.

The CPU is a JavaScript software model running in a module worker inside the console's WebView2 engine. It needs no ARM64 operating-system boot. It is the JA21 model selected for this integration; its six byte processors are not an ARM instruction-set emulator. The native console and WebView2 still use the Windows host to present and execute the software.

The Console view has three panes, each with its own command box: **XPU 1**, **XPU 2**, and **Administrator PowerShell**. The first two share the numerical engine and virtual volume. Select **Connect PowerShell** in the third pane to request Windows elevation. Use `Invoke-JA21Terminal -Terminal 1 -Command 'xpu info'` or target terminal 2 to delegate and receive the completed result. See `applications/silicon/docs/TERMINALS.md`. Panes stack on narrow windows.

**Start WebSocket Console.cmd** is the optional localhost browser/terminal launcher. The native console needs no Node runtime; the WebSocket launcher provisions a private, hash-verified official Node runtime on first use. Keep the same local port to retain the same browser volume.

## Start and use

1. Extract the complete package into a writable folder, such as `D:\Codex\JA21-Software-CPU-Console`.
2. Double-click **Start Console.cmd** with your usual Windows account. Keep the startup window available for diagnostics.
3. In the embedded terminal, run `help`, `xpuinfo`, or `hpu bytes`. The six software lanes update the field displays. The Storage and TIFF views provide save, full backup/restore and staged field operations.
4. Close with **Alt+F4**. **Alt+Space** opens the native move/resize menu. `Start Console.cmd --blank` opens the original empty host for inspection.

Requirements are Windows x64, .NET Framework/WPF and the installed Microsoft Edge WebView2 Evergreen Runtime. The pinned Microsoft WebView2 SDK adapter is included. Node, PowerShell script startup and a system ARM64 runtime are not required for this integrated launch. Startup reports unavailable live rendering instead of presenting an inert renderer as an executing CPU.

## How it is embedded

`applications/silicon/` holds the complete 2.4.0 software-console source, rebuilt static assets, tests and original evidence. WebView2 maps only `applications/silicon/dist` to `https://ja21-silicon.invalid/`. This reserved address is resolved locally by WebView2; it is not a public website or an HTTP server. The stable HTTPS origin provides the secure browser context used by the worker, Web Crypto, Web Locks and IndexedDB. Microsoft documents local virtual-host storage and worker loading in [Using local content in WebView2 apps](https://learn.microsoft.com/microsoft-edge/webview2/concepts/working-with-local-content) and [the virtual-host mapping API](https://learn.microsoft.com/microsoft-edge/webview2/reference/win32/icorewebview2_3).

The integration adds a restrictive Content-Security-Policy and no-referrer metadata overlay to the component's page. The native bridge enforces the exact mapped origin and resource boundary; all mapped files are included in the native runtime seal. A local mapping cannot reproduce every HTTP response header, so HTTP-only frame-ancestor and cross-origin-isolation directives are not claimed from the metadata overlay. Console mode uses the standard WPF WebView2 control; the original full browser retains its composition view.

The console frame retains its original minimal chrome; the CPU's own controls appear inside it. `CONSOLE_VERSION` identifies this integration, while root `VERSION` retains native presenter compatibility 9.8.7. `CONSOLE_BUILD.json` identifies both components. The original blank-console documents and evidence are retained as historical provenance.

## Saved state

The embedded application uses IndexedDB at its stable mapped origin. Its WebView2 profile and console-owned files live under `workspace/`. Extract to a short folder path so the profile stays within the checked Windows path budget. If startup reports an overlong profile path, close the console and move the complete extracted folder, including its workspace, to a shorter location. Save and export full backups through the Storage view. A profile or origin change creates a separate browser volume; import an exported backup to move an existing volume from the older local browser edition. Browser storage does not replace an external backup.

## Validation

`evidence/hermit/RELEASE_VALIDATION.json` records the current checks and remaining live gates. `VALIDATION.txt`, `evidence/integration-1.2.0/` and the earlier semi-sili reports retain their historical scope. The component's Node/core, native reference and pixel tests remain available beneath `applications/silicon/`. Administrator startup and delegation require a separate elevated Windows session test; protocol fixtures do not establish that live pass.

Python tools are optional development/verification dependencies. `tools/reseal.py` regenerates runtime and package integrity records after an intentional source change; these hashes are integrity checks rather than signatures. The browser CPU needs neither Python nor Node at launch. See the supplied acceptance instructions for checking the mapped worker, saved files, field state, lock ownership and backup/restore on the target Windows session.

The original console's GPL notices, Microsoft terms and per-component notices are retained. The imported software component's original private/UNLICENSED package declaration and third-party notices are preserved under `applications/silicon/`; this integration does not replace those notices. The attached source already recorded 191 absent historical reference files, retained in `provenance/source-audit.json`.
