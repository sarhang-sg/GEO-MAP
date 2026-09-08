#!/usr/bin/env python3
"""Build the canonical NAV KURD POI catalog from supplied OSM/Geofabrik sources.

The catalog is the single source for static map POIs, search, category-specific
icons and offline vector tiles. It is deliberately conservative:
- only source-backed records inside the canonical operational boundary;
- no machine translation or invented owner/place names;
- unnamed/private agricultural polygons are excluded unless the source itself
  supplies a meaningful name or explicit private-access identity;
- duplicate point/area/building identities are merged deterministically;
- exact Kurdish names come from OSM name:ckb/name:ku or clearly Kurdish source
  text, with a tiny reviewed brand dictionary for official service brands.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
from shapely.geometry import Point, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data" / "kri"


def load_rebuild_module():
    module_path = ROOT / "tools" / "data" / "rebuild-canonical-data.py"
    spec = importlib.util.spec_from_file_location("nav_kurd_rebuild", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


R = load_rebuild_module()

LAYER_SPECS = (
    # layer, source kind, semantic priority, output kind
    ("gis_osm_pois_free", "node", 100, "poi"),
    ("gis_osm_pofw_free", "node", 98, "poi"),
    ("gis_osm_transport_free", "node", 96, "poi"),
    ("gis_osm_traffic_free", "node", 94, "poi"),
    ("gis_osm_pois_a_free", "way", 92, "poi"),
    ("gis_osm_pofw_a_free", "way", 90, "poi"),
    ("gis_osm_transport_a_free", "way", 88, "poi"),
    ("gis_osm_traffic_a_free", "way", 86, "poi"),
    ("gis_osm_buildings_a_free", "way", 55, "building"),
    ("gis_osm_landuse_a_free", "way", 45, "poi"),
)

# Area classes that add real named projects/zones instead of anonymous land cover.
LANDUSE_ALLOWED = {
    "residential", "industrial", "commercial", "retail", "military",
    "farmland", "farmyard", "orchard", "vineyard", "cemetery", "park",
    "recreation_ground", "landfill", "quarry", "forest",
}

# Important classes are retained for evidence lookup even when the GeoPackage
# default name is empty. They are still published only if exact source evidence
# yields a meaningful name/operator/brand.
ESSENTIAL_UNNAMED_EVIDENCE_CLASSES = {
    "atm", "bank", "comms_tower", "airport", "airfield", "helipad",
    "bus_station", "railway_station", "fuel", "dam", "water_tower",
}

BAD_NAME_RE = re.compile(
    r"^(?:site|building|block|plot|parcel|shop|store|office|project|test|fake|unknown|unnamed|no\s*name)\s*[-_#]?\s*\d*$",
    re.IGNORECASE,
)
ONLY_CODE_RE = re.compile(r"^[A-Za-z]?\d{1,4}[A-Za-z]?$", re.IGNORECASE)
PERSONAL_PROPERTY_HINT_RE = re.compile(r"\b(?:farm|orchard|garden|property|estate|land)\b", re.IGNORECASE)

BRANDS = (
    {
        "id": "fastpay",
        "patterns": ("fastpay", "fast pay", "فاست پەی", "فاست‌پەی", "فاست باي", "فاستباي"),
        "center_type": "fastpay_agent",
        "tower_type": None,
        "names": {"ku": "فاست‌پەی", "ar": "فاست باي", "en": "FastPay"},
    },
    {
        "id": "korek",
        "patterns": ("korek", "کۆڕەک", "کۆرەک", "كورك"),
        "center_type": "korek_center",
        "tower_type": "korek_tower",
        "names": {"ku": "کۆڕەک", "ar": "كورك", "en": "Korek"},
    },
    {
        "id": "asiacell",
        "patterns": ("asiacell", "asia cell", "ئاسیاسێڵ", "ئاسیا سێڵ", "آسياسيل", "اسياسيل"),
        "center_type": "asiacell_center",
        "tower_type": "asiacell_tower",
        "names": {"ku": "ئاسیاسێڵ", "ar": "آسياسيل", "en": "Asiacell"},
    },
    {
        "id": "zain",
        "patterns": ("zain", "زەین", "زين"),
        "center_type": "zain_center",
        "tower_type": "zain_tower",
        "names": {"ku": "زەین", "ar": "زين", "en": "Zain"},
    },
)

CATEGORY_PRIORITY = {
    "airport": 100, "airfield": 98, "hospital": 95, "university": 94,
    "bank": 92, "atm": 90, "fastpay_agent": 90, "payment_agent": 88,
    "korek_center": 88, "asiacell_center": 88, "zain_center": 88,
    "korek_tower": 86, "asiacell_tower": 86, "zain_tower": 86,
    "telecom_tower": 84, "fuel_station": 82, "bus_station": 80,
    "railway_station": 80, "car_showroom": 76, "swimming_pool": 74,
    "mall": 78, "stadium": 76, "police_station": 77, "military_base": 80,
    "residential_compound": 68, "industrial_zone": 66, "commercial_building": 64,
    "building": 40,
}

LANDMARK_TYPES = {
    "airport", "airfield", "hospital", "university", "college", "mall", "stadium",
    "bank", "military_base", "government_office", "tourist_attraction", "archaeological_site",
    "telecom_tower", "korek_tower", "asiacell_tower", "zain_tower",
}
COMMUNITY_TYPES = {
    "school", "kindergarten", "clinic", "pharmacy", "supermarket", "market", "fuel_station",
    "bus_station", "railway_station", "police_station", "fire_station", "restaurant", "hotel",
    "car_showroom", "swimming_pool", "fastpay_agent", "payment_agent", "korek_center",
    "asiacell_center", "zain_center", "mobile_operator", "residential_compound", "industrial_zone",
}


@dataclass
class Candidate:
    source_kind: str
    osm_id: str
    source_layer: str
    source_fclass: str
    raw_name: str
    point: Point
    semantic_priority: int
    output_kind: str
    row_type: str = ""
    names: dict[str, str] = field(default_factory=lambda: {"ku": "", "ar": "", "en": ""})
    aliases: dict[str, list[str]] = field(default_factory=lambda: {"ku": [], "ar": [], "en": []})
    tags: dict[str, str] = field(default_factory=dict)
    category: str = ""
    brand: str = ""

    @property
    def source_id(self) -> str:
        suffix = self.source_fclass or self.category or self.output_kind
        return f"osm-{self.source_kind}-{self.osm_id}-{suffix}"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(value, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")


def parse_taxonomy_labels(path: Path) -> dict[str, dict[str, str]]:
    source = path.read_text(encoding="utf-8")
    pattern = re.compile(r'\{ id: "([^"]+)", group: "([^"]+)", label: \{ ku: "([^"]*)", ar: "([^"]*)", en: "([^"]*)" \}, aliases: \[[^\]]*\] \}')
    return {m.group(1): {"group": m.group(2), "ku": m.group(3), "ar": m.group(4), "en": m.group(5)} for m in pattern.finditer(source)}


def parse_source_mapping(path: Path) -> dict[str, str]:
    source = path.read_text(encoding="utf-8")
    block = source.split("export const POI_SOURCE_CLASS_TO_TAXONOMY = {", 1)[1].split("} as const", 1)[0]
    return {a: b for a, b in re.findall(r'"([^"]+)": "([^"]+)"', block)}


def meaningful_name(value: Any) -> bool:
    text = R.clean(value)
    if not R.meaningful(text):
        return False
    normalized = R.search_key(text)
    if BAD_NAME_RE.match(text) or ONLY_CODE_RE.match(text):
        return False
    if len(normalized) <= 1:
        return False
    if normalized in {"site", "building", "project", "plot", "parcel", "block", "private", "property"}:
        return False
    return True


def _brand_pattern_matches(text: str, pattern: str) -> bool:
    normalized_text = R.search_key(text).lower()
    normalized_pattern = R.search_key(pattern).lower()
    if not normalized_text or not normalized_pattern:
        return False
    # Token-aware matching prevents personal/place names such as Zainab from
    # being reclassified as the Zain mobile operator.
    tokens = re.findall(r"[\w\u0600-\u06ff]+", normalized_text, flags=re.UNICODE)
    pattern_tokens = re.findall(r"[\w\u0600-\u06ff]+", normalized_pattern, flags=re.UNICODE)
    if not pattern_tokens:
        return False
    if len(pattern_tokens) == 1:
        return pattern_tokens[0] in tokens
    width = len(pattern_tokens)
    return any(tokens[index:index + width] == pattern_tokens for index in range(len(tokens) - width + 1))


def brand_for(texts: Iterable[str]) -> dict[str, Any] | None:
    values = [R.clean(value) for value in texts if R.clean(value)]
    for brand in BRANDS:
        if any(_brand_pattern_matches(value, pattern) for value in values for pattern in brand["patterns"]):
            return brand
    return None


def brand_allowed(candidate: Candidate, brand: dict[str, Any]) -> bool:
    source_class = candidate.source_fclass.lower()
    name = R.search_key(candidate.raw_name).lower()
    tags = candidate.tags
    explicit_network = brand_for([tags.get("brand", ""), tags.get("operator", ""), tags.get("network", "")])
    if explicit_network and explicit_network["id"] == brand["id"]:
        return True
    if brand["id"] == "fastpay":
        return source_class in {"atm", "bank", "kiosk", "convenience", "mobile_phone_shop"} or (
            candidate.source_layer == "gis_osm_buildings_a_free" and any(value in name for value in ("fastpay", "fast pay", "فاست"))
        )
    if source_class == "comms_tower":
        return True
    if source_class == "mobile_phone_shop":
        return True
    if candidate.source_layer == "gis_osm_buildings_a_free":
        center_words = ("center", "centre", "office", "branch", "company", "service", "shop", "store", "سەنتەر", "ناوەند", "مکتب", "فرع", "شركة")
        brand_name_only = any(_brand_pattern_matches(candidate.raw_name, pattern) for pattern in brand["patterns"])
        return brand_name_only and (any(word in name for word in center_words) or len(name.split()) <= 2)
    return False


def classify_building(raw_name: str, tags: dict[str, str], row_type: str) -> str:
    hay = " ".join([raw_name, tags.get("building", ""), tags.get("amenity", ""), tags.get("shop", ""), tags.get("office", ""), row_type]).lower()
    rules = (
        (("mall", "shopping centre", "shopping center", "مۆڵ", "مول"), "mall"),
        (("hospital", "نەخۆشخان", "مستشفى"), "hospital"),
        (("school", "قوتابخان", "مدرسة"), "school"),
        (("university", "زانکۆ", "جامعة"), "university"),
        (("hotel", "هوتێل", "فندق"), "hotel"),
        (("tower", "بورج", "برج"), "tower"),
        (("compound", "residential", "کۆمپاوند", "مجمع سكني", "project", "پڕۆژە"), "residential_compound"),
        (("office", "company", "کۆمپانیا", "شركة"), "office_building"),
        (("commercial", "بازرگانی", "تجاري"), "commercial_building"),
        (("construction", "under construction", "پڕۆژەی بیناسازی", "قيد الإنشاء"), "construction_site"),
    )
    for needles, category in rules:
        if any(value in hay for value in needles):
            return category
    building = R.clean(tags.get("building") or row_type).lower()
    return {
        "apartments": "apartment_building", "residential": "apartment_building", "house": "house",
        "villa": "villa", "commercial": "commercial_building", "office": "office_building",
        "industrial": "industrial_zone", "construction": "construction_site", "farm": "farmhouse",
    }.get(building, "building")


def classify_landuse(fclass: str, tags: dict[str, str]) -> str:
    return {
        "residential": "residential_compound",
        "industrial": "industrial_zone",
        "commercial": "commercial_building",
        "retail": "market",
        "military": "military_base",
        "farmland": "farmland",
        "farmyard": "farm",
        "orchard": "orchard",
        "vineyard": "orchard",
        "cemetery": "cemetery",
        "park": "park",
        "recreation_ground": "sports_center",
        "landfill": "landfill",
        "quarry": "quarry",
        "forest": "forest",
    }.get(fclass, "")


def classify(candidate: Candidate, source_mapping: dict[str, str]) -> str:
    tags = candidate.tags
    texts = [candidate.raw_name, *candidate.names.values(), tags.get("brand", ""), tags.get("operator", ""), tags.get("network", "")]
    brand = next((item for item in BRANDS if item["id"] == candidate.brand), None)
    source_class = candidate.source_fclass.lower()
    if brand:
        if source_class == "comms_tower" or tags.get("tower:type") in {"communication", "communications"}:
            return brand.get("tower_type") or "telecom_tower"
        return brand.get("center_type") or source_mapping.get(source_class, "mobile_operator")
    if candidate.source_layer == "gis_osm_buildings_a_free":
        return classify_building(candidate.raw_name, tags, candidate.row_type)
    if candidate.source_layer == "gis_osm_landuse_a_free":
        return classify_landuse(source_class, tags)
    mapped = source_mapping.get(source_class, "")
    if mapped == "bank" and any(word in " ".join(texts).lower() for word in ("hawala", "حوالة", "حەواڵە", "money transfer")):
        return "money_transfer"
    return mapped or "tourist_attraction"


def candidate_minzoom(category: str, output_kind: str) -> float:
    if category in LANDMARK_TYPES:
        return 8.4
    if category in COMMUNITY_TYPES:
        return 10.2
    if output_kind == "building":
        return 13.0
    return 11.6


def candidate_tier(category: str, output_kind: str) -> str:
    if category in LANDMARK_TYPES:
        return "landmark"
    if category in COMMUNITY_TYPES:
        return "community"
    return "local" if output_kind != "building" else "local"




def existing_search_evidence(search_path: Path) -> dict[tuple[str, str], Any]:
    """Reuse the already verified exact-language search corpus as POI name evidence."""
    payload = read_json(search_path)
    output: dict[tuple[str, str], Any] = {}
    for item in payload.get("items", []):
        identifier = R.clean(item.get("s"))
        match = re.match(r"osm-(node|way)-(\d+)-", identifier)
        if match:
            key = (match.group(1), match.group(2))
        elif identifier.startswith("building-") and identifier[9:].isdigit():
            key = ("way", identifier[9:])
        else:
            continue
        evidence = R.NameEvidence(
            names={"ku": R.normalize_ku(item.get("n_ku")), "ar": R.normalize_ar(item.get("n_ar")), "en": R.normalize_en(item.get("n_en"))},
            aliases={"ku": [], "ar": [], "en": []},
            tags={},
        )
        output.setdefault(key, R.NameEvidence()).merge(evidence)
    return output

def load_poi_osm_evidence(needed: dict[str, set[str]], bbox: tuple[float, float, float, float]) -> dict[tuple[str, str], Any]:
    """Scan only OSM point and multipolygon layers needed by the POI catalog."""
    import pyogrio
    output: dict[tuple[str, str], Any] = {}
    specs = [
        ("points", "node", ["osm_id", "name", "barrier", "highway", "place", "man_made", "other_tags"]),
        ("multipolygons", "way", ["osm_id", "osm_way_id", "name", "type", "aeroway", "amenity", "barrier", "building", "craft", "historic", "landuse", "leisure", "man_made", "military", "natural", "office", "place", "shop", "sport", "tourism", "other_tags"]),
    ]
    for layer, kind, columns in specs:
        print(f"Scanning OSM {layer} for {len(needed[kind]):,} catalog {kind} identities", flush=True)
        frame = pyogrio.read_dataframe(str(R.PBF), layer=layer, bbox=bbox, columns=columns, read_geometry=False)
        for row in frame.to_dict("records"):
            ids: set[str] = set()
            for key in ("osm_id", "osm_way_id"):
                value = R.clean(row.get(key)).lstrip("-")
                if value.isdigit() and value in needed[kind]:
                    ids.add(value)
            if not ids:
                continue
            tags = R.parse_tags(row.get("other_tags"))
            for key in ("barrier", "highway", "place", "man_made", "aeroway", "amenity", "building", "craft", "historic", "landuse", "leisure", "military", "natural", "office", "shop", "sport", "tourism", "type"):
                value = R.clean(row.get(key))
                if value:
                    tags.setdefault(key, value)
            exact = R.exact_osm_names(tags)
            evidence = R.NameEvidence(names=exact, tags=tags)
            for lang in ("ku", "ar", "en"):
                evidence.aliases[lang] = R.exact_osm_aliases(tags, lang)
            raw_name = R.clean(row.get("name"))
            if not evidence.names["en"] and R.normalize_en(raw_name):
                evidence.names["en"] = R.normalize_en(raw_name)
            for osm_id in ids:
                output.setdefault((kind, osm_id), R.NameEvidence()).merge(evidence)
        del frame
    return output

def collect_candidates(gpkg: Path, boundary) -> tuple[list[Candidate], list[dict[str, Any]]]:
    prepared = prep(boundary)
    candidates: list[Candidate] = []
    quarantine: list[dict[str, Any]] = []
    for layer, source_kind, priority, output_kind in LAYER_SPECS:
        columns = ["osm_id", "fclass", "name"]
        if layer == "gis_osm_buildings_a_free":
            columns.append("type")
        frame = gpd.read_file(gpkg, layer=layer, bbox=boundary.bounds, engine="pyogrio", columns=columns)
        frame = frame[frame.geometry.notna() & ~frame.geometry.is_empty].copy()
        points = frame.geometry if frame.geometry.geom_type.eq("Point").all() else frame.geometry.representative_point()
        inside_mask = [prepared.covers(point) for point in points]
        frame = frame.loc[inside_mask].copy()
        points = points.loc[inside_mask]
        for (index, row), point in zip(frame.iterrows(), points):
            osm_id = R.clean(row.get("osm_id")).lstrip("-")
            if not osm_id.isdigit():
                continue
            fclass = R.clean(row.get("fclass")).lower()
            raw_name = R.clean(row.get("name"))
            if layer == "gis_osm_landuse_a_free" and fclass not in LANDUSE_ALLOWED:
                continue
            if not meaningful_name(raw_name) and fclass not in ESSENTIAL_UNNAMED_EVIDENCE_CLASSES:
                quarantine.append({
                    "id": f"osm-{source_kind}-{osm_id}-{fclass or output_kind}", "reason": "unnamed-or-generic-source-record",
                    "source_layer": layer, "fclass": fclass, "coordinate": [round(point.x, 6), round(point.y, 6)],
                })
                continue
            candidates.append(Candidate(
                source_kind=source_kind,
                osm_id=osm_id,
                source_layer=layer,
                source_fclass=fclass,
                raw_name=raw_name,
                point=point,
                semantic_priority=priority,
                output_kind=output_kind,
                row_type=R.clean(row.get("type")),
            ))
        print(f"{layer}: {len(frame):,} inside, {sum(1 for c in candidates if c.source_layer == layer):,} candidates", flush=True)
    return candidates, quarantine


def merge_source_candidates(candidates: list[Candidate]) -> list[Candidate]:
    grouped: dict[tuple[str, str], list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        grouped[(candidate.source_kind, candidate.osm_id)].append(candidate)
    merged: list[Candidate] = []
    for values in grouped.values():
        values.sort(key=lambda item: (item.semantic_priority, meaningful_name(item.raw_name), len(item.raw_name)), reverse=True)
        winner = values[0]
        for other in values[1:]:
            if not winner.raw_name and other.raw_name:
                winner.raw_name = other.raw_name
            winner.semantic_priority = max(winner.semantic_priority, other.semantic_priority)
            if winner.output_kind == "building" and other.output_kind == "poi":
                winner.output_kind = "poi"
        merged.append(winner)
    return merged


def exact_name_from_raw(raw: str) -> dict[str, str]:
    return {
        "ku": R.normalize_ku(raw),
        "ar": R.normalize_ar(raw),
        "en": R.normalize_en(raw),
    }


def apply_evidence(candidate: Candidate, evidence: Any) -> None:
    candidate.tags = dict(evidence.tags)
    raw_exact = exact_name_from_raw(candidate.raw_name)
    for lang in ("ku", "ar", "en"):
        sourced = {"ku": R.normalize_ku, "ar": R.normalize_ar, "en": R.normalize_en}[lang](evidence.names.get(lang))
        candidate.names[lang] = sourced or raw_exact[lang]
        aliases = [*evidence.aliases.get(lang, [])]
        if raw_exact[lang] and R.search_key(raw_exact[lang]) != R.search_key(candidate.names[lang]):
            aliases.append(raw_exact[lang])
        candidate.aliases[lang] = R.unique(value for value in aliases if meaningful_name(value))
    brand = brand_for([candidate.raw_name, *candidate.names.values(), candidate.tags.get("brand", ""), candidate.tags.get("operator", ""), candidate.tags.get("network", "")])
    if brand and brand_allowed(candidate, brand):
        candidate.brand = brand["id"]
        for lang in ("ku", "ar", "en"):
            if not candidate.names[lang]:
                candidate.names[lang] = brand["names"][lang]
            candidate.aliases[lang] = R.unique([*candidate.aliases[lang], brand["names"][lang]])


def explicit_private(candidate: Candidate) -> bool:
    tags = candidate.tags
    return any(R.clean(tags.get(key)).lower() in {"private", "yes"} for key in ("access", "ownership", "private"))


def dedupe_semantic(candidates: list[Candidate]) -> tuple[list[Candidate], list[dict[str, Any]]]:
    kept: list[Candidate] = []
    quarantine: list[dict[str, Any]] = []
    grid: dict[tuple[str, str, int, int], list[Candidate]] = defaultdict(list)
    for candidate in sorted(candidates, key=lambda item: (CATEGORY_PRIORITY.get(item.category, 50), item.semantic_priority, len(item.raw_name)), reverse=True):
        best_name = candidate.names["ku"] or candidate.names["ar"] or candidate.names["en"] or candidate.raw_name
        key_name = R.search_key(best_name)
        if not key_name:
            continue
        gx, gy = round(candidate.point.x * 10000), round(candidate.point.y * 10000)
        duplicate: Candidate | None = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for other in grid.get((candidate.category, key_name, gx + dx, gy + dy), []):
                    if candidate.point.distance(other.point) <= 0.00022:  # roughly <= 24 m
                        duplicate = other
                        break
                if duplicate:
                    break
            if duplicate:
                break
        if duplicate:
            quarantine.append({
                "id": candidate.source_id,
                "reason": "near-duplicate-name-category",
                "survivor_id": duplicate.source_id,
                "category": candidate.category,
                "name": best_name,
                "coordinate": [round(candidate.point.x, 6), round(candidate.point.y, 6)],
            })
            continue
        kept.append(candidate)
        grid[(candidate.category, key_name, gx, gy)].append(candidate)
    return kept, quarantine


def feature_from_candidate(candidate: Candidate, labels: dict[str, dict[str, str]], release: dict[str, Any]) -> dict[str, Any]:
    category_labels = labels.get(candidate.category, {"ku": "شوێنی گرنگ", "ar": "نقطة اهتمام", "en": candidate.category.replace("_", " ").title(), "group": ""})
    display_name = candidate.names["ku"] or candidate.names["ar"] or candidate.names["en"] or candidate.raw_name
    props: dict[str, Any] = {
        "id": candidate.source_id,
        "osm_id": candidate.osm_id,
        "entity_kind": candidate.source_kind,
        "kind": candidate.output_kind,
        "source_layer": candidate.source_layer,
        "source_fclass": candidate.source_fclass,
        "fclass": candidate.category,
        "category": candidate.category,
        "category_group": category_labels.get("group", ""),
        "category_ku": category_labels.get("ku", ""),
        "category_ar": category_labels.get("ar", ""),
        "category_en": category_labels.get("en", ""),
        "name": display_name,
        "name_display": display_name,
        "name_ku": candidate.names["ku"],
        "name_ar": candidate.names["ar"],
        "name_en": candidate.names["en"],
        "aliases_ku": candidate.aliases["ku"],
        "aliases_ar": candidate.aliases["ar"],
        "aliases_en": candidate.aliases["en"],
        "brand": candidate.brand,
        "operator": R.clean(candidate.tags.get("operator")),
        "network": R.clean(candidate.tags.get("network")),
        "phone": R.clean(candidate.tags.get("phone") or candidate.tags.get("contact:phone")),
        "website": R.clean(candidate.tags.get("website") or candidate.tags.get("contact:website")),
        "opening_hours": R.clean(candidate.tags.get("opening_hours")),
        "access": R.clean(candidate.tags.get("access")),
        "icon_id": candidate.category,
        "tier": candidate_tier(candidate.category, candidate.output_kind),
        "minzoom": candidate_minzoom(candidate.category, candidate.output_kind),
        "priority": CATEGORY_PRIORITY.get(candidate.category, 50) + candidate.semantic_priority / 1000,
        "source": "OpenStreetMap data via Geofabrik Iraq extract",
        "source_date": release["sourceDate"],
        "last_reviewed": release["reviewDate"],
        "data_release": release["mapDataVersion"],
        "language_policy": "exact-source-backed-v2",
        "qa_inside_coverage_boundary": True,
    }
    for lang in ("ku", "ar", "en"):
        values = [props[f"name_{lang}"], *props[f"aliases_{lang}"], props[f"category_{lang}"], props["brand"], props["operator"]]
        props[f"search_key_{lang}"] = R.join_language_query(lang, values) if props[f"name_{lang}"] else ""
    props["search_key"] = R.join_query([props["search_key_ku"], props["search_key_ar"], props["search_key_en"]])
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(candidate.point.x, 7), round(candidate.point.y, 7)]},
        "properties": props,
    }


def search_item(feature: dict[str, Any]) -> dict[str, Any]:
    props = feature["properties"]
    coords = feature["geometry"]["coordinates"]
    item = {
        "n": props["name"],
        "q": R.join_query([props.get("search_key_ku"), props.get("search_key_ar"), props.get("search_key_en")]),
        "k": props.get("kind", "poi"),
        "c": props["category"],
        "x": coords[0], "y": coords[1], "s": props["id"],
        "n_ku": props.get("name_ku", ""), "n_ar": props.get("name_ar", ""), "n_en": props.get("name_en", ""),
        "c_ku": props.get("category_ku", ""), "c_ar": props.get("category_ar", ""), "c_en": props.get("category_en", ""),
        "q_ku": props.get("search_key_ku", ""), "q_ar": props.get("search_key_ar", ""), "q_en": props.get("search_key_en", ""),
        "brand": props.get("brand", ""), "operator": props.get("operator", ""),
        "data_release": props.get("data_release", ""), "language_policy": props.get("language_policy", ""),
    }
    return item


def update_search(features: list[dict[str, Any]], path: Path, *, build_shards: bool = True) -> dict[str, Any]:
    original = read_json(path)
    new_items = {feature["properties"]["id"]: search_item(feature) for feature in features}
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    # Replace all matching canonical OSM identities. Keep natural/security and
    # any source-backed record not represented in the expanded catalog.
    for item in original.get("items", []):
        identifier = R.clean(item.get("s"))
        if identifier in new_items:
            output.append(new_items[identifier])
            seen.add(identifier)
        else:
            output.append(item)
            if identifier:
                seen.add(identifier)
    for identifier, item in new_items.items():
        if identifier not in seen:
            output.append(item)
    kind_order = {"place": 0, "street": 1, "poi": 2, "building": 3}
    output.sort(key=lambda item: (kind_order.get(R.clean(item.get("k")), 9), R.clean(item.get("c")), R.search_key(item.get("n")), R.clean(item.get("s"))))
    payload = {
        "version": R.MAP_DATA_VERSION,
        "attribution": "© OpenStreetMap contributors; GeoNames CC BY 4.0; Iraq administrative boundary source",
        "language_policy": "Exact source-backed selected-language names only; no automatic translation/transliteration and no cross-language visible fallback.",
        "source_records": len(original.get("items", [])),
        "published_records": len(output),
        "canonical_poi_records": len(features),
        "items": output,
    }
    write_json(path, payload)
    if build_shards:
        R.DATA = DATA
        R.build_shards(payload)
    return payload


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gpkg", type=Path, required=True)
    parser.add_argument("--osm-pbf", type=Path, required=True)
    parser.add_argument("--boundary", type=Path, default=DATA / "kri-boundary.geojson")
    parser.add_argument("--output", type=Path, default=DATA / "kri-pois.geojson")
    parser.add_argument("--quarantine", type=Path, default=DATA / "kri-poi-quarantine.json")
    parser.add_argument("--report", type=Path, default=DATA / "kri-poi-catalog-report.json")
    parser.add_argument("--search", type=Path, default=DATA / "kri-search-index.json")
    parser.add_argument("--evidence-search", type=Path, default=None, help="Verified pre-expansion search corpus used for exact-language evidence.")
    parser.add_argument("--skip-shards", action="store_true", help="Write the full search index only; build language shards separately.")
    args = parser.parse_args()

    release_config = read_json(ROOT / "release.config.json")
    release = {
        "mapDataVersion": release_config["mapDataVersion"],
        "sourceDate": "2026-07-13",
        "reviewDate": "2026-07-17",
    }
    R.PBF = args.osm_pbf.resolve()
    R.GPKG = args.gpkg.resolve()
    R.DATA = DATA
    R.CACHE_DIR = ROOT / ".build-cache"

    boundary_collection = read_json(args.boundary)
    boundary = unary_union([shape(feature["geometry"]) for feature in boundary_collection.get("features", []) if feature.get("geometry")])
    if boundary.is_empty:
        raise RuntimeError("Canonical boundary is empty")

    labels = parse_taxonomy_labels(ROOT / "src/lib/atlas-taxonomy.ts")
    source_mapping = parse_source_mapping(ROOT / "src/lib/poi-taxonomy-classification.ts")

    candidates, quarantine = collect_candidates(args.gpkg, boundary)
    candidates = merge_source_candidates(candidates)
    evidence = existing_search_evidence(args.evidence_search or args.search)
    print(f"Loaded {len(evidence):,} exact-language POI identities from the verified search corpus", flush=True)

    published_candidates: list[Candidate] = []
    for index, candidate in enumerate(candidates, 1):
        if index % 5000 == 0:
            print(f"Classified {index:,}/{len(candidates):,} candidates", flush=True)
        apply_evidence(candidate, evidence.get((candidate.source_kind, candidate.osm_id), R.NameEvidence()))
        candidate.category = classify(candidate, source_mapping)
        if not candidate.category or candidate.category not in labels:
            quarantine.append({"id": candidate.source_id, "reason": "unmapped-category", "fclass": candidate.source_fclass, "source_layer": candidate.source_layer})
            continue
        if not any(meaningful_name(candidate.names[lang]) for lang in ("ku", "ar", "en")):
            quarantine.append({
                "id": candidate.source_id, "reason": "no-meaningful-source-name", "fclass": candidate.source_fclass,
                "source_layer": candidate.source_layer, "coordinate": [round(candidate.point.x, 6), round(candidate.point.y, 6)],
            })
            continue
        # Never call anonymous farmland/orchards private. If source explicitly
        # marks a named record private, preserve that fact as a specific category.
        if candidate.category in {"farm", "farmland", "orchard", "farmhouse"} and explicit_private(candidate):
            candidate.category = "private_property"
        published_candidates.append(candidate)

    print(f"Classification complete: {len(published_candidates):,} publishable before semantic dedupe", flush=True)
    published_candidates, duplicate_quarantine = dedupe_semantic(published_candidates)
    print(f"Semantic dedupe complete: {len(published_candidates):,} retained", flush=True)
    quarantine.extend(duplicate_quarantine)
    features = [feature_from_candidate(candidate, labels, release) for candidate in published_candidates]
    print(f"Feature serialization complete: {len(features):,}", flush=True)
    features.sort(key=lambda feature: (
        feature["properties"]["category"],
        R.search_key(feature["properties"]["name"]),
        feature["properties"]["id"],
    ))

    catalog = {
        "type": "FeatureCollection",
        "name": "NAV KURD canonical named POI catalog",
        "version": release["mapDataVersion"],
        "attribution": "© OpenStreetMap contributors; Geofabrik Iraq extract",
        "policy": "Source-backed, named, boundary-contained POIs/buildings/projects only; no machine translation or invented private-property names.",
        "features": features,
    }
    write_json(args.output, catalog)
    quarantine.sort(key=lambda item: (R.clean(item.get("reason")), R.clean(item.get("id"))))
    write_json(args.quarantine, {
        "schema": "NAV KURD canonical POI quarantine v1",
        "version": release["mapDataVersion"],
        "records": len(quarantine),
        "items": quarantine,
    }, compact=False)

    print("Updating canonical search index and exact-language shards", flush=True)
    search = update_search(features, args.search, build_shards=not args.skip_shards)
    print("Search index and shards updated", flush=True)
    categories = Counter(feature["properties"]["category"] for feature in features)
    source_layers = Counter(feature["properties"]["source_layer"] for feature in features)
    exact = {
        lang: sum(1 for feature in features if meaningful_name(feature["properties"].get(f"name_{lang}")))
        for lang in ("ku", "ar", "en")
    }
    report = {
        "schema": "NAV KURD canonical POI catalog report v1",
        "version": release["mapDataVersion"],
        "records": len(features),
        "search_records": len(search.get("items", [])),
        "quarantined": len(quarantine),
        "exact_names": exact,
        "categories": dict(sorted(categories.items())),
        "source_layers": dict(sorted(source_layers.items())),
        "files": {
            "catalog": {"file": args.output.name, "bytes": args.output.stat().st_size, "sha256": sha256(args.output)},
            "quarantine": {"file": args.quarantine.name, "bytes": args.quarantine.stat().st_size, "sha256": sha256(args.quarantine)},
            "search": {"file": args.search.name, "bytes": args.search.stat().st_size, "sha256": sha256(args.search)},
        },
        "source_policy": {
            "kurdish": "OSM name:ckb/name:ku, clearly Kurdish source text, and reviewed official brand spellings only.",
            "unnamed": "Excluded from published search/map POI catalog.",
            "private_land": "Never inferred. Only explicit source-private named records may become private_property.",
            "boundary": "Canonical operational application boundary; not a legal or cadastral certification.",
        },
    }
    write_json(args.report, report, compact=False)
    print(json.dumps({"records": len(features), "quarantined": len(quarantine), "exact": exact, "search": len(search.get("items", [])), "top_categories": categories.most_common(20)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
