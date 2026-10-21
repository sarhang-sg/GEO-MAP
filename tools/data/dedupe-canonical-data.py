#!/usr/bin/env python3
"""High-confidence NAV KURD canonical/search deduplication.

A merge is permitted only when records have the same kind/category, are within
2 metres, and share an exact normalized proper name in at least one language.
No fuzzy-name or broad-distance merge is performed. Removed identities and the
selection reason are written to an auditable quarantine ledger.
"""
from __future__ import annotations
import argparse, json, math, re, unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[2]
PUBLIC_DATA=ROOT/'public/data/kri'
CANONICAL=ROOT/'data-src/canonical'
SEARCH_SOURCE=ROOT/'data-src/generated/search'
LEDGER=ROOT/'data-src/quarantine/kri-dedupe-ledger.json'
NAME_KEYS=('name_ku','name_ar','name_en','name','name_display','n_ku','n_ar','n_en','n')
SPACE=re.compile(r'\s+')
MARKS=re.compile(r'[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]')

def norm(value: Any)->str:
    s=unicodedata.normalize('NFKC',str(value or '')).casefold()
    s=MARKS.sub('',s).replace('ـ','').translate(str.maketrans({'ك':'ک','ي':'ی','ى':'ی','أ':'ا','إ':'ا','آ':'ا','ة':'ە','ۀ':'ە','ھ':'ه'}))
    return SPACE.sub(' ',s).strip()

def names(record: dict[str,Any])->set[str]:
    return {v for k in NAME_KEYS if (v:=norm(record.get(k)))}

def haversine(a:list[float],b:list[float])->float:
    lon1,lat1=map(math.radians,a[:2]); lon2,lat2=map(math.radians,b[:2])
    dlon=lon2-lon1; dlat=lat2-lat1
    h=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371000*2*math.asin(min(1,math.sqrt(h)))

def source_rank(identity:str, props:dict[str,Any])->tuple[int,int,int,str]:
    kind=str(props.get('entity_kind') or '')
    if identity.startswith('osm-relation-') or kind=='relation': primary=60
    elif identity.startswith('osm-way-') or kind=='way': primary=50
    elif identity.startswith('osm-node-') or kind=='node': primary=40
    elif identity.startswith('geonames-'): primary=30
    elif identity.startswith('osm-natural-'): primary=20
    else: primary=10
    localized=sum(bool(str(props.get(k) or '').strip()) for k in ('name_ku','name_ar','name_en'))
    richness=sum(bool(v not in ('',None,[],{})) for v in props.values())
    return primary,localized,richness,identity

def merge_properties(keeper:dict[str,Any], removed:dict[str,Any])->None:
    # Preserve canonical identity/geometry; fill only absent metadata and union aliases.
    for key,value in removed.items():
        if key in {'id','osm_id','entity_kind','source_layer','source_fclass','source','source_date'}: continue
        if key.startswith('aliases_'):
            left=keeper.get(key) if isinstance(keeper.get(key),list) else []
            right=value if isinstance(value,list) else []
            out=[]; seen=set()
            for item in [*left,*right]:
                n=norm(item)
                if n and n not in seen: seen.add(n); out.append(item)
            if out: keeper[key]=out
        elif keeper.get(key) in ('',None,[],{}) and value not in ('',None,[],{}):
            keeper[key]=value

def components(records:list[dict[str,Any]], coords:list[list[float]], identities:list[str], categories:list[tuple[str,str]])->list[list[int]]:
    # Build an inverted exact-name index, then apply the strict 2 m geometry gate.
    # This catches records that fall on opposite sides of a rounded coordinate cell
    # without introducing fuzzy-name matches.
    inverted=defaultdict(list)
    for i,record in enumerate(records):
        for name in names(record): inverted[(categories[i],name)].append(i)
    parent=list(range(len(records)))
    def find(x):
        while parent[x]!=x: parent[x]=parent[parent[x]]; x=parent[x]
        return x
    def union(a,b):
        a,b=find(a),find(b)
        if a!=b: parent[b]=a
    checked=set()
    for ids in inverted.values():
        if len(ids)<2: continue
        for p,a in enumerate(ids):
            for b in ids[p+1:]:
                pair=(a,b) if a<b else (b,a)
                if pair in checked: continue
                checked.add(pair)
                distance=haversine(coords[a],coords[b])
                ia,ib=identities[a],identities[b]
                derived=('osm-natural-' in ia) or ('osm-natural-' in ib)
                area_pair=(('osm-way-' in ia or 'osm-relation-' in ia) and 'osm-node-' in ib) or (( 'osm-way-' in ib or 'osm-relation-' in ib) and 'osm-node-' in ia)
                same_point=('osm-node-' in ia and 'osm-node-' in ib and distance<=1.25)
                if distance<=2.0 and (derived or area_pair or same_point): union(a,b)
    groups=defaultdict(list)
    for i in range(len(records)): groups[find(i)].append(i)
    return [g for g in groups.values() if len(g)>1]

def dedupe_pois(dry:bool, ledger:list[dict[str,Any]])->tuple[int,int,dict[str,str]]:
    path=CANONICAL/'kri-pois.geojson'; payload=json.loads(path.read_text(encoding='utf-8')); feats=payload.get('features',[])
    records=[f.get('properties') or {} for f in feats]
    coords=[(f.get('geometry') or {}).get('coordinates') or [999,999] for f in feats]
    identities=[str(r.get('id') or f.get('id') or f'row-{i}') for i,(r,f) in enumerate(zip(records,feats))]
    cats=[(norm(r.get('kind')),norm(r.get('category'))) for r in records]
    groups=components(records,coords,identities,cats); removed=set(); redirects={}
    for group in groups:
        keeper=max(group,key=lambda i:source_rank(identities[i],records[i]))
        shared=set.intersection(*(names(records[i]) for i in group)) if group else set()
        for i in group:
            if i==keeper: continue
            removed.add(i); redirects[identities[i]]=identities[keeper]; merge_properties(records[keeper],records[i])
            ledger.append({'dataset':'canonical-poi','retained_id':identities[keeper],'removed_id':identities[i],
              'category':records[keeper].get('category'),'distance_m':round(haversine(coords[keeper],coords[i]),3),
              'shared_names':sorted(shared),'reason':'same kind/category + <=2m + exact normalized shared proper name',
              'status':'removed-high-confidence'})
    if removed and not dry:
        payload['features']=[f for i,f in enumerate(feats) if i not in removed]
        payload['deduplication']={'schema':'NAV KURD canonical high-confidence dedupe v1','removed':len(removed),'ledger':'data-src/quarantine/kri-dedupe-ledger.json'}
        path.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    return len(feats),len(removed),redirects

def dedupe_search(dry:bool, ledger:list[dict[str,Any]], canonical_redirects:dict[str,str])->tuple[int,int]:
    path=SEARCH_SOURCE/'kri-search-index.json'; payload=json.loads(path.read_text(encoding='utf-8')); items=payload.get('items',[])
    coords=[[float(x.get('x',999)),float(x.get('y',999))] for x in items]
    identities=[str(x.get('s') or f'row-{i}') for i,x in enumerate(items)]
    cats=[(norm(x.get('k')),norm(x.get('c'))) for x in items]
    poi_indices=[i for i,x in enumerate(items) if norm(x.get('k'))=='poi']
    poi_items=[items[i] for i in poi_indices]; poi_coords=[coords[i] for i in poi_indices]
    poi_ids=[identities[i] for i in poi_indices]; poi_cats=[cats[i] for i in poi_indices]
    local_groups=components(poi_items,poi_coords,poi_ids,poi_cats)
    groups=[[poi_indices[i] for i in group] for group in local_groups]; removed=set()
    for group in groups:
        canonical_targets={canonical_redirects.get(identities[i]) for i in group if canonical_redirects.get(identities[i])}
        canonical_candidates=[i for i in group if identities[i] in canonical_targets]
        keeper=max(canonical_candidates or group,key=lambda i:source_rank(identities[i],items[i])); shared=set.intersection(*(names(items[i]) for i in group)) if group else set()
        for i in group:
            if i==keeper: continue
            removed.add(i); merge_properties(items[keeper],items[i])
            ledger.append({'dataset':'search-source','retained_id':identities[keeper],'removed_id':identities[i],
              'category':items[keeper].get('c'),'distance_m':round(haversine(coords[keeper],coords[i]),3),
              'shared_names':sorted(shared),'reason':'same kind/category + <=2m + exact normalized shared proper name',
              'status':'removed-high-confidence'})
    if removed and not dry:
        payload['items']=[x for i,x in enumerate(items) if i not in removed]
        payload['published_records']=len(payload['items'])
        payload['deduplication']={'schema':'NAV KURD search high-confidence dedupe v1','source_records':len(items),'removed_records':len(removed),'ledger':'data-src/quarantine/kri-dedupe-ledger.json'}
        path.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    return len(items),len(removed)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--dry-run',action='store_true'); args=ap.parse_args()
    ledger=[]; before_p,removed_p,redirects=dedupe_pois(args.dry_run,ledger); before_s,removed_s=dedupe_search(args.dry_run,ledger,redirects)
    result={'schema':'NAV KURD canonical dedupe ledger v1','created_at':datetime.now(timezone.utc).isoformat(),
      'policy':'Only same kind/category, <=2 metres, exact normalized shared proper name. No fuzzy merge.',
      'dry_run':args.dry_run,'summary':{'canonical_poi_before':before_p,'canonical_poi_removed':removed_p,'search_before':before_s,'search_removed':removed_s},'entries':ledger}
    if not args.dry_run:
        LEDGER.parent.mkdir(parents=True,exist_ok=True); LEDGER.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['summary'],ensure_ascii=False))
    for e in ledger: print(f"{e['dataset']}: {e['removed_id']} -> {e['retained_id']} ({e['distance_m']}m)")
if __name__=='__main__': main()
