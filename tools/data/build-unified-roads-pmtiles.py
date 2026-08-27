#!/usr/bin/env python3
"""Build one unified NAV KURD roads PMTiles archive from Geofabrik Iraq GeoPackage."""
from __future__ import annotations

import argparse, gzip, json
from pathlib import Path
from typing import Any

import geopandas as gpd
import mapbox_vector_tile
import mercantile
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write
from shapely.geometry import box, mapping, shape
from shapely.ops import clip_by_rect, unary_union
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GPKG = Path('/mnt/data/geodata/iraq.gpkg')
DEFAULT_BOUNDARY = ROOT / 'public/data/kri/kri-boundary.geojson'
DEFAULT_OUTPUT = ROOT / 'public/data/kri/kri-roads.pmtiles'
RELEASE = '2026-07-09-nav-kurd-v5.8.26-language-unified-polish-realtime'
EXTENT = 4096
TILE_BUFFER_PX = 160
ROAD_CLASS_MAP = {
    'motorway':'motorway','motorway_link':'motorway','trunk':'trunk','trunk_link':'trunk','primary':'primary','primary_link':'primary',
    'secondary':'secondary','secondary_link':'secondary','tertiary':'tertiary','tertiary_link':'tertiary','residential':'residential','living_street':'residential',
    'service':'service','unclassified':'unclassified','track':'track','track_grade1':'track','track_grade2':'track','track_grade3':'track','track_grade4':'track','track_grade5':'track'
}
LOW = {'motorway','trunk','primary'}
MID = {'motorway','trunk','primary','secondary'}
REGIONAL = {'motorway','trunk','primary','secondary','tertiary'}
SIMPLIFY = {5: 0.010, 6: 0.006, 7: 0.003, 8: 0.0014, 9: 0.00075, 10: 0.00038, 11: 0.00018, 12: 0.00009, 13: 0.000045, 14: 0.000025}

def clean(v: Any) -> str: return '' if v is None else str(v).strip()
def rclass(v: Any) -> str: return ROAD_CLASS_MAP.get(clean(v).lower(), 'other')

def boundary_geom(path: Path):
    data=json.loads(path.read_text(encoding='utf-8'))
    return unary_union([shape(f['geometry']) for f in data.get('features', []) if f.get('geometry')])

def props(row: Any) -> dict[str, Any]:
    oid=clean(row.get('osm_id')); name=clean(row.get('name')); ref=clean(row.get('ref'))
    out={'id':f'road-{oid}','class':row.get('_class','other'),'fclass':clean(row.get('fclass')),'maxspeed':clean(row.get('maxspeed')) or '0','bridge':clean(row.get('bridge')) or 'F','tunnel':clean(row.get('tunnel')) or 'F','oneway':clean(row.get('oneway')) or 'B','source':'OpenStreetMap data via Geofabrik Iraq GeoPackage'}
    if name: out['name']=name
    if ref: out['ref']=ref
    return out

def roads_for_zoom(frame: gpd.GeoDataFrame, z: int) -> gpd.GeoDataFrame:
    klass=frame['_class']
    if z <= 8: return frame[klass.isin(LOW)]
    if z <= 10: return frame[klass.isin(MID)]
    if z <= 12: return frame[klass.isin(REGIONAL)]
    return frame

def simplify(geom, z:int):
    try: return geom.simplify(SIMPLIFY.get(z,0), preserve_topology=False)
    except Exception: return geom

def feature_list(frame: gpd.GeoDataFrame, tile_box, z:int):
    hits=frame.sindex.query(tile_box, predicate='intersects')
    streets=[]; bridges=[]; seen=set()
    minx,miny,maxx,maxy=tile_box.bounds
    for pos in hits:
        row=frame.iloc[int(pos)]
        oid=clean(row.get('osm_id'))
        if oid in seen: continue
        seen.add(oid)
        try: geom=clip_by_rect(row.geometry, minx,miny,maxx,maxy)
        except Exception: continue
        if geom.is_empty or geom.geom_type not in {'LineString','MultiLineString'}: continue
        geom=simplify(geom,z)
        if geom.is_empty or geom.geom_type not in {'LineString','MultiLineString'}: continue
        item={'geometry':mapping(geom),'properties':props(row),'id':oid or None}
        streets.append(item)
        if clean(row.get('bridge')) == 'T': bridges.append(item)
    return streets, bridges

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--gpkg',type=Path,default=DEFAULT_GPKG); ap.add_argument('--boundary',type=Path,default=DEFAULT_BOUNDARY); ap.add_argument('--output',type=Path,default=DEFAULT_OUTPUT); ap.add_argument('--minzoom',type=int,default=5); ap.add_argument('--maxzoom',type=int,default=14); args=ap.parse_args()
    boundary=boundary_geom(args.boundary); prepared=prep(boundary)
    roads=gpd.read_file(args.gpkg,layer='gis_osm_roads_free',bbox=boundary.bounds,engine='pyogrio')
    roads=roads[roads.geometry.notna() & ~roads.geometry.is_empty].copy()
    roads=roads.loc[[prepared.intersects(g) for g in roads.geometry]].copy()
    roads['_class']=roads['fclass'].map(rclass)
    print('roads',len(roads),flush=True)
    generated=[]
    west,south,east,north=boundary.bounds
    for z in range(args.minzoom,args.maxzoom+1):
        frame=roads_for_zoom(roads,z).copy()
        # Build the spatial index after zoom filtering, so low zooms stay lean.
        _=frame.sindex
        tiles=list(mercantile.tiles(west,south,east,north,zooms=[z]))
        wrote=0
        for tile in tiles:
            b=mercantile.bounds(tile)
            tile_geom=box(b.west,b.south,b.east,b.north)
            if not boundary.intersects(tile_geom): continue
            dx=(b.east-b.west)*TILE_BUFFER_PX/EXTENT; dy=(b.north-b.south)*TILE_BUFFER_PX/EXTENT
            query_box=box(b.west-dx,b.south-dy,b.east+dx,b.north+dy)
            streets, bridges=feature_list(frame, query_box, z)
            if not streets: continue
            payload=[{'name':'streets','features':streets}]
            if bridges: payload.append({'name':'bridges','features':bridges})
            raw=mapbox_vector_tile.encode(payload,default_options={'quantize_bounds':(b.west,b.south,b.east,b.north),'extents':EXTENT,'y_coord_down':False,'check_winding_order':True})
            generated.append((z,tile.x,tile.y,gzip.compress(raw,compresslevel=6)))
            wrote+=1
        print(f'z{z}: source {len(frame):,}, tiles {wrote:,}',flush=True)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    md={'name':'NAV KURD unified road network','description':'One buffered road source for NAV KURD KRI + Kirkuk coverage; link classes normalized, no mobile/desktop handoff.','attribution':'© OpenStreetMap contributors','type':'overlay','format':'pbf','version':RELEASE,'bounds':[str(west),str(south),str(east),str(north)],'center':[str((west+east)/2),str((south+north)/2),'8'],'minzoom':str(args.minzoom),'maxzoom':str(args.maxzoom),'vector_layers':[{'id':'streets'},{'id':'bridges'}]}
    header={'tile_compression':Compression.GZIP,'tile_type':TileType.MVT,'min_lon_e7':int(west*1e7),'min_lat_e7':int(south*1e7),'max_lon_e7':int(east*1e7),'max_lat_e7':int(north*1e7),'center_lon_e7':int(((west+east)/2)*1e7),'center_lat_e7':int(((south+north)/2)*1e7),'center_zoom':8}
    with write(str(args.output)) as w:
        for z,x,y,data in sorted(generated,key=lambda t:zxy_to_tileid(t[0],t[1],t[2])): w.write_tile(zxy_to_tileid(z,x,y),data)
        w.finalize(header,md)
    print(json.dumps({'output':str(args.output),'bytes':args.output.stat().st_size,'tiles':len(generated),'version':RELEASE},indent=2),flush=True)
if __name__=='__main__': main()
