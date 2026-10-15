# Independent engine and terminal boundary review

The optional loopback broker and HERMIT terminal attach to the existing browser RAM worker. Default/native numerical execution remains within its original worker boundary. The separately requested Administrator PowerShell capability uses a fixed packaged native helper, explicit user open, Windows UAC, and its own protocol; neither the RFC broker nor the XPU worker launches a host shell.

Seven tests of the actual production worker/kernel passed. They cover two real session IDs, SSD flush ordering, nonzero command completion, CPU XPU preview plus token save without RPC deadlock, stale targets, control/partial-line refusal, closing and correlated cancellation, a storage write failure reported as code 2 / FAILED persistence, safe captured-output truncation, and refusal to replay admitted delegation IDs. Storage and writer locks are fixtures; GPU is unused.

Six native-adapter fixture tests passed. They verify the fixed executable path, hidden non-elevated bridge launch without a shell, no automatic UAC/open on authentication, exact session binding, input replay refusal, UTF-8 and message bounds, delegation correlation/timeout/UNKNOWN policy, native admission ACK distinction, and process cleanup. These checks do not verify an actual UAC approval or elevated PowerShell process.

The actual loopback RFC6455 tests also passed, including distinct administrator ticket/protocol admission and rejection of an administrator ticket on the XPU owner channel. Six serving tests verify opt-in endpoints, CSP header/meta agreement for both console and web-terminal pages, exact same-origin HTTP/WebSocket access, unchanged source HTML, static default behavior, and shutdown. The regenerated launcher's 18 existing contracts pass with earlier supported engine versions retained and explicit 2.4.0 WebSocket opt-in.

The review reproduced a missing disconnect cancellation and a completed delegation ID replay; both are now fixed and independently exercised. Delegated success requires the real command-complete event after durable flush. Accepted input and PowerShell input ACKs are never relabeled execution completion.

The native opening cancellation race (closing the Administrator tab while UAC is pending, before the frontend receives its session ID) was reported to the root and native helper owners for a matching frontend/host fix. WebSocket closure already ends its owned native bridge. Actual UAC and native-window validation remain separate interactive gates.

Exact reviewed file hashes and raw evidence copies are in ENGINE_BOUNDARY_REVIEW.json and this directory. Historical blocked/fixture failures are preserved outside the verified evidence list.
