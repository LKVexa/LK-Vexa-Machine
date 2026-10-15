# Evidence lineage

The current TIFF/pixel release is 2.2.0. Its current result files are VERIFICATION.json,
TEST_RESULTS.tap, RELEASE_CHECKS.json, BROWSER_OFFLINE_RESULTS.json,
CODEC_RESULTS.json, RUSSL_INTEROP_RESULTS.json, RUSSL_CORPUS_INTAKE.json,
NATIVE_BROWSER_PROBE.json and TIFF_UPDATE_SUMMARY.json. RUSSL-prefixed screenshots
are labeled in-memory UI fixtures.

baseline-2.1.0/ and baseline-2.1.1/ retain earlier audit/test reports. Historical
INPUT_MANIFEST.json, RECURSIVE_PARSE_INVENTORY.json, PDF_REFERENCE_PARSE.json,
SOURCE_PARSE.json, FINDINGS.json, RUNTIME_CHANGES.json, RUNTIME_PATCH.diff,
PROVENANCE_CHECK.json, STARTUP_REPAIR_SUMMARY.json and STARTUP_REPAIR_CHANGES.json
refer to the preceding full audit/startup patch, not new 2.2.0 verification.
Reference research archives/native toolchains were preserved, not re-executed.
The current source diff is TIFF_UPDATE_PATCH.diff with TIFF_UPDATE_CHANGES.json.

The environment blocks normal local HTTP browser navigation with
ERR_BLOCKED_BY_ADMINISTRATOR. Offline UI tests exercise the real app/model with
an explicit in-memory link adapter. Real Node worker tests separately exercise
RPCs with explicit storage/lock doubles. Neither substitutes for native browser
IndexedDB/Web Locks/CSP acceptance or actual Windows cmd/PowerShell execution.
