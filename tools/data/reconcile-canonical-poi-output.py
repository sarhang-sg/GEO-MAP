#!/usr/bin/env python3
"""Reconcile generated canonical POIs against the verified pre-expansion search corpus.

This post-build stage is deterministic and fast. It restores exact language-coded
names from the verified canonical corpus, applies strict contextual telecom/payment
brand classification, upgrades detailed transport classes, regenerates the
compact runtime catalog and exact-language search shards, and emits a QA report.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

import importlib.util
import sys

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data" / "kri"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


R = load_module("nav_kurd_rebuild_reconcile", ROOT / "tools" / "data" / "rebuild-canonical-data.py")
P = load_module("nav_kurd_poi_builder_reconcile", ROOT / "tools" / "data" / "build-canonical-poi-catalog.py")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(value, ensure_ascii=False, indent=2)
    path.write_text(payload + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def strict_brand_allowed(source_class: str, source_layer: str, name: str, brand_id: str) -> bool:
    source_class = source_class.lower()
    normalized_name = R.search_key(name).lower()
    if brand_id == "fastpay":
        return source_class in {"atm", "bank", "kiosk", "convenience", "mobile_phone_shop"} or (
            source_layer == "gis_osm_buildings_a_free" and "fast" in normalized_name
        )
    if source_class == "comms_tower" or source_class == "mobile_phone_shop":
        return True
    if source_layer == "gis_osm_buildings_a_free":
        center_words = ("center", "centre", "office", "branch", "company", "service", "shop", "store", "سەنتەر", "ناوەند", "مکتب", "فرع", "شركة")
        return any(word in normalized_name for word in center_words) or len(normalized_name.split()) <= 2
    return False




FINANCE_RECLASSIFICATION_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("بازگە", "خاڵی پشکنین", "نقطة تفتيش", "سيطرة", "سیطرە", "checkpoint"), "checkpoint"),
    (("اللواء", "الفوج", "كتيبة", "کتیبە", "فەوج", "لیوا", "brigade", "battalion"), "military_base"),
    (("باخ", "کێڵگە", "كێڵگە", "بستان", "مزرعة", "farm", "orchard", "garden"), "orchard"),
    (("مزگەوت", "مسجد", "جامع", "mosque"), "mosque"),
    (("قوتابخانە", "مدرسة", "school"), "school"),
    (("نەخۆشخانە", "مستشفى", "hospital"), "hospital"),
    (("وێزگەی بەنزین", "محطة وقود", "fuel station", "petrol station"), "fuel_station"),
    (("خواردنگە", "مطعم", "restaurant"), "restaurant"),
)


def finance_semantic_override(category: str, names: str) -> str | None:
    """Correct only high-confidence semantic conflicts in source-tagged bank/ATM records.

    OSM/Geofabrik source classes remain the primary evidence. This narrow guard
    only acts when a name explicitly describes a mutually exclusive feature,
    preventing a checkpoint, farm or military unit from being published as an ATM/bank.
    """
    if category not in {"atm", "bank", "payment_agent", "fastpay_agent"}:
        return None
    normalized = R.search_key(names).lower()
    if not normalized:
        return None
    for needles, replacement in FINANCE_RECLASSIFICATION_RULES:
        if any(R.search_key(needle).lower() in normalized for needle in needles):
            return replacement
    exact_market_names = {R.search_key(value).lower() for value in ("مارکێت", "مارکيت", "market", "سوق")}
    if normalized in exact_market_names or any(normalized and normalized.replace(marker, "") == "" for marker in exact_market_names):
        return "market"
    return None


def exact_names_from_item(item: dict[str, Any]) -> dict[str, str]:
    return {
        "ku": R.normalize_ku(item.get("n_ku")),
        "ar": R.normalize_ar(item.get("n_ar")),
        "en": R.normalize_en(item.get("n_en")),
    }


def update_search_item(feature: dict[str, Any]) -> dict[str, Any]:
    p = feature["properties"]
    x, y = feature["geometry"]["coordinates"]
    return {
        "n": p["name"],
        "q": R.join_query([p.get("search_key_ku"), p.get("search_key_ar"), p.get("search_key_en")]),
        "k": p.get("kind", "poi"),
        "c": p["category"],
        "x": x,
        "y": y,
        "s": p["id"],
        "n_ku": p.get("name_ku", ""),
        "n_ar": p.get("name_ar", ""),
        "n_en": p.get("name_en", ""),
        "c_ku": p.get("category_ku", ""),
        "c_ar": p.get("category_ar", ""),
        "c_en": p.get("category_en", ""),
        "q_ku": p.get("search_key_ku", ""),
        "q_ar": p.get("search_key_ar", ""),
        "q_en": p.get("search_key_en", ""),
        "brand": p.get("brand", ""),
        "operator": p.get("operator", ""),
        "data_release": p.get("data_release", ""),
        "language_policy": p.get("language_policy", ""),
    }


def language_item(item: dict[str, Any], lang: str) -> dict[str, Any] | None:
    name = R.clean(item.get(f"n_{lang}"))
    query = R.clean(item.get(f"q_{lang}"))
    if not name or not query:
        return None
    return dict(item)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-search", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, default=DATA / "kri-pois.geojson")
    parser.add_argument("--runtime", type=Path, default=DATA / "kri-pois-runtime.geojson")
    parser.add_argument("--search", type=Path, default=DATA / "kri-search-index.json")
    parser.add_argument("--report", type=Path, default=DATA / "kri-poi-catalog-report.json")
    args = parser.parse_args()

    release = read_json(ROOT / "release.config.json")
    labels = P.parse_taxonomy_labels(ROOT / "src" / "lib" / "atlas-taxonomy.ts")
    source_mapping = P.parse_source_mapping(ROOT / "src" / "lib" / "poi-taxonomy-classification.ts")
    baseline = read_json(args.baseline_search)
    baseline_by_id = {R.clean(item.get("s")): item for item in baseline.get("items", []) if R.clean(item.get("s"))}

    catalog = read_json(args.catalog)
    corrected = Counter()
    invalid_brand_corrections = Counter()
    official_brand_names = {brand["id"]: brand["names"] for brand in P.BRANDS}

    for feature in catalog.get("features", []):
        props = feature["properties"]
        identifier = R.clean(props.get("id"))
        source_class = R.clean(props.get("source_fclass")).lower()
        source_layer = R.clean(props.get("source_layer"))
        baseline_item = baseline_by_id.get(identifier)
        if baseline_item:
            names = exact_names_from_item(baseline_item)
            for lang in ("ku", "ar", "en"):
                if names[lang]:
                    props[f"name_{lang}"] = names[lang]

        current_category = R.clean(props.get("category"))
        brand_id = R.clean(props.get("brand"))
        display_probe = " ".join(R.clean(props.get(key)) for key in ("name_ku", "name_ar", "name_en", "name"))
        if brand_id and current_category in {
            "fastpay_agent", "korek_center", "asiacell_center", "zain_center",
            "korek_tower", "asiacell_tower", "zain_tower"
        } and not strict_brand_allowed(source_class, source_layer, display_probe, brand_id):
            if source_layer == "gis_osm_buildings_a_free":
                new_category = P.classify_building(display_probe, {}, "")
            elif source_layer == "gis_osm_landuse_a_free":
                new_category = P.classify_landuse(source_class, {})
            else:
                new_category = source_mapping.get(source_class, "tourist_attraction")
            invalid_brand_corrections[(current_category, new_category)] += 1
            props["brand"] = ""
            canonical = official_brand_names.get(brand_id, {})
            if not baseline_item:
                for lang in ("ku", "ar", "en"):
                    if R.search_key(props.get(f"name_{lang}")) == R.search_key(canonical.get(lang)):
                        props[f"name_{lang}"] = ""
            current_category = new_category

        mapped_detail = source_mapping.get(source_class)
        if mapped_detail in {
            "airport_apron", "speed_camera", "traffic_signal", "pedestrian_crossing",
            "turning_circle", "motorway_junction", "railway_crossing"
        }:
            current_category = mapped_detail

        semantic_override = finance_semantic_override(current_category, display_probe)
        if semantic_override and semantic_override in labels:
            corrected[(current_category, semantic_override)] += 1
            current_category = semantic_override
            props["brand"] = ""

        if current_category not in labels:
            current_category = source_mapping.get(source_class, "tourist_attraction")
        if current_category not in labels:
            current_category = "tourist_attraction"
        if current_category != props.get("category"):
            corrected[(props.get("category", ""), current_category)] += 1
        props["category"] = current_category
        props["fclass"] = current_category
        props["icon_id"] = current_category
        category_labels = labels[current_category]
        props["category_group"] = category_labels["group"]
        props["category_ku"] = category_labels["ku"]
        props["category_ar"] = category_labels["ar"]
        props["category_en"] = category_labels["en"]
        props["tier"] = P.candidate_tier(current_category, R.clean(props.get("kind")))
        props["minzoom"] = P.candidate_minzoom(current_category, R.clean(props.get("kind")))
        props["priority"] = round(P.CATEGORY_PRIORITY.get(current_category, 50) + float(props.get("priority", 0)) % 1, 3)
        names = {lang: R.clean(props.get(f"name_{lang}")) for lang in ("ku", "ar", "en")}
        if props.get("brand"):
            canonical = official_brand_names.get(R.clean(props.get("brand")), {})
            for lang in ("ku", "ar", "en"):
                if not names[lang]:
                    names[lang] = R.clean(canonical.get(lang))
                    props[f"name_{lang}"] = names[lang]
        if not any(names.values()):
            raw_display = R.clean(props.get("name"))
            for lang, normalize in (("ku", R.normalize_ku), ("ar", R.normalize_ar), ("en", R.normalize_en)):
                exact = normalize(raw_display)
                if exact:
                    names[lang] = exact
                    props[f"name_{lang}"] = exact
                    break
        display = names["ku"] or names["ar"] or names["en"] or R.clean(props.get("name"))
        props["name"] = display
        props["name_display"] = display
        for lang in ("ku", "ar", "en"):
            aliases = props.get(f"aliases_{lang}") if isinstance(props.get(f"aliases_{lang}"), list) else []
            values = [names[lang], *aliases, props.get("operator", ""), props.get("network", ""), category_labels[lang]]
            props[f"search_key_{lang}"] = R.join_language_query(lang, values) if names[lang] else ""
        props["search_key"] = R.join_query([props["search_key_ku"], props["search_key_ar"], props["search_key_en"]])
        props["data_release"] = release["mapDataVersion"]
        props["language_policy"] = "exact-source-backed-v3"

    catalog["version"] = release["mapDataVersion"]
    catalog["policy"] = "Source-backed, named, boundary-contained POIs/buildings/projects only; strict contextual brand classification; no machine translation or invented private-property names."
    catalog["features"].sort(key=lambda feature: (
        feature["properties"]["category"], R.search_key(feature["properties"]["name"]), feature["properties"]["id"]
    ))
    write_json(args.catalog, catalog)

    runtime_keys = {
        "id", "osm_id", "entity_kind", "kind", "source_fclass", "fclass", "category", "category_group",
        "category_ku", "category_ar", "category_en", "name", "name_ku", "name_ar", "name_en", "brand",
        "operator", "network", "icon_id", "tier", "minzoom", "priority", "data_release", "language_policy"
    }
    runtime = {
        "type": "FeatureCollection",
        "name": "NAV KURD canonical runtime POI catalog",
        "version": release["mapDataVersion"],
        "attribution": catalog.get("attribution", "© OpenStreetMap contributors"),
        "features": [
            {"type": "Feature", "geometry": feature["geometry"], "properties": {key: value for key, value in feature["properties"].items() if key in runtime_keys and value not in ("", [], None)}}
            for feature in catalog["features"]
        ],
    }
    write_json(args.runtime, runtime)

    new_items = {feature["properties"]["id"]: update_search_item(feature) for feature in catalog["features"]}
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in baseline.get("items", []):
        identifier = R.clean(item.get("s"))
        if identifier in new_items:
            items.append(new_items[identifier])
        else:
            copy = dict(item)
            baseline_probe = " ".join(R.clean(copy.get(key)) for key in ("n_ku", "n_ar", "n_en", "n"))
            baseline_category = R.clean(copy.get("c"))
            baseline_override = finance_semantic_override(baseline_category, baseline_probe)
            if baseline_override and baseline_override in labels:
                category_labels = labels[baseline_override]
                copy["c"] = baseline_override
                for lang in ("ku", "ar", "en"):
                    copy[f"c_{lang}"] = category_labels[lang]
                    exact_name = R.clean(copy.get(f"n_{lang}"))
                    copy[f"q_{lang}"] = R.join_language_query(lang, [exact_name, category_labels[lang]]) if exact_name else ""
                copy["q"] = R.join_query([copy.get("q_ku"), copy.get("q_ar"), copy.get("q_en")])
                corrected[(baseline_category, baseline_override)] += 1
            copy["data_release"] = release["mapDataVersion"]
            items.append(copy)
        if identifier:
            seen.add(identifier)
    for identifier, item in new_items.items():
        if identifier not in seen:
            items.append(item)
    reviewed_path = DATA / "kri-reviewed-poi-corrections.geojson"
    if reviewed_path.is_file():
        reviewed = read_json(reviewed_path)
        corrections = {R.clean(feature.get("properties", {}).get("replaces_source_id")): feature for feature in reviewed.get("features", [])}
        by_id = {R.clean(item.get("s")): item for item in items}
        for target_id, feature in corrections.items():
            if not target_id or target_id not in by_id:
                continue
            props = feature.get("properties", {})
            target = by_id[target_id]
            for lang in ("ku", "ar", "en"):
                value = R.clean(props.get(f"name_{lang}"))
                if value:
                    target[f"n_{lang}"] = value
                    category = target.get(f"c_{lang}", "")
                    target[f"q_{lang}"] = R.join_language_query(lang, [value, category])
            target["n"] = target.get("n_ku") or target.get("n_ar") or target.get("n_en") or target.get("n", "")
            target["q"] = R.join_query([target.get("q_ku"), target.get("q_ar"), target.get("q_en")])
    kind_order = {"place": 0, "street": 1, "poi": 2, "building": 3}
    items.sort(key=lambda item: (kind_order.get(R.clean(item.get("k")), 9), R.clean(item.get("c")), R.search_key(item.get("n")), R.clean(item.get("s"))))
    search = {
        "version": release["mapDataVersion"],
        "attribution": baseline.get("attribution", "© OpenStreetMap contributors; GeoNames CC BY 4.0"),
        "language_policy": "Exact source-backed selected-language names only; no automatic translation/transliteration and no cross-language visible fallback.",
        "source_records": len(baseline.get("items", [])),
        "published_records": len(items),
        "canonical_poi_records": len(catalog["features"]),
        "items": items,
    }
    write_json(args.search, search)

    shard_files: dict[str, dict[str, Any]] = {}
    for lang in ("ku", "ar", "en"):
        shard_items = [converted for item in items if (converted := language_item(item, lang)) is not None]
        shard = {
            "version": release["mapDataVersion"],
            "language": lang,
            "language_policy": search["language_policy"],
            "records": len(shard_items),
            "items": shard_items,
        }
        shard_path = DATA / f"kri-search-index-{lang}.json"
        write_json(shard_path, shard)
        shard_files[lang] = {"file": shard_path.name, "records": len(shard_items), "bytes": shard_path.stat().st_size, "sha256": sha256(shard_path)}

    manifest = {
        "version": release["mapDataVersion"],
        "schema": "NAV KURD exact-language search shards v3",
        "file": args.search.name,
        "fallback": args.search.name,
        "records": len(items),
        "bytes": args.search.stat().st_size,
        "sha256": sha256(args.search),
        "files": shard_files,
        "source": "OpenStreetMap/Geofabrik + GeoNames language-coded alternate names + canonical NAV KURD POI catalog",
        "coverage": "Canonical NAV KURD operational boundary",
        "language_policy": search["language_policy"],
    }
    write_json(DATA / "kri-search-index-manifest.json", manifest, compact=False)
    write_json(DATA / "kri-search-shards-manifest.json", {
        "version": release["mapDataVersion"],
        "schema": manifest["schema"],
        "files": shard_files,
        "fallback": args.search.name,
        "language_policy": search["language_policy"],
    }, compact=False)

    categories = Counter(feature["properties"]["category"] for feature in catalog["features"])
    source_layers = Counter(feature["properties"].get("source_layer", "") for feature in catalog["features"])
    exact_names = {lang: sum(1 for feature in catalog["features"] if R.clean(feature["properties"].get(f"name_{lang}"))) for lang in ("ku", "ar", "en")}
    report = {
        "schema": "NAV KURD canonical POI catalog report v2",
        "version": release["mapDataVersion"],
        "records": len(catalog["features"]),
        "search_records": len(items),
        "exact_names": exact_names,
        "categories": dict(sorted(categories.items())),
        "source_layers": dict(sorted(source_layers.items())),
        "corrections": {
            "category_changes": {f"{old or 'empty'}->{new}": count for (old, new), count in sorted(corrected.items())},
            "invalid_context_brand_changes": {f"{old}->{new}": count for (old, new), count in sorted(invalid_brand_corrections.items())},
        },
        "files": {
            "catalog": {"file": args.catalog.name, "bytes": args.catalog.stat().st_size, "sha256": sha256(args.catalog)},
            "runtime": {"file": args.runtime.name, "bytes": args.runtime.stat().st_size, "sha256": sha256(args.runtime)},
            "search": {"file": args.search.name, "bytes": args.search.stat().st_size, "sha256": sha256(args.search)},
        },
        "source_policy": {
            "kurdish": "OSM name:ckb/name:ku, clearly Kurdish source text, verified exact-language corpus, and reviewed official service-brand spellings only.",
            "unnamed": "Excluded from the published canonical POI/search catalog.",
            "private_land": "Never inferred; only explicitly source-private named records may use private_property.",
            "brand": "Telecom/payment brand classification requires a matching service context; ordinary schools, fuel stations, cafes and place names are never reclassified only because a person/place name resembles a brand.",
            "boundary": "Canonical operational application boundary; not a legal or cadastral certification.",
        },
    }
    write_json(args.report, report, compact=False)
    print(json.dumps({
        "records": len(catalog["features"]), "search": len(items), "exact_names": exact_names,
        "invalid_brand_corrections": sum(invalid_brand_corrections.values()), "detailed_class_changes": sum(corrected.values()),
        "top_categories": categories.most_common(25), "shards": {lang: data["records"] for lang, data in shard_files.items()},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
