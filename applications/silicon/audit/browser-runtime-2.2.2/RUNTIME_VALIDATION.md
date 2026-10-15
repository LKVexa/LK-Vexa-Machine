# Browser QA runtime validation

Task-local runtimes only. No runtime belongs in the JA21 release.

## Provenance

Official metadata source: https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json

Stable Chrome for Testing headless shell: 155.0.8059.79, Windows x64.
Download: https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.79/win64/chrome-headless-shell-win64.zip
SHA-256: `C4CC49FA7908CF018600B04C95918D336565D90F9C72241FD83DACD9EC41855C`
Archive MD5: `Q5lgmW/RmpLk8JYRfdzANw==`, exactly matching the official Google Storage response `x-goog-hash` header.

Bundled Playwright's declared Chrome headless shell version: 151.0.7922.34.
Matching metadata: https://googlechromelabs.github.io/chrome-for-testing/151.0.7922.34.json
Download: https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.34/win64/chrome-headless-shell-win64.zip
SHA-256: `46CC69EF55BA29268FFE32DDA4192A9D2165BE42C3F4E923241153D519493AEA`
Archive MD5: `/BiaqS/vFlhkgTISwTFIhw==`, exactly matching the official Google Storage response `x-goog-hash` header.

The official metadata exposes version/download URLs without archive digests. The archive MD5 comparison checks the actual download against Google's served object header; SHA-256 is locally recorded, not an independently published vendor digest. The stable headless executable is not Authenticode signed.

## Execution results

Windows 11 Home, sandboxed Codex task execution.

Both versions were attempted with fresh `D:\Codex\2026-10-13\pl\work\browser-runtime\smoke-profile-*` profiles, bundled Playwright, `headless: true`, `chromiumSandbox: true`, a 20 second timeout, and no security policy or sandbox changes. Both launches timed out before protocol initialization, with no browser stderr. They did not open the test page.

Both versions were also attempted directly with fresh `direct-profile-*` profiles, default Chromium sandbox, `--headless --dump-dom --timeout=8000 --enable-logging=stderr` and an inert data URL. Both exited immediately with code `2147483651` (`0x80000003`, breakpoint) and empty stdout/stderr.

Result: no viable browser runtime obtained in this execution environment. The matching-version attempt rules out the observed failure being solely a Playwright/browser version mismatch. This is launch failure evidence and does not validate application browser persistence.

Evidence files: `provenance.json`, `matched-provenance.json`, `official-metadata.json`, `official-matched-metadata.json`, `smoke-result.json`, `matched-smoke-result.json`, `direct-smoke-result.json`, `matched-direct-smoke-result.json`.

Chromium's primary Windows sandbox design documents restricted tokens, distinct job objects, alternate desktops and integrity levels: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/design/sandbox.md . That is context for possible host restrictions, not evidence identifying the precise cause of these early exits. No `--no-sandbox`, global install, user browser profile, policy changes, firewall changes, or unmanaged remote-browser control was used.
