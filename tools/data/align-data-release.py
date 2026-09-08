#!/usr/bin/env python3
"""Align active canonical/runtime data to release.config without re-normalizing names or geometry."""
from __future__ import annotations
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PUBLIC=ROOT/'public/data/kri'
SRC=ROOT/'data-src'
release=json.loads((ROOT/'release.config.json').read_text(encoding='utf-8'))
VERSION=release['mapDataVersion']; DATE=release['hardeningDate']; POLICY='verified-kurdish-or-source-original'
ACTIVE_POLICY_PREFIX = "verified-kurdish-or-source-original"

def normalize_active_policy(value):
    if isinstance(value, str):
        return POLICY if value.startswith(ACTIVE_POLICY_PREFIX) else value
    if isinstance(value, list):
        return [normalize_active_policy(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_active_policy(item) for key, item in value.items()}
    return value

def source_path(public_name:str, source_relative:str)->Path:
    staged=PUBLIC/public_name
    return staged if staged.exists() else SRC/source_relative

def write(path:Path,payload):
    path.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')

def align_geo(path:Path, per_feature=True):
    payload=normalize_active_policy(json.loads(path.read_text(encoding='utf-8')))
    payload['version']=VERSION
    if isinstance(payload.get('metadata'),dict):
        payload['metadata']['version']=VERSION; payload['metadata']['last_reviewed']=DATE
        if 'language_policy' in payload['metadata']: payload['metadata']['language_policy']=POLICY
    if per_feature:
        for feature in payload.get('features',[]):
            props=feature.get('properties') or {}
            props['data_release']=VERSION
            if 'last_reviewed' in props: props['last_reviewed']=DATE
            if 'language_policy' in props: props['language_policy']=POLICY
    write(path,payload)

def align_search(path:Path):
    payload=normalize_active_policy(json.loads(path.read_text(encoding='utf-8'))); payload['version']=VERSION
    if 'language_policy' in payload: payload['language_policy']=POLICY
    for item in payload.get('items',[]):
        item['data_release']=VERSION
        if 'language_policy' in item: item['language_policy']=POLICY
    write(path,payload)

align_geo(source_path('kri-pois.geojson','canonical/kri-pois.geojson'))
align_geo(source_path('kri-localities.geojson','canonical/kri-localities.geojson'))
align_search(source_path('kri-search-index.json','generated/search/kri-search-index.json'))
for name in ('kri-natural-features.geojson','kri-security-features.geojson','kri-road-labels.geojson','kri-boundary.geojson','kri-boundary-line.geojson','kri-outside-mask.geojson','kri-governorates.geojson','kri-districts.geojson','kri-labels.geojson','kri-reviewed-poi-corrections.geojson'):
    path=PUBLIC/name
    if path.exists(): align_geo(path)
metadata_files = [
    PUBLIC/'kri-data-quality-report.json',
    PUBLIC/'kirkuk-verified-name-corrections.json',
    PUBLIC/'kri-data-provenance.json',
    source_path('kri-data-quality-quarantine.json','quarantine/kri-data-quality-quarantine.json'),
    source_path('kri-poi-quarantine.json','quarantine/kri-poi-quarantine.json'),
    SRC/'quarantine/kri-dedupe-ledger.json',
]
for path in metadata_files:
    if not path.exists():
        continue
    payload=normalize_active_policy(json.loads(path.read_text(encoding='utf-8')))
    if path.name in {'kri-data-quality-quarantine.json','kri-poi-quarantine.json'}:
        payload['version']=VERSION
    if path.name=='kri-data-quality-report.json':
        from collections import Counter

        payload['release']=VERSION
        payload['generated_at']=DATE
        payload['policy']=POLICY
        payload['statistics']={'search_items_published': len(json.loads(source_path('kri-search-index.json','generated/search/kri-search-index.json').read_text(encoding='utf-8')).get('items', []))}

        def summarize_geo(dataset_path: Path):
            dataset=json.loads(dataset_path.read_text(encoding='utf-8'))
            statuses=Counter()
            missing=Counter()
            kirkuk=0
            for feature in dataset.get('features', []):
                props=feature.get('properties') or {}
                governorate=' | '.join(str(props.get(key, '')) for key in ('admin_governorate_ku','admin_governorate_ar','admin_governorate_en')).casefold()
                if any(token in governorate for token in ('کەرکووک','كركوك','kirkuk')):
                    kirkuk += 1
                status=str(props.get('name_ku_status','')).strip()
                if status:
                    statuses[status] += 1
                for language in ('ku','ar','en'):
                    if not str(props.get(f'name_{language}','')).strip():
                        missing[language] += 1
            return {
                'features': len(dataset.get('features', [])),
                'kirkuk_features': kirkuk,
                'missing_names': dict(sorted(missing.items())),
                'kurdish_name_status': dict(sorted(statuses.items())),
            }

        datasets={
            'kri-localities.geojson': source_path('kri-localities.geojson','canonical/kri-localities.geojson'),
            'kri-pois.geojson': source_path('kri-pois.geojson','canonical/kri-pois.geojson'),
            'kri-natural-features.geojson': PUBLIC/'kri-natural-features.geojson',
            'kri-security-features.geojson': PUBLIC/'kri-security-features.geojson',
        }
        payload['quality']={name:summarize_geo(dataset_path) for name,dataset_path in datasets.items() if dataset_path.exists()}
    if path.name=='kirkuk-verified-name-corrections.json':
        payload['release']=VERSION; payload['source_register_release']=VERSION; payload['last_reviewed']=DATE
    write(path,payload)
print(json.dumps({'status':'aligned','version':VERSION,'canonical':['pois','localities','search'],'date':DATE},ensure_ascii=False))
