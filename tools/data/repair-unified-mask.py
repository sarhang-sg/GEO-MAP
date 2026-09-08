#!/usr/bin/env python3
"""Remove accidental interior gaps from the NAV KURD unified coverage geometry.

The prior dissolved boundary preserved unintended interior rings from the reference clip.
Those rings were then rendered by the outside-mask as dark islands inside the map.
This repair keeps the unified outer extent and fills only the accidental internal gaps.
"""
from __future__ import annotations

import json
from pathlib import Path
from shapely.geometry import Polygon, MultiPolygon, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data" / "kri"
BOUNDARY_PATH = DATA / "kri-boundary.geojson"
LINE_PATH = DATA / "kri-boundary-line.geojson"
MASK_PATH = DATA / "kri-outside-mask.geojson"
WORLD = [(-180.0, -85.0), (180.0, -85.0), (180.0, 85.0), (-180.0, 85.0), (-180.0, -85.0)]


def filled_geometry(geometry):
    original = shape(geometry)
    if original.geom_type == "Polygon":
        dissolved = Polygon(original.exterior)
    elif original.geom_type == "MultiPolygon":
        # Preserve every outer part, but deliberately remove interior rings.
        dissolved = unary_union([Polygon(part.exterior) for part in original.geoms])
    else:
        raise RuntimeError(f"Unsupported unified boundary geometry: {original.geom_type}")
    if not dissolved.is_valid:
        dissolved = dissolved.buffer(0)
    if dissolved.is_empty:
        raise RuntimeError("Unified coverage repair produced an empty geometry.")
    if dissolved.geom_type == "Polygon":
        return orient(dissolved, sign=1.0)
    if dissolved.geom_type == "MultiPolygon":
        return MultiPolygon([orient(part, sign=1.0) for part in dissolved.geoms])
    raise RuntimeError(f"Unexpected repaired geometry: {dissolved.geom_type}")


def exteriors(geometry):
    if geometry.geom_type == "Polygon":
        return [list(geometry.exterior.coords)]
    if geometry.geom_type == "MultiPolygon":
        return [list(part.exterior.coords) for part in geometry.geoms]
    raise RuntimeError(f"Unsupported repaired geometry: {geometry.geom_type}")


def main() -> None:
    boundary = json.loads(BOUNDARY_PATH.read_text(encoding="utf-8"))
    feature = boundary["features"][0]
    repaired = filled_geometry(feature["geometry"])
    props = dict(feature.get("properties") or {})
    props.update({
        "method": "dissolved-unified-coverage-mask-filled-interior-gaps",
        "mask_repair": "Filled accidental interior rings so the map has one continuous coverage mask.",
        "name_ku": "هەرێمی کوردستان",
        "name_ar": "إقليم كردستان",
        "name_en": "Kurdistan Region",
    })
    boundary["features"] = [{"type": "Feature", "properties": props, "geometry": mapping(repaired)}]
    BOUNDARY_PATH.write_text(json.dumps(boundary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    line_props = {
        "name": "NAV KURD unified outside boundary",
        "source": props.get("source", "NAV KURD unified operational coverage"),
        "method": "dissolved-unified-outer-boundary-only",
        "quality": props.get("quality", "operational geographic coverage / not legal, political, cadastral or governmental certification"),
        "mask_repair": "Interior boundary rings are intentionally omitted; only the outer map coverage boundary is drawn.",
    }
    lines = exteriors(repaired)
    line_geometry = {"type": "LineString", "coordinates": lines[0]} if len(lines) == 1 else {"type": "MultiLineString", "coordinates": lines}
    line_doc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": line_props, "geometry": line_geometry}]}
    LINE_PATH.write_text(json.dumps(line_doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # The current dissolved coverage is contiguous. Construct exactly one world-minus-coverage polygon:
    # world exterior + one coverage hole. This removes all dark internal islands.
    if repaired.geom_type != "Polygon":
        raise RuntimeError("Expected one contiguous coverage polygon after repair.")
    coverage_ring = list(repaired.exterior.coords)
    mask = Polygon(WORLD, [coverage_ring])
    mask = orient(mask, sign=1.0)
    mask_doc = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {
                "name": "Dark outside NAV KURD unified coverage",
                "source": props.get("source", "NAV KURD unified operational coverage"),
                "method": "world-minus-single-unified-coverage-mask",
                "quality": props.get("quality", "operational geographic coverage / not legal, political, cadastral or governmental certification"),
                "mask_repair": "One world-minus-coverage polygon; no internal dark islands are emitted.",
            },
            "geometry": mapping(mask),
        }],
    }
    MASK_PATH.write_text(json.dumps(mask_doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Unified coverage repaired: {repaired.geom_type}; outer boundaries={len(lines)}; interior holes=0; outside-mask parts=1.")


if __name__ == "__main__":
    main()
