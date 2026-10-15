import zipfile
from pathlib import Path
root = Path(__file__).resolve().parent / 'implementation/server'
(root / 'gateway').mkdir(parents=True, exist_ok=True)
(root / 'protocol').mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile('D:/downloads/hermit-ramws_2.0.0-ramws.1(3).zip') as z:
    ws = z.read('gateway/ws.js').decode()
    old = "const r = Buffer.from(String(reason).slice(0, 100), 'utf8');"
    new = """if (!validCloseCode(code)) throw new RangeError('invalid outgoing close code');
      let bounded = ''; let used = 0;
      for (const scalar of String(reason)) { const size = Buffer.byteLength(scalar, 'utf8'); if (used + size > 123) break; bounded += scalar; used += size; }
      const r = Buffer.from(bounded, 'utf8');"""
    assert ws.count(old) == 1
    ws = ws.replace(old, new)
    (root / 'gateway/ws.cjs').write_text(ws, encoding='utf8')
    for name in ['codec.cjs', 'envelope.schema.json', 'protocol-meta.json']:
        (root / 'protocol' / name).write_bytes(z.read('protocol/' + name.replace('.cjs', '.js')))
    (root / 'HERMIT_LICENSE.txt').write_bytes(z.read('LICENSE'))
print('broker base components copied')
