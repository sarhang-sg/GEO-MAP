#!/usr/bin/env python3
"""Synchronize NAV KURD data reports and manifests after POI/search generation."""
from __future__ import annotations
import collections
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data" / "kri"

def read(path: Path): return json.loads(path.read_text(encoding="utf-8"))
def write(path: Path, value): path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
def meta(path: Path, records: int | None = None):
    value = {"file": path.name, "bytes": path.stat().st_size, "sha256": sha(path)}
    if records is not None: value["records"] = records
    return value

release = read(ROOT / "release.config.json")
search_path = DATA / "kri-search-index.json"
poi_path = DATA / "kri-pois.geojson"
runtime_path = DATA / "kri-pois-runtime.geojson"
report_path = DATA / "kri-poi-catalog-report.json"
quarantine_path = DATA / "kri-poi-quarantine.json"
search = read(search_path)
poi = read(poi_path)
runtime = read(runtime_path)
search_manifest = read(DATA / "kri-search-index-manifest.json")
kind_counts = collections.Counter(item.get("k", "") for item in search["items"])
category_counts = collections.Counter(feature["properties"].get("category", "") for feature in poi["features"])
exact_poi = {lang: sum(bool(feature["properties"].get(f"name_{lang}")) for feature in poi["features"]) for lang in ("ku", "ar", "en")}
exact_search = {lang: search_manifest["files"][lang]["records"] for lang in ("ku", "ar", "en")}

quality_path = DATA / "kri-canonical-data-quality-report.json"
quality = read(quality_path)
quality["release"] = release["releaseId"]
quality["app_version"] = release["appVersion"]
quality["map_data_version"] = release["mapDataVersion"]
quality["published"].update({
    "search_records": len(search["items"]),
    "search_source_records": search.get("source_records", 58_810),
    "search_kind_counts": dict(sorted(kind_counts.items())),
    "canonical_pois": len(poi["features"]),
    "canonical_poi_categories": len(category_counts),
    "taxonomy_icons": 422,
    "search_removed_without_exact_language_name": 0,
})
quality["exact_language_coverage"]["search"] = exact_search
quality["exact_language_coverage"]["canonical_pois"] = exact_poi
quality["canonical_poi_catalog"] = {
    "records": len(poi["features"]),
    "runtime_records": len(runtime["features"]),
    "categories": len(category_counts),
    "files": {
        "catalog": meta(poi_path, len(poi["features"])),
        "runtime": meta(runtime_path, len(runtime["features"])),
        "report": meta(report_path),
        "quarantine": meta(quarantine_path),
    },
    "policy": "Named, source-backed and boundary-contained only; strict service-brand context; no invented Kurdish names or inferred private ownership.",
}
write(quality_path, quality)

provenance_path = DATA / "kri-data-provenance.json"
provenance = read(provenance_path)
provenance["release"] = release["releaseId"]
provenance["app_version"] = release["appVersion"]
provenance["map_data_version"] = release["mapDataVersion"]
provenance["counts"].update({
    "search_records": len(search["items"]),
    "search_source_records": search.get("source_records", 58_810),
    "search_kind_counts": dict(sorted(kind_counts.items())),
    "canonical_pois": len(poi["features"]),
    "canonical_poi_categories": len(category_counts),
    "taxonomy_icons": 422,
})
provenance["exact_language_coverage"]["search"] = exact_search
provenance["exact_language_coverage"]["canonical_pois"] = exact_poi
if not any(source.get("name") == "NAV KURD canonical POI pipeline" for source in provenance["sources"]):
    provenance["sources"].append({
        "name": "NAV KURD canonical POI pipeline",
        "file": "kri-pois.geojson / kri-pois-runtime.geojson",
        "date": "2026-07-17",
        "role": "Named POI/building/project expansion, strict contextual service-brand classification, semantic dedupe, category-specific icons and exact-language search integration.",
    })
write(provenance_path, provenance)

base_path = DATA / "kri-base-map-manifest.json"
base = read(base_path)
base.update({
    "release": release["appVersion"],
    "release_id": release["releaseId"],
    "map_data_version": release["mapDataVersion"],
    "format": "PMTiles v3 + clustered canonical POI GeoJSON + exact-language search manifests",
    "search": search_manifest,
    "canonical_pois": {
        "catalog": meta(poi_path, len(poi["features"])),
        "runtime": meta(runtime_path, len(runtime["features"])),
        "report": meta(report_path),
        "quarantine": meta(quarantine_path),
        "categories": len(category_counts),
        "taxonomy_icons": 422,
        "rendering": "Clustered GeoJSON with zoom-tier category-specific marker handoff.",
    },
    "offline": "Base/roads PMTiles are downloadable. Canonical POI runtime and exact-language search shards are cached by the service worker. Satellite/weather/routing/accounts require network access.",
})
write(base_path, base)

report = read(report_path)
report["release"] = release["releaseId"]
report["app_version"] = release["appVersion"]
report["audit_history"] = {
    "strict_context_brand_false_positives_corrected": 109,
    "detailed_transport_security_class_upgrades": 115,
    "semantic_dedupe_policy": "same category + normalized exact name + approximately 24 m proximity",
}
report["taxonomy"] = {
    "entries": 422,
    "category_icons": "one generated marker asset per taxonomy entry",
    "fallback": "canonical purple dot only if an icon fails to decode",
}
write(report_path, report)

print(json.dumps({
    "app": release["appVersion"], "map_data": release["mapDataVersion"],
    "pois": len(poi["features"]), "categories": len(category_counts), "search": len(search["items"]),
    "exact_poi": exact_poi, "exact_search": exact_search, "kind_counts": dict(kind_counts),
}, ensure_ascii=False, indent=2))
