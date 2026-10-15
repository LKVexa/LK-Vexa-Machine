# Current project license and inherited provenance

LK/Vexa Machine
Copyright (C) 2026 RUSSELL PHILIP SMITHSON
SPDX-License-Identifier: GPL-3.0-only

The copyright holder's original JA21 CPU/XPU, terminal, virtual transport,
HPU and project-authored integration material are currently licensed under
GPL-3.0-only. The repository-root COPYRIGHT and NOTICE record the current
grant, which supersedes earlier UNLICENSED, reserved-rights and
no-public-distribution declarations for that owned material. The active
package.json now records GPL-3.0-only. Its private:true flag prevents
accidental npm publication; it is not a restriction on the GPL grant.

The grant does not replace the individual terms of independently authored
research papers, SDKs, nested projects or other unrelated third-party works.
RUSSL's original notices and scoped GPL grants remain applicable. See the
repository-root LICENSE and LICENSING.md for the complete license and map.

The inherited text below is retained as a historical pre-publication
record. Its UNLICENSED/no-blanket-grant statements describe that earlier
state and are superseded for the copyright holder's own material by the
current grant. Its component attributions and third-party qualifications
remain applicable. The exact previous files are also retained at
provenance/pre-publication/applications/silicon/THIRD_PARTY_NOTICES.md and
provenance/pre-publication/applications/silicon/package.json.

---

# Provenance and notices

Source input: `3CfF2osTJPreoEbM-grok-workspace.zip`.
SHA-256: `230427a64dfeccc1b83b90cd263ec360fc2cf30cb494f718aebe96bf70b6f2e4`.

The active source derives from the supplied SPIRAL, VT, virtual transport, and HPU implementation plus this local hardening/refactor work. Input filenames and SHA-256 values are recorded in `audit/INPUT_MANIFEST.json`; deeper ZIP/JAR membership and parsing are recorded in `audit/RECURSIVE_PARSE_INVENTORY.json`. Unmodified original vendor files are in `audit/original-runtime.zip`; other original scaffold files are in `audit/legacy-scaffold.zip`. The original `attachments/` files are copied unchanged to `references/`.

Existing notices and licenses inside those references remain applicable to their respective material. No blanket relicensing of research papers, SDK binaries, or nested projects is asserted. The root npm metadata uses `UNLICENSED` because an applicable blanket distribution license was not established from the original root. This metadata does not erase individual third-party notices or grant public redistribution rights.

Node.js and the browser are not included binaries. Windows setup retrieves the official pinned Node.js archive separately and preserves its upstream LICENSE and README beside node.exe; npm and its package tree are not extracted or installed. The Node.js archive/executable hashes and upstream source are recorded in scripts/windows/runtime-lock.json. Linux/macOS users still supply a supported system runtime. The active application does not require React, Vite, a cloud database, external fonts, or npm-installed packages. Python/Pillow/Playwright/TypeScript were audit tools; they are not shipped as runtime dependencies. Their version information, where used, appears in the evidence files.


## RUSSL corpus integration — 2.2.0

Input: RUSSL-Zarr-main.zip, SHA-256
`4adec0988b7e9de5e82d6c43d910112341373d18207545f4df2be431cbb66eb1`.
The supplied corpus declares its original code/specification material under
GPL-3.0-only, copyright 2026 LKVexa and contributors. Exact LICENSE, NOTICE and
COPYRIGHT files are retained in corpus/russl-2.0.0/. The original complete ZIP is
preserved byte-for-byte in references/RUSSL-Zarr-main.zip. Papers and other
third-party material inside it retain their own notices and rights.

New scoped adapter sources marked SPDX-License-Identifier: GPL-3.0-only include
russl-field.js, tiff-codec.js, russl-service.js, commands/russl.js,
scripts/make-tiff-examples.mjs, tests/russl.test.mjs and tests/russl_interop.py.
The complete corresponding source is present. Their notices do not erase the
original project's unresolved blanket licensing. The root package's UNLICENSED
marker is retained, not presented as a relicense of the corpus or a grant of
public redistribution rights for the combined work. Resolve rights for the
original baseline and bundled third-party material before public distribution.

Independent audit tools include NumPy, tifffile, Pillow and Playwright/Chromium.
No binaries of these tools or npm packages were added to the application. Fixtures
record their writer/version/provenance; they are interoperability test data, not
claims that those tools conform to every accepted/rejected profile.
