"""Independent third-party TIFF decoding; only reads isolated generated fixtures."""
from pathlib import Path
from PIL import Image, TiffImagePlugin
from io import BytesIO
import hashlib
import json
import struct
from datetime import datetime, timezone

here = Path(__file__).resolve().parent
fixture_root = here / 'codec-artifacts'
expected = (fixture_root / 'canonical-bytes.bin').read_bytes()
assert len(expected) == 4096 * 20
result = {'profile': 'SEMISILI-PIXEL160-PILLOW-ACCEPTANCE/1', 'status': 'RUNNING', 'files': [], 'decoderLimitations': []}
for path in sorted(fixture_root.glob('*.tiff')):
    file_bytes = path.read_bytes()
    method = 'Pillow Image.open'
    try:
        with Image.open(path) as image:
            assert image.format == 'TIFF'
            assert image.mode == 'L'
            assert image.size == (20, 4096)
            assert image.n_frames == 1
            pixels = image.tobytes()
            meta = json.loads(image.tag_v2[270])
    except Image.UnidentifiedImageError as error:
        # Pillow's own parser tests ifh[2] == 43 for both endiannesses. For MM
        # the magic occupies bytes 2..3 as 00 2B. Preserve the normal-open
        # failure, then exercise its independent IFD loader with the true flag.
        assert path.name.endswith('MM-big.tiff')
        assert file_bytes[:8] == b'MM\x00\x2b\x00\x08\x00\x00'
        ifd_offset, = struct.unpack_from('>Q', file_bytes, 8)
        ifd = TiffImagePlugin.ImageFileDirectory_v2(prefix=b'MM')
        ifd._bigtiff = True
        stream = BytesIO(file_bytes); stream.seek(ifd_offset); ifd.load(stream)
        assert ifd[256] == 20 and ifd[257] == 4096 and ifd[258] == (8,)
        assert ifd[259] == 1 and ifd[262] == 1 and ifd[277] == 1
        offsets, counts = ifd[273], ifd[279]
        assert len(offsets) == len(counts) == 1
        pixels = file_bytes[offsets[0]:offsets[0]+counts[0]]
        meta = json.loads(ifd[270])
        method = 'Pillow independent IFD parser with endian-aware BigTIFF flag; raw uncompressed byte raster'
        result['decoderLimitations'].append({'name': path.name, 'normalImageOpen': 'FAILED', 'reason': str(error), 'localParserFinding': 'TiffImagePlugin.py ImageFileDirectory_v2.__init__ and TiffImageFile._open use ifh[2] == 43 rather than endian-aware uint16 magic.'})
    assert pixels == expected
    assert meta['schema'] == 'JA21-PIXEL160-TIFF/1.0'
    assert meta['axes'] == ['D4', 'D5', 'D6', 'D7', 'D8']
    assert meta['shape'] == [4, 4, 4, 8, 8]
    assert meta['byteOrder'] == 'BE32'
    assert meta['config'] == {'precision': 8, 'prime': 2}
    rows = list(struct.iter_unpack('>5I', pixels))
    assert len(rows) == 4096
    result['files'].append({'name': path.name, 'sha256': hashlib.sha256(file_bytes).hexdigest(), 'decodedSamples': len(pixels), 'decodedLogicalCells': len(rows), 'method': method, 'size': [20, 4096]})
assert len(result['files']) == 8
result['status'] = 'PASS_WITH_DECODER_LIMITATION' if result['decoderLimitations'] else 'PASS'
result['decodedSamples'] = sum(f['decodedSamples'] for f in result['files'])
result['decoder'] = 'Pillow ' + Image.__version__
result['finishedUTC'] = datetime.now(timezone.utc).isoformat()
result['fixtureCanonicalSHA256'] = hashlib.sha256(expected).hexdigest()
result['testSHA256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
(here / 'PILLOW_TIFF_RESULTS.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result))
