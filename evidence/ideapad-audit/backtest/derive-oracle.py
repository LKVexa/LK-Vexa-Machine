"""Read-only baseline interpretation; never execute attached documents/code."""
import hashlib, json, pathlib, re, zipfile

HERE = pathlib.Path(__file__).parent
SOURCE = pathlib.Path(r'C:\Users\russe\AppData\Local\Temp\codex-file-preview-IgIdXQ\JA21_Silicon_Console_2.2.0_RUSSL_TIFF.zip')
with zipfile.ZipFile(SOURCE) as archive:
    candidates = [n for n in archive.namelist() if n.endswith('/src/vendor/spiral/byte-tables.js') and '/dist/' not in n]
    assert len(candidates) == 1
    member = candidates[0]
    data = archive.read(member)
arrays = re.findall(r'new Uint8Array\(\[([^\]]+)\]\)', data.decode('utf-8'))
tables = [[int(x) for x in a.split(',')] for a in arrays]
assert len(tables) == 6 and all(len(t) == 256 for t in tables)

def coefficients(table, bit):
    # Boolean algebraic normal form using a finite-field Mobius transform.
    coeffs = [(v >> bit) & 1 for v in table]
    for axis in range(8):
        for mask in range(256):
            if mask & (1 << axis):
                coeffs[mask] ^= coeffs[mask ^ (1 << axis)]
    return [mask for mask, value in enumerate(coeffs) if value]

oracle = {
    'profile': 'JA21-INDEPENDENT-BOOLEAN-REGRESSION-ORACLE/1',
    'sourceZipSHA256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'sourceMember': member,
    'sourceMemberSHA256': hashlib.sha256(data).hexdigest(),
    'method': 'Interpret original 2.2.0 truth tables as eight Boolean polynomials per lane over GF(2). Evaluate polynomial monomials in the runner instead of indexing current production tables.',
    'limitation': 'Polynomial equivalence establishes regression against the uploaded baseline, not an independent scientific specification or usefulness of the first lookup map.',
    'polynomials': [[coefficients(table, bit) for bit in range(8)] for table in tables],
    'distinctTransformations': len({tuple(t) for t in tables}),
}
(HERE / 'oracle.json').write_text(json.dumps(oracle, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'status': 'PASS', 'distinctTransformations': oracle['distinctTransformations'], 'monomialsPerLane': [sum(map(len, lane)) for lane in oracle['polynomials']]}))
