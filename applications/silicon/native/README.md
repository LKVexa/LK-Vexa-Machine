# C# reference boundary

`src/vendor/spiral/ChipHarness.cs` is retained as inspectable reference source. Its exact text is also in `chip-harness.js` for explicit virtual-file export by `hpu bytes`; tests compare its LUTs against the JavaScript tables. The browser does not compile or call C#, and the launchers do not invoke .NET.

`Cpu` performs a scalar loop. `Gpu` performs a nested 32-wide batched CPU loop; its historical method name is retained, not a hardware claim. `Wrap` builds seven data TIFFs from a 4096-byte sample. TIFF payloads are not code execution containers. Byte planes and route IDs are uncalibrated data. Result getters return defensive copies, sampling publishes a complete verified snapshot, and concurrent `Wrap` calls retain their own seven outputs.

The 2.2.2 validation compiled and ran the distributed C# source with a task-local Microsoft .NET SDK 8.0.426, .NET runtime 8.0.32, Windows x64. Five complete sample vectors include all 256 possible input bytes. The driver checks all six scalar, batched and sampled lanes, the seventh selector and chosen outputs, invalid inputs, result mutation, deterministic exports, and 128 concurrent wraps. Pillow independently verifies all pixels of 35 C# TIFFs and the corresponding 35 JavaScript TIFFs. Exact results and SDK provenance are in `audit/NATIVE_CSHARP_RESULTS_2.2.2.json`, `audit/NATIVE_CSHARP_TIFF_RESULTS_2.2.2.json` and `audit/NATIVE_CSHARP_SDK_2.2.2.json`.

To reproduce with .NET SDK 8 or a later SDK capable of targeting net8.0, Node and Python with Pillow:

```powershell
pwsh -NoProfile -File native/Validate.ps1 -Dotnet 'C:\path\to\dotnet.exe' -Node 'C:\path\to\node.exe' -Python 'C:\path\to\python.exe'
```

The project uses no NuGet packages. Its package sources are cleared; build/cache/output paths stay in `.local/native-validation` by default. Pass `-WorkDirectory` for another working folder. `results/VALIDATION.json` records the aggregate RUNNING, PASS or FAIL status and current source checksum. Each run invalidates the runner's two previous result reports before starting, so a failed rerun cannot retain an old overall success. The script disables SDK telemetry, development-certificate generation and global-tool PATH registration. The SDK is not bundled in the release and is not required to launch the browser console. This native result certifies execution on Windows x64, not ARM64 hardware or physical silicon.

Original, unmodified vendor source is preserved in `audit/original-runtime.zip`. Native DLLs/desktop launchers in nested references remain inert and are not installed or covered by the active local edition's runtime tests.
