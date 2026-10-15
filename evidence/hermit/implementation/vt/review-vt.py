import difflib
import hashlib
import json
from pathlib import Path
import zipfile

work = Path(__file__).resolve().parents[2]
engine = Path(r'D:/Codex/2026-10-13/pl/work/blank-console-arm64/project/JA21-Silicon-Console/applications/silicon')
archive = Path(r'D:/downloads/hermit-ramws_2.0.0-ramws.1(3).zip')
digest = lambda data: hashlib.sha256(data).hexdigest()
bindings = []
with zipfile.ZipFile(archive) as z:
    for name in ['screen.js', 'parser.js', 'renderer-canvas.js']:
        member = 'src/renderer/vt/' + name
        supplied = z.read(member)
        current = (engine / 'src/vendor/vt' / name).read_bytes()
        difference = ''.join(difflib.unified_diff(
            supplied.decode('utf-8').splitlines(True),
            current.decode('utf-8').replace('\r\n', '\n').splitlines(True),
            fromfile='attached/' + member,
            tofile='production/src/vendor/vt/' + name))
        bindings.append({
            'attachedMember': member,
            'attachedSha256': digest(supplied),
            'productionPath': str(engine / 'src/vendor/vt' / name),
            'productionSha256': digest(current),
            'byteEqual': supplied == current,
            'disposition': 'retain existing HERMIT-derived ESM implementation and prior hardening',
            'sourceDifference': difference
        })
    original_accessibility = z.read('client/accessibility.js')
    license_text = z.read('LICENSE').decode('utf-8')

report = {
    'schema': 'JA21-HERMIT-VT-REVIEW-1',
    'sourceArchive': str(archive),
    'sourceArchiveSha256': digest(archive.read_bytes()),
    'runtimeBindings': {
        'screen': 'src/app.js imports Screen from src/vendor/vt/screen.js',
        'parser': 'src/app.js creates one Parser per terminal and passes transport output to Parser.write',
        'renderer': 'src/app.js creates one CanvasRenderer per terminal and renders active tabs',
        'socket': 'socket contract: write, resize, signal, status, close; local RamLink is retained',
        'accessibleMirror': 'new accessibility adapter uses supplied status and transcript elements'
    },
    'vtModules': bindings,
    'newAdapter': {
        'attachedMember': 'client/accessibility.js',
        'attachedSha256': digest(original_accessibility),
        'implementation': str(Path(__file__).parent / 'src/vendor/vt/accessibility.js'),
        'implementationSha256': digest((Path(__file__).parent / 'src/vendor/vt/accessibility.js').read_bytes()),
        'changes': ['ES module export', 'owner-supplied DOM elements', '300-character control-free status', '400-column and 200-row transcript bound', 'concealed cells masked', 'plain text DOM assignment only']
    },
    'preservedHardening': [
        'Saved cursor coordinates are clamped after resizing and pending wrap is saved explicitly.',
        'Full reset clears saved cursor, wrap, scrollback and dirty-row accounting.',
        'Scrollback erase resets its retained cell count.',
        'Changing the scroll region and screen size discards pending autowrap.',
        'Palette and truecolor SGR arguments must be complete integer channels in 0..255.',
        'Unsupported intermediate, private and colon escape forms cannot alias supported operations.',
        'ESC restart, C0 execution and CAN/SUB cancellation are recognized inside escape sequences.',
        'Concealed glyphs and decoration are not rendered under the block cursor.',
        'Scrollback viewport offset is clamped after history is cleared.',
        'Existing font metrics and ESM isolation remain active.',
        'OSC clipboard/hyperlink controls are ignored; titles and control accumulators stay bounded.',
        'Paste is a single editable line and never automatically executes pasted newlines.'
    ],
    'recommendedAppFixes': [
        'Ctrl-key conversion must only convert a single-character key.',
        'Strip C1 control characters from pasted text, consistently with command submission validation.',
        'Use one accessible mirror for the active local or HERMIT remote terminal.',
        'Keep remote titles separate from trusted origin labels.'
    ],
    'validation': {
        'hermitAccessibility': {'tests': 4, 'passed': 4, 'failed': 0, 'skipped': 0},
        'existingTerminalHardening': {'tests': 11, 'passed': 11, 'failed': 0, 'skipped': 0},
        'runtime': 'Node.js 24.21.0 Windows x64',
        'browserUi': 'not executed in this isolated adapter review'
    },
    'license': license_text,
    'productionEdits': 'none; root agent approval and final integration are separate'
}
out = work / 'VT_INTEGRATION_REVIEW.json'
out.write_text(json.dumps(report, ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'report': str(out), 'vtModules': len(bindings), 'adapterTests': 4, 'existingTests': 11}))
