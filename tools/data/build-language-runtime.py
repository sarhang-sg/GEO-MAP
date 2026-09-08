#!/usr/bin/env python3
"""Build minimal, exact-language locality runtime packs for the current NAV KURD runtime.

The canonical source remains kri-localities.geojson. Runtime packs contain one
language only so the browser never parses Kurdish, Arabic and English locality
catalogs together. Kurdish source-original fallbacks are deliberately hidden;
unknown Kurdish names remain unlabeled instead of leaking Arabic source text.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data" / "kri"
SOURCE = DATA / "kri-localities.geojson"
MANIFEST = DATA / "kri-localities-language-manifest.json"
LANGUAGES = ("ku", "ar", "en")

COMMON_KEYS = (
    "id",
    "place",
    "population",
    "category",
    "category_group",
    "icon_id",
    "data_release",
    "language_policy",
)

LANGUAGE_KEYS = {
    "ku": ("name_ku", "admin_governorate_ku", "admin_district_ku", "admin_subdistrict_ku", "category_ku"),
    "ar": ("name_ar", "admin_governorate_ar", "admin_district_ar", "admin_subdistrict_ar", "category_ar"),
    "en": ("name_en", "admin_governorate_en", "admin_district_en", "admin_subdistrict_en", "category_en"),
}


def compact_text(value: Any) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def language_name(properties: dict[str, Any], language: str) -> tuple[str, str]:
    key = f"name_{language}"
    value = compact_text(properties.get(key))
    status = compact_text(properties.get(f"{key}_status"))
    if language == "ku" and status == "source-original-fallback":
        return "", status
    return value, status


def runtime_properties(source: dict[str, Any], language: str) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key in COMMON_KEYS:
        value = source.get(key)
        if value not in (None, "", [], {}):
            output[key] = value

    name, status = language_name(source, language)
    output["name"] = name
    output[f"name_{language}"] = name
    output["name_verified"] = bool(name)
    if status:
        output[f"name_{language}_status"] = status

    for key in LANGUAGE_KEYS[language][1:]:
        value = compact_text(source.get(key))
        if value:
            output[key] = value
    return output


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    features = source.get("features")
    if not isinstance(features, list):
        raise SystemExit("Canonical locality source is not a FeatureCollection.")

    manifest: dict[str, Any] = {
        "schema": "NAV KURD exact-language locality runtime v1",
        "version": source.get("data_release") or features[0].get("properties", {}).get("data_release", "unknown"),
        "runtime_policy": "Load exactly one locality language pack at a time; never use cross-language visible fallback.",
        "files": {},
    }

    source_ids = [feature.get("properties", {}).get("id") for feature in features]
    if len(source_ids) != len(set(source_ids)):
        raise SystemExit("Duplicate locality ids found in canonical source.")

    for language in LANGUAGES:
        runtime_features = []
        named_records = 0
        for feature in features:
            geometry = feature.get("geometry")
            source_properties = feature.get("properties") or {}
            if geometry is None or not source_properties.get("id"):
                continue
            properties = runtime_properties(source_properties, language)
            if properties.get("name_verified"):
                named_records += 1
            runtime_features.append({"type": "Feature", "geometry": geometry, "properties": properties})

        payload = {
            "type": "FeatureCollection",
            "language": language,
            "features": runtime_features,
        }
        encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        filename = f"kri-localities-render-{language}.geojson"
        (DATA / filename).write_bytes(encoded)
        manifest["files"][language] = {
            "file": filename,
            "records": len(runtime_features),
            "named_records": named_records,
            "bytes": len(encoded),
            "sha256": sha256_bytes(encoded),
        }

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        "Built exact-language locality packs: "
        + ", ".join(
            f"{language}={manifest['files'][language]['named_records']}/{manifest['files'][language]['records']}"
            for language in LANGUAGES
        )
    )


if __name__ == "__main__":
    main()
