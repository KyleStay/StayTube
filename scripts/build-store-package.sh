#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir="$project_dir/dist"

cd "$project_dir"
node --test tests/*.test.js >&2
for source in src/*.js; do
  node --check "$source"
done

python3 - "$project_dir" "$output_dir" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

root, output = map(Path, sys.argv[1:])
manifest = json.loads((root / 'manifest.json').read_text())
version = manifest['version']
if not re.fullmatch(r'\d+(?:\.\d+){0,3}', version):
    raise SystemExit('Invalid extension version')
files = {'manifest.json', *manifest['icons'].values()}
for content_script in manifest['content_scripts']:
    files.update(content_script.get('js', []))
    files.update(content_script.get('css', []))
for name in files:
    candidate = (root / name).resolve()
    if not candidate.is_relative_to(root.resolve()) or not candidate.is_file():
        raise SystemExit(f'Missing or unsafe package path: {name}')
output.mkdir(parents=True, exist_ok=True)
package = output / f'staytube-{version}-chrome-web-store.zip'
with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(root / name, name)
with zipfile.ZipFile(package) as archive:
    if archive.testzip() is not None or set(archive.namelist()) != files:
        raise SystemExit('Package verification failed')
digest = hashlib.sha256(package.read_bytes()).hexdigest()
package.with_suffix('.zip.sha256').write_text(f'{digest}  {package.name}\n')
print(package)
PY
