import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from silicon_package import DIST, REQUIRED, verify_silicon_bundle


class SiliconIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ja21-cpu-integration-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in REQUIRED:
            file = self.root / (DIST + name)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('// integration fixture\n', encoding='utf-8')
        csp = "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
        self.index = self.root / (DIST + 'index.html')
        self.index.write_text('<head><meta http-equiv="Content-Security-Policy" content="' + csp + '"><meta name="referrer" content="no-referrer"><script type="module" src="/src/app.js"></script></head>', encoding='utf-8')
        (self.root / 'applications/silicon/package.json').write_text('{"version":"2.2.2"}', encoding='utf-8')
        (self.root / 'applications/silicon/VERSION').write_text('2.2.2\n', encoding='utf-8')
        (self.root / (DIST + 'release.json')).write_text('{"version":"2.2.2","profile":"LOCAL_BROWSER","runtimeDependencies":0}', encoding='utf-8')

    def seal(self):
        entries = [{'path': file.relative_to(self.root).as_posix(), 'bytes': file.stat().st_size,
                    'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
                   for file in (self.root / DIST).rglob('*') if file.is_file()]
        seal = self.root / 'engine/ja21/runtime.integrity.json'
        seal.parent.mkdir(parents=True, exist_ok=True)
        seal.write_text(json.dumps({'files': entries}), encoding='utf-8')
        return seal

    def test_real_bundle_static_closure(self):
        # Runtime coverage is checked by the release gate after the root agent reseals.
        self.assertEqual(verify_silicon_bundle(ROOT, require_seal=False), [])

    def test_every_mapped_resource_requires_a_current_runtime_seal(self):
        self.seal()
        self.assertEqual(verify_silicon_bundle(self.root), [])
        extra = self.root / (DIST + 'src/extra-worker.js')
        extra.write_text('export default 1;', encoding='utf-8')
        self.assertTrue(any('not runtime-sealed' in error for error in verify_silicon_bundle(self.root)))
        self.seal()
        extra.write_text('export default 2;', encoding='utf-8')
        self.assertTrue(any('differs from runtime seal' in error for error in verify_silicon_bundle(self.root)))

    def test_missing_worker_and_host_executable_are_rejected(self):
        (self.root / (DIST + 'src/vendor/ram-worker.js')).unlink()
        (self.root / (DIST + 'host.exe')).write_bytes(b'MZ')
        errors = verify_silicon_bundle(self.root, require_seal=False)
        self.assertTrue(any('missing mapped CPU component' in error for error in errors))
        self.assertTrue(any('executable host payload exposed' in error for error in errors))

    def test_external_module_and_relaxed_worker_policy_are_rejected(self):
        self.index.write_text(self.index.read_text(encoding='utf-8').replace("worker-src 'self'", "worker-src *").replace('/src/app.js', 'https://example.com/app.js'), encoding='utf-8')
        errors = verify_silicon_bundle(self.root, require_seal=False)
        self.assertTrue(any('worker-src' in error for error in errors))
        self.assertTrue(any('not a mapped local resource' in error for error in errors))


if __name__ == '__main__':
    unittest.main()
