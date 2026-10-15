# HERMIT gateway audit for JA21 semi-silicon XPU integration

Input: `D:/downloads/hermit-ramws_2.0.0-ramws.1(3).zip`, SHA-256 `4577a4c720fcd2769acf53ca462f3f9534144ca523e104a33b7e201720f90a6e`. Reviewed the source as reference material. Prior approvals and commands stated inside its documentation do not authorize deployment, dependency installation, fabric builds, or host command execution in this task.

The terminal, strict protocol codecs, and bounded WebSocket framing are usable integration components. Importing the gateway unchanged would create an independent Node SPIRAL kernel for each client rather than attach to the existing browser XPU, GPU device, or IndexedDB state. The JA21 browser RAM worker must remain the computation authority.

## Findings

| ID | Impact | Source | Finding and required fix |
|---|---|---|---|
| G01 | Startup failure | `tools/start-local.js:26`, `gateway/config.js:107-108` | The advertised launcher unconditionally enables snapshots and sets their directory. The sole implemented LOCAL_VOLATILE profile rejects these settings. A new integration launcher must omit those settings and must not silently enable the DF fabric. Reproduced through the actual configuration loader. |
| G02 | Wrong computation authority | `gateway/connection.js:249-252`, `worker/core.js:50` | Each connection starts a server worker with a new independent kernel. It lacks the JA21 HPU/XPU host bridge, browser WebGPU, and IndexedDB. Reuse the transport/terminal components with a browser-worker adapter or bounded loopback relay; never label a Node worker as the existing GPU XPU. |
| G03 | Credential revocation failure | `gateway/auth.js:56-60` | A session's `stillValid()` check matches only principal identity and capabilities. If one of two tokens for the same principal is revoked, its established session remains valid through the other token. Return a server-owned credential verifier/id from authentication and require that exact entry to remain current, unrevoked, unexpired, and capability-compatible. Do not expose this credential binding in client messages. Reproduced with two owned fixture tokens. |
| G04 | WebSocket control frame violation | `gateway/ws.js:142` | Outgoing close reasons are limited by UTF-16 characters rather than encoded bytes. A 100-character non-ASCII reason produces a 202-byte close payload. Encode and trim at Unicode scalar boundaries to at most 123 reason bytes; validate outgoing close codes. Reproduced with a fake transport: payload length 202 and extended control-frame length. [RFC 6455 §5.5](https://www.rfc-editor.org/rfc/rfc6455.html#section-5.5) requires control payloads at most 125 bytes; §5.5.1 includes the two-byte status in that payload. |
| G05 | Unsuitable public deployment default | `gateway/config.js:42`, `deploy/render.yaml`, `tools/start-local.js:25` | The standalone production gateway defaults to all interfaces and the quick launcher discovers/enables external fabric tooling. For this request, bind only a literal loopback address, disable fabric/Photon/host-shell paths, require an explicit local enable action, and reject non-loopback configuration. Render and Docker files are authored deployment references; no deployment was performed. |
| G06 | Stale configuration documentation | `config/limits.json`, `gateway/config.js` | The proposed limits document differs from effective limits: VFS 16 MiB versus 4 MiB, history 1000 versus 500, pending output 4 MiB versus 2 MiB. Derive new integration status and limits from actual code; do not import performance or residency claims as present-host evidence. |

## Controls checked

The independent source-snapshot harness completed 15 checks on Node 24.19.0: 12 passed and three expected defect reproductions succeeded (G01, G03, G04). It opened no listener, installed no dependencies, and executed no commands from the attachment. Raw results: `GATEWAY_AUDIT_TESTS.json`; runner: `gateway-audit.cjs`; reviewed source snapshot: `GATEWAY_AUDIT_SOURCES.json`.

Passed controls include strict configuration syntax; refusal of open authentication off loopback; refusal of unsupported persistence profiles; exact origin matching; opaque/foreign origin rejection; loopback Host rebinding rejection; public configuration allowlisting; origin-bound, single-use tickets; handshake validation; exact frame content across every TCP split position; fragmented UTF-8 assembly; unmasked frame rejection; invalid UTF-8 rejection; and oversized incoming control-frame rejection.

The existing gateway also has bounded assembly age and fragments, session/connection capacity limits, cumulative byte credits, monotonic input sequences, connection-bound terminal data, epochs, output queue budgets, worker supervision, and disclosed process-loss semantics. Worker threads provide JavaScript isolate separation and a heap cap, not an OS sandbox; browser/remote callout commands are filtered and fabric defaults off at the gateway level. The integration must preserve these useful bounds while simplifying away the independent Node compute worker.

## Recommended minimal integration

Keep the native WebView2 console working entirely in process: HERMIT VT modules adapt to the existing RamLink session API and use MessagePort transport. For browser mode, an optional local Node host can expose one loopback WebSocket relay to the same browser worker. The relay passes validated, bounded terminal/session frames only; it does not evaluate JavaScript, execute a host shell, instantiate a second HPU, or accept arbitrary XPU shader code.

Use a fresh relay epoch per host launch and a single registered worker owner per live console. Bind admission to an exact origin and a server-issued session/ticket or bounded first-frame handshake; keep credentials out of URLs, logs, persistent storage, and UI exports. Reject unknown roles/types, duplicate registration, stale epochs, foreign session identifiers, sequence gaps/replays, over-crediting, and output queues that exceed limits. Loss of the worker owner closes dependent clients and discloses unknown execution outcome without replaying input. A recreated browser worker must rebind explicitly and must not reuse a prior GPU confirmation as fresh evidence.

Preserve the distinction between accepted terminal input, completed virtual commands, and durable XPU save completion. A WebSocket send callback proves local transport completion only. The XPU worker already owns GPU cancellation and atomic state publication; remote input must reach those same handlers and barriers.

## Required integration verification

1. Native/in-process VT commands and cancellation use the same RAM worker and XPU receipt as the existing console UI.
2. A real loopback WebSocket command changes the same browser worker state; a second client observes the same result through its own authorized terminal session, without a Node compute kernel.
3. Foreign Origin/Host, missing/invalid admission, wrong subprotocol, unmasked/invalid UTF-8/oversized frames, and malformed protocol envelopes fail before state change.
4. Backpressure, credit arithmetic, queue caps, session limits, no-credit peers, cancellation, worker loss, websocket reconnect, and process epochs release all budgets and never replay inputs.
5. Terminal escaping and shell-looking input remain text/virtual commands; no host-side filesystem or subprocess effects.
6. Existing XPU core, GPU confirmation, saved-state recovery, TIFF, native preflight, and package hash tests still pass. Browser GPU and native live-window claims require new observations, not attached evidence.

No production source was changed during this audit.
