#!/usr/bin/env python3
"""Build deterministic viewport-scoped GeoJSON shards for NAV KURD POIs.

The runtime must never fetch the 20+ MiB canonical render catalogs before the
user reaches a zoom where POIs are visible. This builder keeps the canonical
files untouched and emits a quadtree of small immutable shards plus one compact
manifest used by the viewport loader.

Every manifest `file` is a canonical public-root path (`data/kri/...`) so
the deployed path is unambiguous and independently verifiable.
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
DATA = PUBLIC / "data" / "kri"
OUTPUT = DATA / "viewport-poi-shards"
MANIFEST_PATH = DATA / "kri-viewport-poi-shards-manifest.json"
START_ZOOM = 8
MAX_ZOOM = 14
RELEASE = json.loads((ROOT / "release.config.json").read_text(encoding="utf-8"))


@dataclass(frozen=True)
class DatasetConfig:
    id: str
    source: str
    max_records: int
    runtime_minzoom: float


DATASETS = (
    DatasetConfig("base", "kri-pois-render.geojson", 550, 8.15),
    DatasetConfig("natural", "kri-natural-features.geojson", 400, 9.65),
)


def compact_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def tile_xy(longitude: float, latitude: float, zoom: int) -> tuple[int, int]:
    latitude = max(-85.05112878, min(85.05112878, latitude))
    scale = 1 << zoom
    x = int((longitude + 180.0) / 360.0 * scale)
    y = int((1.0 - math.asinh(math.tan(math.radians(latitude))) / math.pi) / 2.0 * scale)
    return max(0, min(scale - 1, x)), max(0, min(scale - 1, y))


def tile_bounds(zoom: int, x: int, y: int) -> list[float]:
    scale = 1 << zoom
    west = x / scale * 360.0 - 180.0
    east = (x + 1) / scale * 360.0 - 180.0

    def latitude(tile_y: int) -> float:
        mercator = math.pi * (1.0 - 2.0 * tile_y / scale)
        return math.degrees(math.atan(math.sinh(mercator)))

    north = latitude(y)
    south = latitude(y + 1)
    return [round(west, 8), round(south, 8), round(east, 8), round(north, 8)]


def feature_coordinate(feature: dict[str, Any]) -> tuple[float, float]:
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Point":
        raise ValueError(f"Viewport shard source contains non-Point geometry: {geometry.get('type')}")
    coordinates = geometry.get("coordinates") or []
    if len(coordinates) < 2:
        raise ValueError("Viewport shard source contains an invalid Point coordinate.")
    return float(coordinates[0]), float(coordinates[1])


def recursive_leaves(
    features: list[dict[str, Any]],
    zoom: int,
    x: int,
    y: int,
    max_records: int,
) -> Iterable[tuple[int, int, int, list[dict[str, Any]]]]:
    if len(features) <= max_records or zoom >= MAX_ZOOM:
        yield zoom, x, y, features
        return

    children: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for feature in features:
        child = tile_xy(*feature_coordinate(feature), zoom + 1)
        children[child].append(feature)

    for (child_x, child_y), child_features in sorted(children.items()):
        yield from recursive_leaves(child_features, zoom + 1, child_x, child_y, max_records)


def build_dataset(config: DatasetConfig) -> dict[str, Any]:
    source_path = DATA / config.source
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    features = payload.get("features")
    if not isinstance(features, list) or not features:
        raise RuntimeError(f"Viewport source is empty or invalid: {config.source}")

    initial: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for feature in features:
        initial[tile_xy(*feature_coordinate(feature), START_ZOOM)].append(feature)

    output_root = OUTPUT / config.id
    output_root.mkdir(parents=True, exist_ok=True)
    leaves: list[dict[str, Any]] = []
    output_bytes = 0
    output_records = 0

    for (x, y), bucket in sorted(initial.items()):
        for zoom, leaf_x, leaf_y, leaf_features in recursive_leaves(
            bucket, START_ZOOM, x, y, config.max_records
        ):
            relative = Path("data/kri/viewport-poi-shards") / config.id / str(zoom) / str(leaf_x) / f"{leaf_y}.json"
            target = PUBLIC / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            icon_ids = sorted({
                str((feature.get("properties") or {}).get("icon_id") or "").strip()
                for feature in leaf_features
                if str((feature.get("properties") or {}).get("icon_id") or "").strip()
            })
            document = {
                "type": "FeatureCollection",
                "name": f"nav-kurd-{config.id}-viewport-{zoom}-{leaf_x}-{leaf_y}",
                "version": payload.get("version") or RELEASE["mapDataVersion"],
                "features": leaf_features,
            }
            raw = compact_json(document)
            target.write_bytes(raw)
            output_bytes += len(raw)
            output_records += len(leaf_features)
            leaves.append({
                "key": f"{zoom}/{leaf_x}/{leaf_y}",
                "z": zoom,
                "x": leaf_x,
                "y": leaf_y,
                "bbox": tile_bounds(zoom, leaf_x, leaf_y),
                "file": relative.as_posix(),
                "records": len(leaf_features),
                "bytes": len(raw),
                "sha256": sha256(raw),
                "icon_ids": icon_ids,
            })

    if output_records != len(features):
        raise RuntimeError(
            f"Viewport shard record mismatch for {config.id}: {output_records} != {len(features)}"
        )

    leaves.sort(key=lambda item: (item["z"], item["x"], item["y"]))
    return {
        "id": config.id,
        "source": config.source,
        "records": len(features),
        "source_bytes": source_path.stat().st_size,
        "runtime_minzoom": config.runtime_minzoom,
        "max_records_per_shard": config.max_records,
        "shards": len(leaves),
        "bytes": output_bytes,
        "leaves": leaves,
    }


def main() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True, exist_ok=True)

    datasets = {config.id: build_dataset(config) for config in DATASETS}
    manifest = {
        "schema": "NAV KURD viewport POI shards v1",
        "release": RELEASE["mapDataVersion"],
        "tile_scheme": "web-mercator-quadtree",
        "start_zoom": START_ZOOM,
        "max_zoom": MAX_ZOOM,
        "datasets": datasets,
    }
    MANIFEST_PATH.write_bytes(compact_json(manifest) + b"\n")
    summary = ", ".join(
        f"{dataset_id}={meta['records']} records/{meta['shards']} shards/{meta['bytes']} bytes"
        for dataset_id, meta in datasets.items()
    )
    print(f"Built NAV KURD viewport POI shards for {RELEASE['mapDataVersion']}: {summary}.")


if __name__ == "__main__":
    main()
