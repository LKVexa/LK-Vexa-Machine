"""Verify the mapped software CPU's immutable closure; never claim live execution."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import hashlib
import json
import os

from package_paths import contained_file, manifest_entries

ORIGIN = 'https://ja21-silicon.invalid/'
CPU_VERSION = '2.4.0'
DIST = 'applications/silicon/dist/'
REQUIRED = ('index.html', 'style.css', 'release.json', 'src/app.js', 'src/version.js',
            'src/lib/ram-link.js', 'src/vendor/ram-worker.js',
            'src/vendor/spiral/kernel.js', 'src/vendor/spiral/ssd.js',
            'src/vendor/spiral/volume-format.js')


class EntryDocument(HTMLParser):
    def __init__(self):
        super().__init__()
        self.csp = []
        self.referrers = []
        self.module_sources = []
        self.csp_before_modules = True

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta' and attrs.get('http-equiv', '').lower() == 'content-security-policy':
            self.csp.append(attrs.get('content', ''))
        if tag == 'meta' and attrs.get('name', '').lower() == 'referrer':
            self.referrers.append(attrs.get('content', ''))
        if tag == 'script' and attrs.get('type') == 'module':
            self.module_sources.append(attrs.get('src', ''))
            self.csp_before_modules &= bool(self.csp)


def verify_silicon_bundle(root, require_seal=True):
    """Return actionable errors for missing, exposed, changed or unsealed CPU files."""
    root = Path(root).resolve()
    errors = []
    try:
        dist = contained_file(root, DIST + 'index.html').parent
        for relative in REQUIRED:
            if not contained_file(root, DIST + relative).is_file():
                errors.append('missing mapped CPU component: ' + relative)
        package = json.loads(contained_file(root, 'applications/silicon/package.json').read_text(encoding='utf-8'))
        release = json.loads(contained_file(root, DIST + 'release.json').read_text(encoding='utf-8'))
        version = contained_file(root, 'applications/silicon/VERSION').read_text(encoding='utf-8').strip()
        if version != CPU_VERSION or package.get('version') != version or release.get('version') != version:
            errors.append('software CPU version metadata does not agree on ' + CPU_VERSION)
        if release.get('profile') != 'LOCAL_BROWSER' or release.get('runtimeDependencies') != 0:
            errors.append('mapped CPU is not the dependency-free LOCAL_BROWSER distribution')
        document = EntryDocument()
        document.feed(contained_file(root, DIST + 'index.html').read_text(encoding='utf-8'))
        if len(document.csp) != 1 or not document.csp_before_modules:
            errors.append('entry document needs exactly one CSP meta before its modules')
        else:
            directives = {}
            for part in document.csp[0].split(';'):
                tokens = part.strip().split()
                if not tokens:
                    continue
                if tokens[0] in directives:
                    errors.append('duplicate entry CSP directive: ' + tokens[0])
                directives[tokens[0]] = tokens[1:]
            for key, value in (('default-src', "'none'"), ('script-src', "'self'"),
                               ('worker-src', "'self'"), ('connect-src', "'none'"),
                               ('object-src', "'none'"), ('base-uri', "'none'"),
                               ('form-action', "'none'")):
                if directives.get(key) != [value]:
                    errors.append('entry CSP does not enforce ' + key + ' ' + value)
        if document.referrers != ['no-referrer']:
            errors.append('entry document must suppress referrers')
        if not document.module_sources:
            errors.append('entry document has no production module')
        for source in document.module_sources:
            uri = urlsplit(source)
            if uri.scheme or uri.netloc or uri.query or uri.fragment or not uri.path:
                errors.append('entry module is not a mapped local resource: ' + source)
            elif not contained_file(root, DIST + uri.path.lstrip('/')).is_file():
                errors.append('entry module is absent: ' + source)
        mapped = []
        for directory, dirs, files in os.walk(dist, followlinks=False):
            for name in dirs + files:
                file = Path(directory) / name
                relative = file.relative_to(root).as_posix()
                contained_file(root, relative)  # Reject links/junctions before sealing.
                if file.is_file():
                    if file.suffix.lower() in {'.exe', '.dll', '.cmd', '.bat', '.ps1'}:
                        errors.append('executable host payload exposed by mapping: ' + relative)
                    mapped.append((relative, file))
        if require_seal:
            runtime = json.loads(contained_file(root, 'engine/ja21/runtime.integrity.json').read_text(encoding='utf-8'))
            sealed = {entry['path']: entry for entry, _ in manifest_entries(root, runtime)}
            for relative, file in mapped:
                entry = sealed.get(relative)
                if entry is None:
                    errors.append('mapped CPU resource is not runtime-sealed: ' + relative)
                elif entry['bytes'] != file.stat().st_size or entry['sha256'] != hashlib.sha256(file.read_bytes()).hexdigest():
                    errors.append('mapped CPU resource differs from runtime seal: ' + relative)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        errors.append('software CPU integration could not be validated: ' + str(exc))
    return errors


if __name__ == '__main__':
    errors = verify_silicon_bundle(Path(__file__).resolve().parents[1])
    print(json.dumps({'scope': 'STATIC_MAPPED_CPU_INTEGRITY_ONLY',
                      'status': 'FAIL' if errors else 'PASS',
                      'live_webview2_tested': False, 'errors': errors}, indent=2))
    raise SystemExit(bool(errors))
