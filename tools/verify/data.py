#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, math, re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
PUBLIC=ROOT/'public/data/kri'
release=json.loads((ROOT/'release.config.json').read_text(encoding='utf-8'))
source_data_manifest=json.loads((ROOT/'data-src/source-data-manifest.json').read_text(encoding='utf-8'))
transient_stage_paths={entry['stage'] for entry in source_data_manifest.get('entries',[])}
failures=[]
def check(ok,msg):
    if not ok: failures.append(msg)
def load(path):
    return json.loads(path.read_text(encoding='utf-8'))
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

# Every committed JSON file must be syntactically valid.
json_count=0
for path in ROOT.rglob('*.json'):
    if any(part in {'.git','node_modules','dist','.data-inputs','.build-cache'} for part in path.parts): continue
    try: load(path); json_count+=1
    except Exception as exc: failures.append(f'invalid JSON {path.relative_to(ROOT)}: {exc}')

for config in release['offlineMapFiles']:
    path=ROOT/'public'/config['path']
    check(path.exists(),f'missing offline map {config["path"]}')
    if path.exists():
        check(path.stat().st_size==config['bytes'],f'byte mismatch {config["path"]}')
        check(digest(path)==config['sha256'],f'hash mismatch {config["path"]}')
        head=path.read_bytes()[:8]
        check(head[:7]==b'PMTiles' and head[7]==3,f'invalid PMTiles v3 header {config["path"]}')

geo_files=[p for p in PUBLIC.glob('*.geojson')]
geo_records=0
for path in geo_files:
    data=load(path)
    check(data.get('type')=='FeatureCollection',f'{path.name} is not a FeatureCollection')
    features=data.get('features') or []
    geo_records+=len(features)
    ids=set()
    for index,feature in enumerate(features):
        check(feature.get('type')=='Feature',f'{path.name} feature {index} invalid')
        props=feature.get('properties') or {}
        identifier=str(props.get('id','')).strip()
        if identifier:
            check(identifier not in ids,f'duplicate id {identifier} in {path.name}')
            ids.add(identifier)
        geom=feature.get('geometry')
        if geom and geom.get('type')=='Point':
            coords=geom.get('coordinates') or []
            check(len(coords)>=2 and all(isinstance(v,(int,float)) and math.isfinite(v) for v in coords[:2]),f'invalid point in {path.name}:{identifier or index}')
            if len(coords)>=2:
                check(35.0 <= coords[0] <= 47.5 and 31.0 <= coords[1] <= 39.5,f'point outside supported atlas bounds in {path.name}:{identifier or index}')

search_counts=[]
for language in ('ku','ar','en'):
    path=PUBLIC/f'kri-search-runtime-{language}.json'
    data=load(path)
    check(data.get('schema')=='NAV KURD compact search runtime v1',f'invalid compact search schema {language}')
    check(data.get('version')==release['mapDataVersion'],f'stale search version {language}')
    items=data.get('items') or []
    check(data.get('records')==len(items),f'search record count mismatch {language}')
    check(len(items)>=60000,f'search dataset unexpectedly small {language}')
    search_counts.append(len(items))
check(len(set(search_counts))==1,'multilingual search counts differ')

for path in [PUBLIC/'kri-base-map-manifest.json',PUBLIC/'kri-search-shards-manifest.json',PUBLIC/'kri-viewport-poi-shards-manifest.json']:
    data=load(path)
    version=data.get('map_data_version',data.get('version'))
    check(version==release['mapDataVersion'],f'stale manifest version {path.name}: {version}')

# Localities use one canonical geometry, a small major-place source, and a tiny
# precomputed low-zoom cluster source. This prevents MapLibre from parsing and
# indexing all 12k localities twice on the main/worker message path.
locality_manifest=load(PUBLIC/'kri-localities-language-manifest.json')
major_path=PUBLIC/locality_manifest.get('major_file','')
cluster_path=PUBLIC/locality_manifest.get('cluster_file','')
check(locality_manifest.get('version')==release['mapDataVersion'],'stale locality language manifest version')
check(locality_manifest.get('major_records',0)+locality_manifest.get('minor_records',0)==locality_manifest.get('geometry_records',-1),'locality major/minor partition mismatch')
check(locality_manifest.get('cluster_source_records')==locality_manifest.get('minor_records'),'locality cluster source count mismatch')
check(0 < locality_manifest.get('cluster_records',0) < locality_manifest.get('minor_records',0),'locality cluster runtime was not reduced')
for path,records,sha,size in (
    (major_path,locality_manifest.get('major_records'),locality_manifest.get('major_sha256'),locality_manifest.get('major_bytes')),
    (cluster_path,locality_manifest.get('cluster_records'),locality_manifest.get('cluster_sha256'),locality_manifest.get('cluster_bytes')),
):
    check(path.exists(),f'missing locality runtime {path.name}')
    if path.exists():
        payload=load(path)
        check(len(payload.get('features') or [])==records,f'locality runtime count mismatch {path.name}')
        check(path.stat().st_size==size,f'locality runtime byte mismatch {path.name}')
        check(digest(path)==sha,f'locality runtime hash mismatch {path.name}')


# Published map/icon bytes are enumerated and hash-locked.
integrity_path=PUBLIC/'source-integrity-manifest.json'
integrity=load(integrity_path)
check(integrity.get('schema')=='NAV KURD published data integrity manifest v1','invalid source integrity schema')
check(integrity.get('release')==release['releaseId'],'source integrity release mismatch')
check(integrity.get('appVersion')==release['appVersion'],'source integrity app version mismatch')
check(integrity.get('mapDataVersion')==release['mapDataVersion'],'source integrity map data version mismatch')
manifest_files=integrity.get('files') or {}
actual_files={}
atomic_temp_pattern=re.compile(r'(?:^|/)\.[^/]+\.[A-Za-z0-9]{6}$')
for root in (PUBLIC,ROOT/'public/assets/icons/atlas'):
    for path in root.rglob('*'):
        if not path.is_file() or path==integrity_path or path.suffix.lower() in {'.tmp','.log','.zip','.sha256'}: continue
        relative=path.relative_to(ROOT).as_posix()
        if relative in transient_stage_paths: continue
        if atomic_temp_pattern.search(relative): continue
        actual_files[relative]=path
check(set(manifest_files)==set(actual_files),f'source integrity file set mismatch: manifest={len(manifest_files)} actual={len(actual_files)}')
verified_bytes=0
for relative,path in actual_files.items():
    entry=manifest_files.get(relative) or {}
    size=path.stat().st_size
    verified_bytes+=size
    check(entry.get('bytes')==size,f'source integrity byte mismatch {relative}')
    check(entry.get('sha256')==digest(path),f'source integrity hash mismatch {relative}')
check(integrity.get('fileCount')==len(actual_files),'source integrity file count mismatch')
check(integrity.get('totalBytes')==verified_bytes,'source integrity total byte mismatch')

# Active release metadata must not carry revision-tagged release identifiers.
revision_metadata_pattern=re.compile(r'(?:^|[-_.\s])(?:r|rev|revision)\d+(?:[-_.]\d+)*(?:$|[-_.\s])',re.I)
metadata_keys={
    'release','version','app_version','map_data_version','data_release','source_register_release',
    'language_policy','name_ku_status','schema','generated_for_release'
}
def scan_stale(value,path,key=None):
    if isinstance(value,dict):
        for child_key,item in value.items():
            scan_stale(item,path,str(child_key))
    elif isinstance(value,list):
        for item in value: scan_stale(item,path,key)
    elif isinstance(value,str):
        is_metadata_revision = key in metadata_keys and revision_metadata_pattern.search(value)
        is_project_id_revision = key == 'id' and value.casefold().startswith(('nav-kurd','kri-')) and revision_metadata_pattern.search(value)
        if is_metadata_revision or is_project_id_revision:
            failures.append(f'revision-tagged metadata {key}={value!r} in {path}')
for root in (ROOT/'data-src',PUBLIC):
    for path in root.rglob('*.json'):
        scan_stale(load(path),path.relative_to(ROOT))

for path in (ROOT/'data-src/quarantine/kri-data-quality-quarantine.json',ROOT/'data-src/quarantine/kri-poi-quarantine.json'):
    check(load(path).get('version')==release['mapDataVersion'],f'stale quarantine version {path.name}')
report=load(PUBLIC/'kri-data-quality-report.json')
check(report.get('release')==release['mapDataVersion'],'data quality report release mismatch')
check((report.get('statistics') or {}).get('search_items_published')==search_counts[0],'data quality report search count mismatch')

sprite=load(ROOT/'public/assets/icons/atlas/runtime-sprite/nav-kurd-poi-runtime.json')
check(sprite.get('release')==release['appVersion'],'sprite release mismatch')
for variant in sprite.get('variants',[]):
    path=ROOT/'public/assets/icons/atlas/runtime-sprite'/variant['image']
    check(path.exists(),f'missing sprite {variant["image"]}')
    if path.exists():
        check(path.stat().st_size==variant['bytes'],f'sprite byte mismatch {variant["image"]}')
        check(digest(path)==variant['sha256'],f'sprite hash mismatch {variant["image"]}')

if failures:
    print('DATA VERIFICATION FAILED')
    for failure in failures: print('-',failure)
    raise SystemExit(1)
print(json.dumps({'status':'pass','json_files':json_count,'geojson_files':len(geo_files),'geojson_records':geo_records,'search_records_per_language':search_counts[0],'integrity_files':len(actual_files),'integrity_bytes':verified_bytes},ensure_ascii=False))
