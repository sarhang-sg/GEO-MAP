#!/usr/bin/env python3
"""Build compact named-major-road label points from an authorized OSM GeoPackage.

This is a developer-side GIS build tool only. It is never used by the Vercel
runtime. The public result contains a single label anchor for each named
motorway/trunk/primary/secondary/tertiary road key so the browser can show
road labels without loading every road geometry as GeoJSON.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import shape
from shapely.prepared import prep

ROAD_CLASSES = {
    "motorway": ("motorway", 8.0, 100),
    "motorway_link": ("motorway", 8.0, 98),
    "trunk": ("trunk", 8.4, 95),
    "trunk_link": ("trunk", 8.8, 93),
    "primary": ("primary", 9.4, 88),
    "primary_link": ("primary", 9.7, 86),
    "secondary": ("secondary", 10.6, 72),
    "secondary_link": ("secondary", 10.8, 70),
    "tertiary": ("tertiary", 12.0, 55),
    "tertiary_link": ("tertiary", 12.2, 53),
}


def clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def load_boundary(path: Path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    geometries = [shape(item["geometry"]) for item in payload.get("features", []) if item.get("geometry")]
    if not geometries:
        raise ValueError("Boundary GeoJSON contains no geometries")
    result = geometries[0]
    for geometry in geometries[1:]:
        result = result.union(geometry)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpkg", type=Path, required=True)
    parser.add_argument("--boundary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    boundary = load_boundary(args.boundary)
    raw = gpd.read_file(args.gpkg, layer="gis_osm_roads_free", bbox=boundary.bounds, engine="pyogrio")
    raw = raw[raw.geometry.notna() & ~raw.geometry.is_empty].copy()
    raw["fclass"] = raw["fclass"].map(clean)
    raw["name"] = raw["name"].map(clean)
    raw["ref"] = raw["ref"].map(clean)
    raw = raw[raw["fclass"].isin(ROAD_CLASSES)]
    raw = raw[(raw["name"] != "") | (raw["ref"] != "")]

    prepared = prep(boundary)
    raw = raw.loc[[prepared.intersects(geometry) for geometry in raw.geometry]].copy()
    raw["road_class"] = raw["fclass"].map(lambda value: ROAD_CLASSES[value][0])
    raw["minzoom"] = raw["fclass"].map(lambda value: ROAD_CLASSES[value][1])
    raw["rank"] = raw["fclass"].map(lambda value: ROAD_CLASSES[value][2])
    raw["key"] = raw["road_class"] + "|" + raw["name"] + "|" + raw["ref"]

    projected = raw.to_crs(3857)
    raw["length_m"] = projected.length
    representatives = raw.sort_values("length_m", ascending=False).drop_duplicates("key", keep="first").copy()

    features = []
    for index, row in enumerate(representatives.itertuples(index=False), start=1):
        geometry = row.geometry
        point = geometry.interpolate(0.5, normalized=True) if geometry.geom_type in {"LineString", "MultiLineString"} else geometry.representative_point()
        if point.is_empty or not prepared.intersects(point):
            point = geometry.representative_point()
        if point.is_empty:
            continue
        display_name = row.name or row.ref
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(float(point.x), 6), round(float(point.y), 6)]},
            "properties": {
                "id": f"road-label-{index}",
                "name": display_name,
                "ref": row.ref or None,
                "class": row.road_class,
                "minzoom": row.minzoom,
                "rank": row.rank,
                "source": "OpenStreetMap data via Geofabrik Iraq GeoPackage",
            },
        })

    features.sort(key=lambda feature: (-feature["properties"]["rank"], feature["properties"]["name"]))
    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "schema": "Kurdistan Atlas Road Label Index v1",
            "source": "OpenStreetMap data via Geofabrik Iraq GeoPackage",
            "attribution": "© OpenStreetMap contributors",
            "scope": "Kurdistan Region technical boundary clip",
            "features": len(features),
            "notice": "This compact index deliberately labels named major and regional roads only; full road geometry remains in PMTiles.",
        },
        "features": features,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(features):,} road label anchors to {args.output}")


if __name__ == "__main__":
    main()
