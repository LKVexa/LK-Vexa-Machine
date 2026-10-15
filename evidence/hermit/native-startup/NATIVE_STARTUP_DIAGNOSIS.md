The startup failure is isolated to composition hosting. With the pinned SDK 1.0.4191.47 and installed Runtime 155.0.4283.45, a raw controller and a standard WPF WebView2 control initialize successfully. WebView2CompositionControl fails with COM HRESULT 0x8000FFFF at CreateCoreWebView2CompositionControllerAsync, before navigation.

| Probe | Environment | Result |
|---|---|---|
| raw | ambient | PASS |
| composition | ambient | FAIL 0x8000FFFF |
| windowed | ambient | PASS |
| windowed | relocated | PASS |
| composition | relocated | FAIL 0x8000FFFF |
| direct raw composition | ambient | FAIL 0x8000FFFF |

All probes were non-elevated. Each had a valid visible STA parent window, a fresh writable owned profile, and successful environment creation. Relocating APPDATA and LOCALAPPDATA did not change the result. A direct composition-controller call with the validated top-level HWND reproduced the failure without a WPF wrapper. No browser security flags, certificate exceptions, administrator helper, or application fallback were used.

The narrow fix is to use standard WPF WebView2 in ConsoleMode, whose existing layout is a bare content box without overlapping native chrome. Retain composition hosting for the full browser. Preserve the existing mapped-origin, resource, permissions and navigation boundaries. Microsoft documents the [shared IWebView2 interface and airspace distinction](https://learn.microsoft.com/en-us/microsoft-edge/webview2/platforms/wpf).

The underlying runtime/OS reason and the exact user-launched copy remain unconfirmed. This probe establishes initialization compatibility; it does not establish application boot, GPU computation, persistence, full restart, or administrator elevation. Raw JSON results, source and compiled diagnostic remain in this folder.

Subsequent mapped application checks

The actual compiled production ConsoleMode bridge then created its standard WPF control successfully and loaded engine 2.4.0. A deeply nested fresh profile reached the mapped page but reported “Internal error opening backing store for indexedDB.open.” The same exact 220-file runtime closure, copied into a shorter owned root and run with another fresh profile, reached Online with a real module worker and terminal prompt. The controlled comparison is recorded in NATIVE_PROFILE_PATH_CONTROL.json; profile lengths are 176 and 121 characters, and the origin-specific IndexedDB directory lengths are 251 and 196. No OS long-path or browser security settings changed, and no existing user volume was migrated or reset. This is a path-dependent failure on the tested host.

NATIVE_DOCUMENT_SHORT_PATH.png is a real CoreWebView2 CapturePreviewAsync image of the working native document. NATIVE_DOCUMENT_SHORT_PATH.json records its secure mapped origin, runtime version, resource responses and actual DOM. That diagnostic observed startup only; it did not request elevation or establish persistence/GPU computation.

The separate native policy acceptance passed 46 checks against the exact compiled main executable. The first full native QA attempt at the short root passed the runtime seal, actual worker/terminal boot and foreign-origin refusal, then its current-screen transcript parser lost a begin marker during the 25-line hpu bytes output. The raw failure is retained as NATIVE_QA_SHORT_INITIAL.json; the native owner is correcting this QA-only capture.

The first real main-entry attempt reached Program.Run but found that the runtime-only draft extraction omitted the mandatory DF_Small descriptor and payload. The full baseline package retained those bytes; packaging now includes and seals the inherited DF_Small tree in the runtime validation closure. NATIVE_MAIN_ENTRY_INITIAL.json retains the original production boot log. A fresh draft and actual main rerun remain required after the native/source freeze. Administrator IPC is blocked in this runner; elevated startup and UAC were not attempted.

Final three-pane validation

The final compiled standard ConsoleMode presenter and three-pane engine passed all eight native live acceptance scenarios. This includes byte-lane execution, exact field/file persistence across document reload, the real single-writer Web Lock, malformed restore preservation, and validated restore recovery. See NATIVE_WEBVIEW2_ACCEPTANCE_FINAL.json. The QA now uses a fresh short isolated workspace and matches the actual owns-volume refusal contract.

NATIVE_MAIN_PROCESS_RELAUNCH_FINAL.json records two distinct non-elevated diagnostic processes invoking the actual compiled SiliconConsoleEntry.Main and Program.Run. The first committed a known virtual file and byte-chip field through the real UI and IndexedDB. The second reopened the same isolated default package workspace and recovered the exact file and both full field-preview arrays, with clean native entry exits. NATIVE_DOCUMENT_THREE_PANES.png is the real SDK screenshot of that reopened native document: XPU 1 and XPU 2 connected, Administrator PowerShell explicitly disconnected. The current main executable also passed all 46 headless native policy checks.

Administrator IPC is blocked by this runner, and UAC/elevated startup were not attempted. The native WebView2 GPU computation path and full browser-broker termination/power-loss durability were not tested by these native scenarios. These gates remain distinct from successful standard native startup and committed-volume persistence. All earlier failures remain preserved.
