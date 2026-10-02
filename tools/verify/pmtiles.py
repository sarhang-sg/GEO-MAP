#!/usr/bin/env python3
"""Verify PMTiles v3 archives and deterministic source-data archives."""
from __future__ import annotations
import gzip, hashlib, json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
def load(path): return json.loads((ROOT/path).read_text(encoding='utf-8'))
def digest_bytes(body): return hashlib.sha256(body).hexdigest()
def digest(path):
    h=hashlib.sha256()
    with (ROOT/path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

release=load(Path('release.config.json'))
for item in release['offlineMapFiles']:
    relative=Path('public')/item['path']
    path=ROOT/relative
    if not path.is_file(): raise SystemExit(f'Missing PMTiles file: {relative}')
    if path.stat().st_size!=item['bytes']: raise SystemExit(f'PMTiles byte mismatch: {relative}')
    if digest(relative)!=item['sha256']: raise SystemExit(f'PMTiles SHA-256 mismatch: {relative}')
    header=path.read_bytes()[:8]
    if header[:7]!=b'PMTiles' or header[7]!=3: raise SystemExit(f'Invalid PMTiles v3 header: {relative}')

source=load(Path('data-src/source-data-manifest.json'))
for entry in source.get('entries',[]):
    stored=(ROOT/entry['source']).read_bytes()
    if entry.get('compression')=='gzip':
        if len(stored)!=entry.get('archive_bytes') or digest_bytes(stored)!=entry.get('archive_sha256'):
            raise SystemExit(f'Compressed source mismatch: {entry["source"]}')
        body=gzip.decompress(stored)
    else: body=stored
    if len(body)!=entry['bytes'] or digest_bytes(body)!=entry['sha256']:
        raise SystemExit(f'Source data mismatch: {entry["source"]}')

print(f"PASS PMTiles/source integrity: {len(release['offlineMapFiles'])} PMTiles v3 archives and {len(source.get('entries',[]))} deterministic source entries.")
