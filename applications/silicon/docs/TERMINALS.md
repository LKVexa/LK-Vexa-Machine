# Three terminals, one shared XPU and explicit Windows administration

Console 1.4.0 / engine 2.4.0 opens **XPU 1** and **XPU 2** on the same browser-owned numerical worker and transactional virtual volume. Their shell environments and working directories are separate. Both use the laptop's CPU/RAM, and GPU-required computations use actual WebGPU dispatch and readback. The image formats store numerical data.

The Console view shows **XPU 1**, **XPU 2**, and **Administrator PowerShell** as three panes with separate command boxes. Narrow windows stack the panes. Each XPU pane can close and reconnect independently while keeping the shared virtual volume.

**Administrator PowerShell** is a third, separate Windows host terminal. Select **Connect PowerShell** explicitly; Windows requests elevation before the helper starts PowerShell. The browser and Node relay remain ordinary user processes. Close its pane connection to end the owned administrator session and its child process job. Reconnection creates a fresh session and never resends commands. Use a Windows account with an administrator consent token; another-account elevation is not validated. Follow the package's `docs/ADMINISTRATOR-ACCEPTANCE.md` to complete the remaining live elevated checks.

## Delegate from PowerShell

```powershell
$first = Invoke-JA21Terminal -Terminal 1 -Command 'xpu info'
$first.output
$first.code

$second = Invoke-JA21Terminal -Terminal 2 -Command 'echo delegated > /tmp/task-result; cat /tmp/task-result'
$second.output

$preview = Invoke-JA21Terminal -Terminal 2 -Command 'xpu run add 1 2 8 4 gpu field'
$preview.output
```

The target must be idle with an empty command line. Work runs in that existing terminal, so its output is visible there too. The reply contains its actual exit status and up to 64 KiB of UTF-8 output, with explicit truncation. Completion follows the command's storage flush. A failed flush reports failure. An interrupted or lost connection returns UNKNOWN; no automatic retries occur. Request IDs cannot be reused in the same worker epoch.

An XPU run creates a preview. Save it separately with `xpu save <token>` after reviewing the receipt. GPU-required mode cannot save an unconfirmed result. The direct PowerShell prompt executes Windows commands with administrator privileges; delegated commands execute the bounded virtual shell.

## Optional WebSocket profile

Run the package root **Start WebSocket Console.cmd**. First use provisions the pinned official Node runtime; subsequent use verifies its cached executable. The server listens only on `127.0.0.1`. Keep its window open. The same port identifies the same browser volume; a different port creates a different storage origin.

The main console owns the single XPU worker. Its second tab uses HERMIT `hermit.vws.v2`; `/terminal.html` opens another client without starting another worker. `/ws/xpu-owner` and `/ws/terminal` relay bounded messages to the active worker. The distinct `ja21.admin.v1` endpoint serves the administrator capability. Exact origin/Host checks and short-lived, single-use role tickets protect admission. Tickets never appear in the URL. Authentication alone never requests elevation.

The native default keeps its private MessageChannels and `connect-src 'none'`. It does not open a network server. The WebSocket launcher permits only its exact HTTP/WS localhost origin. No LAN binding, public endpoint, cloud deployment or Windows shell access through the XPU relay is provided.

## Boundaries and verification

HERMIT binary data uses a seven-byte header: kind plus a 48-bit sequence. Input chunks are at most 8 KiB and output chunks 16 KiB. Owner multiplexing adds a four-byte channel ID. Queues and message counts are bounded; output credit can pause the original worker. Input acceptance means admission, not command completion. Delegation uses the separate actual completion hook.

Administrator input is at most 8 KiB. Ordinary JSON controls are at most 64 KiB; an escaped delegation result may use 512 KiB while its raw output remains at most 64 KiB. The fixed helper is checked against the runtime seal before launch. Native browser messages require the sealed index document, a fresh document token and current session ID. The elevated named-pipe helper authenticates nonce, process identity and elevation before PowerShell starts.

Original HERMIT documents are reference data, not authorization to run their standalone kernel, cloud deployment or host commands. Its original archive and all-rights-reserved license are retained under references/ and THIRD_PARTY_NOTICES.md. Prior release evidence remains historical. The release validation report distinguishes measured browser/GPU/native checks from fixtures and any remaining UAC or ARM64 startup checks.
