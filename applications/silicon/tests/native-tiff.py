"""Optional native QA: independent Pillow decode of every C# and JavaScript TIFF pixel."""
import json
from pathlib import Path
import sys
import PIL
from PIL import Image

vectors, results = (Path(p).resolve() for p in sys.argv[1:3])
names = json.loads((vectors / 'vectors.json').read_text())
checks = []
for name in names:
    for processor in range(1, 8):
        expected_name = f'{name}-route.bin' if processor == 7 else f'{name}-lane-{processor}.bin'
        expected = [b * 257 for b in (vectors / expected_name).read_bytes()]
        decoded = []
        for file in [results / f'{name}-processor-{processor}.tif', vectors / f'{name}-js-processor-{processor}.tif']:
            with Image.open(file) as im:
                assert im.size == (64, 64) and im.n_frames == 1, str(file)
                assert im.tag_v2[258] in [16, (16,)] and im.tag_v2[259] == 1 and im.tag_v2[262] == 1
                assert im.tag_v2[296] == 1, f'{file}: stored byte planes must be uncalibrated'
                pixels = list(im.get_flattened_data())
                assert pixels == expected, str(file)
                decoded.append(pixels)
        assert decoded[0] == decoded[1]
        checks.append({'file': f'{name}-processor-{processor}.tif', 'status': 'PASS', 'pixels': 4096})
report = {'status': 'PASS', 'decoder': 'Pillow', 'version': PIL.__version__,
          'nativeTiffs': len(checks), 'jsTiffs': len(checks), 'pixelsPerImplementation': len(checks) * 4096,
          'checks': checks}
(results / 'native-tiff-results.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
