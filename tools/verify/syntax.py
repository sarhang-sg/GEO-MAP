#!/usr/bin/env python3
"""Parse committed source/config formats without repeatedly spawning Node for every JS file."""
from __future__ import annotations

import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP_DIRS = {'.git', '.vercel', 'node_modules', 'dist', '.data-inputs', '.build-cache', '__pycache__'}
failures: list[str] = []
counts = {'json': 0, 'python': 0, 'javascript': 0, 'shell': 0, 'xml': 0}
js_paths: list[Path] = []


def active(path: Path) -> bool:
    return not any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts)


def fail(path: Path | str, error: object) -> None:
    label = path if isinstance(path, str) else path.relative_to(ROOT)
    failures.append(f'{label}: {error}')


for path in sorted(ROOT.rglob('*')):
    if not path.is_file() or not active(path):
        continue
    suffix = path.suffix.lower()
    try:
        if suffix in {'.json', '.geojson', '.webmanifest'}:
            json.loads(path.read_text(encoding='utf-8'))
            counts['json'] += 1
        elif suffix == '.py':
            compile(path.read_text(encoding='utf-8'), str(path), 'exec')
            counts['python'] += 1
        elif suffix in {'.js', '.mjs'}:
            js_paths.append(path)
        elif suffix == '.sh' or path.name == 'TERMUX.sh':
            result = subprocess.run(
                ['bash', '-n', str(path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                timeout=30,
            )
            if result.returncode:
                raise SyntaxError((result.stderr or result.stdout).strip())
            counts['shell'] += 1
        elif suffix in {'.xml', '.plist'}:
            ET.parse(path)
            counts['xml'] += 1
    except Exception as error:
        fail(path, error)

# Parse every JS/MJS file in one Node process.  This avoids dozens of Node
# cold-starts on Android/Termux where storage or CPU throttling can make a
# tiny file hit an artificial per-file timeout.
if js_paths:
    relative_paths = [path.relative_to(ROOT).as_posix() for path in js_paths]
    node_parser = r'''
const fs = require('node:fs');
const vm = require('node:vm');
let files;
try {
  files = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (error) {
  console.error(`syntax-batch-input: ${error.message}`);
  process.exit(2);
}
let failed = false;
for (const file of files) {
  try {
    const source = fs.readFileSync(file, 'utf8');
    new vm.SourceTextModule(source, { identifier: file });
  } catch (error) {
    failed = true;
    console.error(`${file}: ${error && error.stack ? error.stack : error}`);
  }
}
if (failed) process.exit(1);
'''
    try:
        result = subprocess.run(
            ['node', '--experimental-vm-modules', '--no-warnings', '-e', node_parser],
            cwd=ROOT,
            input=json.dumps(relative_paths),
            text=True,
            capture_output=True,
            timeout=120,
        )
        if result.returncode:
            fail('javascript batch', (result.stderr or result.stdout).strip())
        else:
            counts['javascript'] = len(js_paths)
    except subprocess.TimeoutExpired:
        fail('javascript batch', 'Node syntax parser timed out after 120 seconds')
    except Exception as error:
        fail('javascript batch', error)

if failures:
    print('SYNTAX VERIFICATION FAILED')
    for failure in failures:
        print('-', failure)
    raise SystemExit(1)

print('PASS syntax:', ', '.join(f'{kind}={count}' for kind, count in counts.items()))
