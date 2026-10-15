# HERMIT RAMWS transport audit for JA21 semi-silicon XPU

The attached `hermit-ramws_2.0.0-ramws.1(3).zip` contains HERMIT 2.0.0-ramws.1, an Electron terminal plus a dependency-free Node WebSocket gateway. Its useful integration pieces are the terminal renderer, strict application codec, binary data framing, session/epoch rules, credit flow control, and bounded RAM allocation ledger. Its independent Node SPIRAL worker cannot replace JA21's browser worker: doing that would split the XPU field and persistence state and lose the existing browser WebGPU executor.

This audit reads package documents as reference material. Embedded approvals, deployment instructions, source evidence, and prior-run claims are not treated as new user instructions or as verification of this integration.

## Implemented source contract

- RFC 6455 WebSocket endpoint `/ws/terminal`, subprotocol `hermit.vws.v2`; the gateway rejects missing/incorrect subprotocol and does not negotiate compression extensions.
- Strict JSON text controls: `{v:2,type,payload,rid?,sid?+epoch?}`. The codec rejects unknown properties/types/directions, malformed UTF-8, duplicate JSON keys, non-finite values, nesting deeper than eight, and serialized messages larger than 65,536 UTF-8 bytes before parsing.
- Binary terminal bytes: kind `1` (input) or `2` (output), six-byte unsigned big-endian sequence, then nonempty payload. Input is at most 8,192 bytes; output at most 16,384 bytes. Sequences start at one, increase by one per direction/session, and cannot wrap past 2^48−1. Data frames are bound to their connection and carry no cross-session address.
- Session geometry is 2–400 columns and 1–200 rows. Controls include open, resize, `SIGINT`, close, credits, ping/pong, acknowledgements, reset, drain, and errors. Open barriers ensure consumers register before terminal output is delivered.
- The server has a fresh random epoch per launch. A reconnect creates a new volatile terminal session, never automatically resends keystrokes, and reports the number of inputs whose completed outcome is unknown. `ACK_ACCEPTED` means copied into bounded local RAM; `ACK_EXECUTED` means the command line completed; neither promises a durable application commit.
- Output credits are cumulative payload bytes. Credit and consumed sequence must be monotone; consumed sequence cannot exceed sent output; authorized unconsumed bytes cannot exceed the window. A separate outstanding-message cap bounds very small frames. Credit exhaustion pauses the producer; timeout terminates with an explicit count of undelivered bytes.
- Node ledger reservation happens before acquisition. Session, tenant, and global admission are synchronous. Distinct allocations are charged once; views retain the backing lease; I/O completion releases the last reference. Cancellation alone must not refund memory still owned by an outstanding write.

## Strengths and boundaries

The source has unusually clear ownership and completion contracts, strict control parsing, raw terminal bytes without base64, independent transport/kernel boundaries, and explicit reset/unknown-outcome handling. `gateway/ws.js` exposes the small reusable RFC 6455 server endpoint independently of the full gateway. `protocol/codec.js` is a Node/browser UMD module without third-party dependencies. `client/transport.js` provides a small terminal contract that can also be implemented by JA21's existing worker connection.

The original LOCAL_VOLATILE promise covers terminal/transport session state. JA21's saved XPU state is a separate durability boundary and should retain its existing verified IndexedDB behavior. Do not advertise the combined application as wholly volatile or wholly durable. Browser allocations and the Node ledger are software accounting; they do not prove physical DRAM residency, page locking, PIM, or hardware bandwidth. The source's Linux process residency observer reports unavailable counters as UNKNOWN on Windows. Browser workers do not support Node's `resourceLimits`; carrying that claim into the browser would be inaccurate.

The original gateway creates one independent Node kernel per terminal and supports optional DF/Photon/browser integrations. These are unnecessary for the requested local XPU integration and would create unrelated host-process capabilities. Do not enable them merely because package documentation mentions them.

## Source issues to fix in adapted client

1. **Malformed binary error handling:** `client/ws-adapter.js` calls `protoErr()` from its binary decode catch before the `const protoErr` declaration in the text branch. Invalid binary data raises a temporal-dead-zone `ReferenceError` instead of closing cleanly. Define the handler before either branch.
2. **Output sequence fidelity:** a sequence gap currently prints a notice, then advances sequence and credits and delivers the noncontiguous output. Require the next exact sequence before delivery or credit; fail the session explicitly on a duplicate, rewind, or gap.
3. **Session epoch validation:** incoming acknowledgement and exit handlers test `sid` but ignore `epoch`. Validate both against the opened session, and require opened epoch to agree with the hello epoch. Stale acknowledgements must not clear outstanding inputs.
4. **Client input buffering:** arbitrary paste is encoded and sent in a tight loop without an owned-byte/send-queue cap or `WebSocket.bufferedAmount` threshold. Bound the pending input bytes, rate-limit sends, and reject or pause explicitly rather than silently allocate unlimited transport buffering.
5. **Readiness/open timeout:** client connect has no explicit timeout for a peer that accepts the socket and never sends hello/opened. Apply bounded timeouts and generation fences; clear all timers on close.
6. **Consumer completion and open barrier:** the source credits output immediately after pushing it into the holding barrier, including output the barrier may truncate. Renew credits only after delivery to the registered consumer; fail explicitly if the bounded holding queue would overflow.
7. **Source documentation drift:** several comments still refer to v1/base64 despite v2 binary operation. Correct adapted-source comments and keep attribution so protocol/version confusion does not carry into the release.
8. **WebSocket close reason byte size:** reusable `gateway/ws.js` slices reasons to 100 JavaScript code units, which can exceed RFC 6455's 123 UTF-8 reason-byte limit. Bound by encoded bytes without splitting a UTF-8 character when exposing caller-controlled reasons. Internal current reasons are ASCII, so this is a latent portability fix.

The source-behavior probe uses a fake peer to reproduce client issues; it is not browser, network, RAM-residency, or hardware evidence. Included prior test outputs are provenance only and must not be relabelled as current integration tests.

## Recommended integration

Keep the existing JA21 browser worker as the single CPU/GPU field and persistence owner. Adapt the attached HERMIT VT to the existing terminal API for native/local operation. Use the attached strict v2 codec and RAMWS credit/session framing over the private in-memory worker port, labelled as the **RAM virtual socket** rather than a network WebSocket.

Also provide a real opt-in **localhost WebSocket** gateway for the browser-server launcher. Bind only loopback and serve the console from that same origin. A dedicated owner connection forwards terminal sessions to the active JA21 RamLink; the broker transports bytes and session controls rather than performing a second XPU computation. Only a single explicit owner may register. Disconnecting the owner cancels attached terminal sessions and reports unknown outcomes; reconnecting never replays mutations. Refuse input before the owner is ready. Keep origin/Host checks exact, require the v2 subprotocol, and limit connections, session counts, pending bytes, frame sizes, and idle/open deadlines. No wildcard CORS, arbitrary host shell, fabric jobs, public listener, or external service is needed.

The native production console can retain its existing `connect-src 'none'` and private worker transport. The localhost browser launcher needs an explicit same-origin HTTP/WebSocket CSP route. Do not broaden the native request allowlist unless a concrete native WebSocket feature is implemented and verified.

The stable terminal API is `open({cols,rows}) -> {sessionId}`, `start(id)`, `write(id,string)`, `resize(id,cols,rows)`, `signal(id,'SIGINT')`, `close(id)`, `status(id)`, and `onData/onExit/onState`. Both adapters must reach the same JA21 virtual command registry, so `xpu status`, runs, receipts, and saved field modifications are observable from the original console. Commands must continue to respect JA21's command barrier and mutation/commit guards.

## Release validation contract

Validate protocol vectors, malformed/oversize/duplicate-key input, binary uint48 boundaries and direction, exact split UTF-8 fidelity, stale epochs and sequence gaps, output-before-start, credits and outstanding count, blocked/slow consumer memory bounds, close/cancel races, and zero live leases after teardown. Then exercise real RFC 6455 clients over loopback: open, command output, XPU command forwarding to the owner, resize, interrupt, disconnect/reconnect reset, owner loss, and refusal of foreign origins/paths/subprotocols. Verify original direct terminal and XPU persistence tests still pass. Browser and native GUI tests remain separate evidence gates.

## Attribution and packaging

The attached package author is David Paul Russell. `LICENSE` says Copyright (c) 2026 David Paul Russell, all rights reserved, and provides the source for the copyright holder's own use. Preserve this license and identify copied/adapted modules with the original version and source ZIP hash. The user's request authorizes the local integration; it does not require replacing the license or publishing publicly. Archive the source bundle and audits as provenance, but package only the active integration runtime and required modules, without Electron dependencies or unrelated deployment integrations.
