#!/usr/bin/env python3
"""Derive road points from attributed records; never infer an unmapped location."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ['public/data/kri/kri-security-features.geojson', 'public/data/kri/kri-pois-render.geojson']
KINDS = {'military_checkpoint': 'checkpoint', 'police_checkpoint': 'checkpoint', **{k: k for k in
    ['checkpoint', 'border_crossing', 'speed_camera', 'surveillance_camera', 'speed_bump', 'pedestrian_crossing', 'traffic_signal', 'railway_crossing']}}

def osm_kind(tags):
    if tags.get('traffic_calming') in ('bump', 'hump', 'table', 'cushion', 'rumble_strip'): return 'speed_bump'
    if tags.get('highway') == 'speed_camera': return 'speed_camera'
    if tags.get('barrier') == 'border_control': return 'border_crossing'
    if tags.get('military') == 'checkpoint' or tags.get('checkpoint') in ('police', 'yes') or tags.get('barrier') == 'checkpoint': return 'checkpoint'
    if tags.get('man_made') == 'surveillance' and tags.get('surveillance') == 'public': return 'surveillance_camera'
    if tags.get('railway') == 'level_crossing': return 'railway_crossing'
    if tags.get('highway') == 'crossing': return 'pedestrian_crossing'
    if tags.get('highway') == 'traffic_signals': return 'traffic_signal'
    return None

def in_ring(point, ring):
    x, y = point; inside = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0]) * (y-a[1]) / (b[1]-a[1]) + a[0]: inside = not inside
    return inside

def in_coverage(point, boundary):
    for feature in boundary['features']:
        geometry = feature['geometry']
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        for rings in polygons:
            if in_ring(point, rings[0]) and not any(in_ring(point, hole) for hole in rings[1:]): return True
    return False

def build(osm_file=None):
    records = {}; hashes = {}
    def add(identity, kind, coordinate, props, source_id):
        if not kind or len(coordinate) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in coordinate): return
        if not (42 <= coordinate[0] <= 47 and 34 <= coordinate[1] <= 38): return
        key = (identity, kind)
        if key in records:
            if source_id not in records[key]['properties']['source_ids']: records[key]['properties']['source_ids'].append(source_id)
            return
        osm_type, osm_id = identity.split('-')
        properties = {'id': f'road-{identity}-{kind}', 'road_hazard': kind, 'category': kind, 'source_ids': [source_id],
            'source': 'OpenStreetMap', 'source_url': f'https://www.openstreetmap.org/{osm_type}/{osm_id}',
            'source_date': props.get('source_date', ''), 'data_release': props.get('data_release', '')}
        for name in ('name', 'name_ku', 'name_ar', 'name_en'):
            if props.get(name): properties[name] = props[name]
        records[key] = {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': coordinate}, 'properties': properties}
    for name in SOURCES:
        raw = (ROOT / name).read_bytes(); hashes[name] = hashlib.sha256(raw).hexdigest()
        for feature in json.loads(raw)['features']:
            props = feature['properties']; kind = KINDS.get(props.get('category')); source_id = str(props.get('id', ''))
            identity = re.match(r'osm-(?:security-)?(node|way|relation)-(\d+)', source_id)
            if kind and identity and feature['geometry']['type'] == 'Point':
                add('-'.join(identity.groups()), kind, feature['geometry']['coordinates'], props, source_id)
    if osm_file:
        raw = Path(osm_file).read_bytes(); data = json.loads(raw)
        if data.get('remark') or not data.get('osm3s', {}).get('timestamp_osm_base'): raise ValueError('Complete dated Overpass JSON required')
        hashes['additional_osm'] = hashlib.sha256(raw).hexdigest()
        boundary = json.loads((ROOT / 'public/data/kri/kri-boundary.geojson').read_text())
        for element in data.get('elements', []):
            tags = element.get('tags', {}); center = element.get('center', element)
            coordinate = [center.get('lon'), center.get('lat')]
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in coordinate) or not in_coverage(coordinate, boundary): continue
            if element.get('type') not in ('node', 'way', 'relation') or not isinstance(element.get('id'), int): continue
            identity = f"{element['type']}-{element['id']}"
            props = {'name': tags.get('name', ''), 'name_ku': tags.get('name:ckb', tags.get('name:ku', '')),
                'name_ar': tags.get('name:ar', ''), 'name_en': tags.get('name:en', ''), 'source_date': data['osm3s']['timestamp_osm_base']}
            add(identity, osm_kind(tags), coordinate, props, 'osm-' + identity)
    features = [records[key] for key in sorted(records)]
    output = {'type': 'FeatureCollection', 'metadata': {'source_sha256': hashes,
        'counts': dict(sorted(Counter(f['properties']['road_hazard'] for f in features).items())),
        'note': 'Mapped records, not a live operational status or a complete inventory.'}, 'features': features}
    path = ROOT / 'src/data/road-hazards.json'; path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'records': len(features), **output['metadata']['counts']}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--osm-json'); build(parser.parse_args().osm_json)
