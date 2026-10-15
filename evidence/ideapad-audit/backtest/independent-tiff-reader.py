"""Validate every exported pixel through Pillow, independent of JA21's codec."""
import hashlib, json, pathlib, platform, struct
from PIL import Image, __version__ as pillow_version

HERE = pathlib.Path(__file__).parent
TIFFS = HERE / 'tiffs'
items = json.loads((TIFFS / 'manifest.json').read_text(encoding='utf-8'))
result = {'profile': 'JA21-IDEAPAD-INDEPENDENT-TIFF-READER/1', 'status': 'RUNNING', 'reader': f'Pillow {pillow_version}', 'python': platform.python_version(), 'files': [], 'pixelComparisons': 0}
for item in items:
    source = (TIFFS / item['filename']).read_bytes()
    expected_bytes = (TIFFS / item['expectedFile']).read_bytes()
    assert hashlib.sha256(source).hexdigest() == item['sha256']
    assert hashlib.sha256(expected_bytes).hexdigest() == item['expectedSHA256']
    expected = list(struct.unpack('<4096H', expected_bytes))
    with Image.open(TIFFS / item['filename']) as image:
        image.load()
        assert image.size == (64, 64)
        assert image.mode in ('I;16', 'I;16L', 'I')
        actual = list(image.get_flattened_data())
        assert actual == expected, item['filename']
    result['pixelComparisons'] += 4096
    result['files'].append({'file': item['filename'], 'pixels': 4096, 'status': 'PASS', 'sha256': item['sha256']})
result['status'] = 'PASS'
result['fileCount'] = len(items)
result['runnerSHA256'] = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
(HERE / 'INDEPENDENT_TIFF_RESULTS.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k: result[k] for k in ('status', 'reader', 'fileCount', 'pixelComparisons')}))
