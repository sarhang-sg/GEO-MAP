#!/usr/bin/env python3
from __future__ import annotations
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'public/data/kri'
RELEASE=json.loads((ROOT/'release.config.json').read_text(encoding='utf-8'))['mapDataVersion']

def load(name): return json.loads((DATA/name).read_text(encoding='utf-8'))
def write(name,payload): (DATA/name).write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
def pick(props,keys): return {key:props[key] for key in keys if key in props and props[key] not in (None,'',[],{})}
def compact(source_name,target_name,keys):
    source=load(source_name)
    features=[]
    for feature in source.get('features',[]):
        features.append({'type':'Feature','geometry':feature.get('geometry'),'properties':pick(feature.get('properties',{}),keys)})
    write(target_name,{'type':'FeatureCollection','name':source.get('name',target_name.removesuffix('.geojson')),'version':RELEASE,'features':features})
    return len(features),(DATA/target_name).stat().st_size

locality_keys=['id','name','name_display','name_ku','name_ar','name_en','place','population','admin_governorate_ku','admin_governorate_ar','admin_governorate_en','admin_district_ku','admin_district_ar','admin_district_en','admin_subdistrict_ku','admin_subdistrict_ar','admin_subdistrict_en','category','category_group','category_ku','category_ar','category_en','icon_id','data_release','language_policy']
poi_render_keys=['id','category','category_group','category_ku','category_ar','category_en','name','name_display','name_ku','name_ar','name_en','icon_id','tier','minzoom','priority','data_release','language_policy']
poi_runtime_keys=['id','osm_id','entity_kind','kind','source_fclass','fclass','category','category_group','category_ku','category_ar','category_en','name','name_display','name_ku','name_ar','name_en','icon_id','tier','minzoom','priority','source','source_date','data_release','language_policy']
print('localities',compact('kri-localities.geojson','kri-localities-render.geojson',locality_keys))
print('poi-render',compact('kri-pois.geojson','kri-pois-render.geojson',poi_render_keys))
print('poi-runtime',compact('kri-pois.geojson','kri-pois-runtime.geojson',poi_runtime_keys))

# Keep the canonical report aligned with the full catalog and compact runtime.
def file_meta(name):
    path = DATA / name
    return {
        'file': name,
        'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }

report = load('kri-poi-catalog-report.json')
report['version'] = RELEASE
report.setdefault('files', {})['catalog'] = file_meta('kri-pois.geojson')
report['files']['runtime'] = file_meta('kri-pois-runtime.geojson')
write('kri-poi-catalog-report.json', report)
print('poi-report', report['files']['runtime'])
