#!/usr/bin/env python3
"""Rebuild NAV KURD exact-language/search/security metadata from supplied sources.

This developer-side build tool is intentionally conservative:
- it never machine-translates or machine-transliterates Kurdish/Arabic place names;
- it keeps existing source-backed reviewed names and enriches them only from
  explicit OSM language tags or GeoNames language-coded alternate names;
- unresolved names stay empty and are reported for review;
- security/checkpoint records are source-derived and generic/duplicate records
  are quarantined instead of receiving invented names.

Large source datasets are not copied into the application repository. Supply
paths through the environment variables documented below when rebuilding.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import unicodedata
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
import pyogrio
from shapely.geometry import Point, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data" / "kri"
QUARANTINE = ROOT / "data-src" / "quarantine"
DATA_QUALITY_QUARANTINE = QUARANTINE / "kri-data-quality-quarantine.json"
DEFAULT_INPUT_DIR = ROOT / ".data-inputs"
CACHE_DIR = Path(os.environ.get("NAV_KURD_BUILD_CACHE", str(ROOT / ".build-cache")))
PBF = Path(os.environ.get("NAV_KURD_OSM_PBF", str(DEFAULT_INPUT_DIR / "iraq-260713.osm.pbf")))
GPKG = Path(os.environ.get("NAV_KURD_GPKG", str(DEFAULT_INPUT_DIR / "iraq.gpkg")))
GEONAMES_IQ = Path(os.environ.get("NAV_KURD_GEONAMES_IQ", str(DEFAULT_INPUT_DIR / "IQ.txt")))
GEONAMES_ALT = Path(os.environ.get("NAV_KURD_GEONAMES_ALT", str(DEFAULT_INPUT_DIR / "alternateNamesV2.txt")))
ADMIN_GDB = Path(os.environ.get("NAV_KURD_ADMIN_GDB", str(DEFAULT_INPUT_DIR / "irq_admin_boundaries.gdb")))
REVIEWED_POI_CORRECTIONS = DATA / "kri-reviewed-poi-corrections.geojson"

# Release identity is owned by release.config.json. The data rebuild must never
# silently downgrade the app/cache version through stale constants.
_RELEASE_CONFIG = json.loads((ROOT / "release.config.json").read_text(encoding="utf-8"))
APP_VERSION = str(_RELEASE_CONFIG["appVersion"])
RELEASE_ID = str(_RELEASE_CONFIG["releaseId"])
MAP_DATA_VERSION = str(_RELEASE_CONFIG["mapDataVersion"])
CACHE_SCHEMA_VERSION = int(_RELEASE_CONFIG["cacheSchemaVersion"])
OFFLINE_PACK_VERSION = str(_RELEASE_CONFIG["offlinePackVersion"])
SOURCE_DATE = os.environ.get("NAV_KURD_OSM_DATE", "2026-07-13")
GEONAMES_DATE = os.environ.get("NAV_KURD_GEONAMES_DATE", "2026-07-14")
REVIEW_DATE = os.environ.get("NAV_KURD_REVIEW_DATE", "2026-07-17")
EARTH_RADIUS = 6_371_008.8

INVISIBLE_RE = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]")
DIACRITICS_RE = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
ARABIC_SCRIPT_RE = re.compile(r"[\u0600-\u06ff]")
LATIN_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]")
KURDISH_DISTINCTIVE_RE = re.compile(r"[پچژڤگکڕڵێۆە]")
TAG_RE = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')
SOURCE_ID_RE = re.compile(r"^(?:osm-(node|way)-|(?:road|building)-)(\d+)")
OSM_POI_RE = re.compile(r"^osm-(?:poi-)?(\d+)")

GENERIC_NAMES = {
    "", "-", "—", "...", "unknown", "unnamed", "no name", "noname", "n/a", "na", "null",
    "place", "places", "other", "checkpoint", "military checkpoint", "security checkpoint",
    "شوێن", "شوێنەکان", "هی تر", "نەزانراو", "ناونەنراو", "بێ ناو", "بازگە",
    "مكان", "أماكن", "أخرى", "غير معروف", "بلا اسم", "بدون اسم", "مجهول", "موقع", "سيطرة",
}

CATEGORY_LABELS: dict[str, dict[str, str]] = {
    "canyon": {"ku": "دەربەند", "ar": "خانق", "en": "Gorge"},
    "dam": {"ku": "بەنداو", "ar": "سد", "en": "Dam"},
    "forest": {"ku": "دارستان", "ar": "غابة", "en": "Forest"},
    "hill": {"ku": "گرد", "ar": "تل", "en": "Hill"},
    "island": {"ku": "دوورگە", "ar": "جزيرة", "en": "Island"},
    "lake": {"ku": "دەریاچە", "ar": "بحيرة", "en": "Lake"},
    "mountain": {"ku": "شاخ", "ar": "جبل", "en": "Mountain"},
    "mountain_pass": {"ku": "دەروازەی شاخ", "ar": "ممر جبلي", "en": "Mountain pass"},
    "nature_reserve": {"ku": "پارێزراوی سروشتی", "ar": "محمية طبيعية", "en": "Nature reserve"},
    "orchard": {"ku": "باخ", "ar": "بستان", "en": "Orchard"},
    "peak": {"ku": "لوتکە", "ar": "قمة", "en": "Peak"},
    "quarry": {"ku": "کانگا", "ar": "مقلع", "en": "Quarry"},
    "reservoir": {"ku": "بەنداوی ئاو", "ar": "خزان مائي", "en": "Reservoir"},
    "river": {"ku": "ڕووبار", "ar": "نهر", "en": "River"},
    "spring": {"ku": "کانی", "ar": "نبع", "en": "Spring"},
    "stream": {"ku": "جۆگە", "ar": "جدول مائي", "en": "Stream"},
    "valley": {"ku": "دۆڵ", "ar": "وادٍ", "en": "Valley"},
    "water_well": {"ku": "بیری ئاو", "ar": "بئر ماء", "en": "Water well"},
    "waterfall": {"ku": "ئاوشار", "ar": "شلال", "en": "Waterfall"},
    "wetland": {"ku": "زەوی تەڕ", "ar": "أرض رطبة", "en": "Wetland"},
    "checkpoint": {"ku": "بازگە", "ar": "نقطة تفتيش", "en": "Checkpoint"},
    "security_checkpoint": {"ku": "بازگەی ئەمنی", "ar": "نقطة تفتيش أمنية", "en": "Security checkpoint"},
    "military_checkpoint": {"ku": "بازگەی سەربازی", "ar": "نقطة تفتيش عسكرية", "en": "Military checkpoint"},
    "police_checkpoint": {"ku": "بازگەی پۆلیس", "ar": "نقطة تفتيش للشرطة", "en": "Police checkpoint"},
    "customs_checkpoint": {"ku": "بازگەی گومرگ", "ar": "نقطة جمارك", "en": "Customs checkpoint"},
    "border_crossing": {"ku": "دەروازەی سنووری", "ar": "منفذ حدودي", "en": "Border crossing"},
}

ROAD_CLASSES: dict[str, tuple[str, float, int]] = {
    "motorway": ("motorway", 8.0, 100), "motorway_link": ("motorway", 8.2, 98),
    "trunk": ("trunk", 8.4, 95), "trunk_link": ("trunk", 8.8, 93),
    "primary": ("primary", 9.4, 88), "primary_link": ("primary", 9.7, 86),
    "secondary": ("secondary", 10.6, 72), "secondary_link": ("secondary", 10.8, 70),
    "tertiary": ("tertiary", 12.0, 55), "tertiary_link": ("tertiary", 12.2, 53),
}


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def evidence_cache_key(source_path: Path, ids: Iterable[str], kind: str) -> str:
    digest = hashlib.sha256()
    digest.update(kind.encode("utf-8"))
    if source_path.exists():
        stat = source_path.stat()
        digest.update(str(source_path.resolve()).encode("utf-8"))
        digest.update(str(stat.st_size).encode("ascii"))
        digest.update(str(stat.st_mtime_ns).encode("ascii"))
    for value in sorted(ids):
        digest.update(value.encode("ascii", errors="ignore"))
        digest.update(b"\0")
    return digest.hexdigest()[:20]


def evidence_to_json(evidence: dict[Any, "NameEvidence"]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, value in evidence.items():
        cache_key = "|".join(key) if isinstance(key, tuple) else str(key)
        output[cache_key] = {"names": value.names, "aliases": value.aliases, "tags": value.tags}
    return output


def evidence_from_json(payload: dict[str, Any], *, tuple_keys: bool) -> dict[Any, "NameEvidence"]:
    output: dict[Any, NameEvidence] = {}
    for raw_key, value in payload.items():
        key: Any = tuple(raw_key.split("|", 1)) if tuple_keys else raw_key
        output[key] = NameEvidence(
            names={lang: clean(value.get("names", {}).get(lang)) for lang in ("ku", "ar", "en")},
            aliases={lang: unique(value.get("aliases", {}).get(lang, [])) for lang in ("ku", "ar", "en")},
            tags={str(k): clean(v) for k, v in value.get("tags", {}).items()},
        )
    return output


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(value, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_fingerprint(path: Path) -> dict[str, Any]:
    """Return a reproducible identity without copying a large source into Git."""
    if not path.exists():
        return {"name": path.name, "present": False}
    if path.is_file():
        return {
            "name": path.name, "present": True, "kind": "file",
            "bytes": path.stat().st_size, "sha256": sha256(path),
        }
    digest = hashlib.sha256()
    total_bytes = 0
    file_count = 0
    for child in sorted(item for item in path.rglob("*") if item.is_file()):
        relative = child.relative_to(path).as_posix()
        size = child.stat().st_size
        child_hash = sha256(child)
        digest.update(relative.encode("utf-8")); digest.update(b"\0")
        digest.update(str(size).encode("ascii")); digest.update(b"\0")
        digest.update(child_hash.encode("ascii")); digest.update(b"\n")
        total_bytes += size; file_count += 1
    return {
        "name": path.name, "present": True, "kind": "directory",
        "files": file_count, "bytes": total_bytes, "sha256_tree": digest.hexdigest(),
    }


def require_sources() -> None:
    missing = [path for path in (PBF, GPKG, GEONAMES_IQ, GEONAMES_ALT, ADMIN_GDB) if not path.exists()]
    if missing:
        formatted = "\n".join(f"  - {path}" for path in missing)
        raise FileNotFoundError(
            "NAV KURD rebuild sources are missing. Supply CLI paths or NAV_KURD_* environment variables:\n" + formatted
        )


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    text = INVISIBLE_RE.sub("", text)
    text = text.replace("ـ", "")
    text = DIACRITICS_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_ku(value: Any) -> str:
    text = clean(value)
    for source, target in (
        ("ك", "ک"), ("ي", "ی"), ("ى", "ی"), ("ة", "ە"), ("ۀ", "ە"),
        ("ھ", "ه"), ("ؤ", "ۆ"), ("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ٱ", "ا"),
    ):
        text = text.replace(source, target)
    if not text or LATIN_RE.search(text) or not ARABIC_SCRIPT_RE.search(text):
        return ""
    return text


def normalize_ar(value: Any) -> str:
    text = clean(value)
    # Arabic fields must not contain letters that are distinctive to Sorani Kurdish.
    # Generic Arabic-script overlap is unavoidable, so explicit source language tags
    # remain the primary provenance signal while these characters provide a strict
    # rejection rule for obvious cross-language contamination.
    if (
        not text
        or LATIN_RE.search(text)
        or not ARABIC_SCRIPT_RE.search(text)
        or KURDISH_DISTINCTIVE_RE.search(text)
    ):
        return ""
    return text


def normalize_en(value: Any) -> str:
    text = clean(value)
    if not text or ARABIC_SCRIPT_RE.search(text) or not LATIN_RE.search(text):
        return ""
    return text


def search_key(value: Any) -> str:
    text = clean(value).casefold()
    for source, target in (("ك", "ک"), ("ي", "ی"), ("ى", "ی"), ("ة", "ە"), ("ۀ", "ە"), ("ھ", "ه"), ("أ", "ا"), ("إ", "ا"), ("آ", "ا")):
        text = text.replace(source, target)
    return re.sub(r"[^\w\u0600-\u06ff]+", "", text)


def meaningful(value: Any, *, allow_code: bool = False) -> bool:
    text = clean(value)
    if not text:
        return False
    if text.casefold() in GENERIC_NAMES or text in GENERIC_NAMES:
        return False
    if re.fullmatch(r"[.\-–—_\s]+", text):
        return False
    if re.fullmatch(r"[\d\s\-_/.,()]+", text):
        return allow_code and bool(re.search(r"\d", text))
    return len(re.sub(r"[^A-Za-z\u0600-\u06ff0-9]+", "", text)) >= 2


def unique(values: Iterable[Any]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = clean(value)
        key = search_key(text)
        if not text or not key or key in seen:
            continue
        seen.add(key)
        output.append(text)
    return output


def join_query(values: Iterable[Any]) -> str:
    return " | ".join(unique(values))


def join_language_query(lang: str, values: Iterable[Any]) -> str:
    """Build a search string only from text valid for the selected language.

    Administrative context and historical source fields are not assumed to be
    correctly language-tagged; every query component is normalized again here
    so a malformed source alias cannot contaminate an exact-language shard.
    """
    normalizer = {"ku": normalize_ku, "ar": normalize_ar, "en": normalize_en}[lang]
    normalized = [normalizer(value) for value in values]
    return join_query(value for value in normalized if meaningful(value))


def parse_tags(raw: Any) -> dict[str, str]:
    text = clean(raw)
    if not text:
        return {}
    result: dict[str, str] = {}
    for key, value in TAG_RE.findall(text):
        result[key.replace(r'\"', '"').replace(r"\\", "\\")] = value.replace(r'\"', '"').replace(r"\\", "\\")
    return result


def source_id(value: Any) -> tuple[str, str] | None:
    text = clean(value)
    match = SOURCE_ID_RE.match(text)
    if match:
        return (match.group(1) or "way", match.group(2))
    match = OSM_POI_RE.match(text)
    if match:
        # Vector POI IDs in this project originate predominantly from OSM nodes.
        return ("node", match.group(1))
    return None


def osm_kind_for_properties(props: dict[str, Any]) -> str | None:
    """Resolve the source geometry kind used by bundled natural records.

    Historical data uses both long and abbreviated entity-kind values. GeoNames
    identifiers are not OSM IDs and must never be scanned from the PBF.
    """
    entity_kind = clean(props.get("entity_kind")).lower()
    if entity_kind in {"node", "n", "point"}:
        return "node"
    if entity_kind in {"way", "w", "area", "polygon", "line", "linestring"}:
        return "way"
    return None


def exact_osm_names(tags: dict[str, str]) -> dict[str, str]:
    ku = normalize_ku(tags.get("name:ckb")) or normalize_ku(tags.get("official_name:ckb"))
    ar = normalize_ar(tags.get("name:ar")) or normalize_ar(tags.get("official_name:ar"))
    en = normalize_en(tags.get("name:en")) or normalize_en(tags.get("int_name")) or normalize_en(tags.get("official_name:en"))
    return {"ku": ku, "ar": ar, "en": en}


def exact_osm_aliases(tags: dict[str, str], lang: str) -> list[str]:
    keys = {
        "ku": ("alt_name:ckb", "old_name:ckb", "short_name:ckb", "loc_name:ckb"),
        "ar": ("alt_name:ar", "old_name:ar", "short_name:ar", "loc_name:ar"),
        "en": ("alt_name:en", "old_name:en", "short_name:en", "loc_name:en"),
    }[lang]
    normalizer = {"ku": normalize_ku, "ar": normalize_ar, "en": normalize_en}[lang]
    values: list[str] = []
    for key in keys:
        raw = clean(tags.get(key))
        if not raw:
            continue
        for part in re.split(r"\s*;\s*", raw):
            value = normalizer(part)
            if meaningful(value):
                values.append(value)
    return unique(values)


@dataclass
class NameEvidence:
    names: dict[str, str] = field(default_factory=lambda: {"ku": "", "ar": "", "en": ""})
    aliases: dict[str, list[str]] = field(default_factory=lambda: {"ku": [], "ar": [], "en": []})
    tags: dict[str, str] = field(default_factory=dict)

    def merge(self, other: "NameEvidence") -> None:
        for lang in ("ku", "ar", "en"):
            if meaningful(other.names.get(lang)) and not meaningful(self.names.get(lang)):
                self.names[lang] = other.names[lang]
            self.aliases[lang] = unique([*self.aliases[lang], *other.aliases[lang]])
        self.tags.update(other.tags)


def collect_needed_ids(localities: list[dict], natural: list[dict], search_items: list[dict]) -> dict[str, set[str]]:
    needed = {"node": set(), "way": set()}
    for feature in [*localities, *natural]:
        props = feature.get("properties", {})
        parsed = source_id(props.get("id"))
        if parsed:
            needed[parsed[0]].add(parsed[1])
        source_kind = osm_kind_for_properties(props)
        for raw in clean(props.get("osm_ids") or props.get("osm_id")).split(","):
            raw = raw.strip().lstrip("-")
            if raw.isdigit() and source_kind:
                needed[source_kind].add(raw)
    for item in search_items:
        parsed = source_id(item.get("s"))
        if parsed:
            needed[parsed[0]].add(parsed[1])
    return needed


def load_osm_evidence(needed: dict[str, set[str]], bbox: tuple[float, float, float, float]) -> dict[tuple[str, str], NameEvidence]:
    if not PBF.exists():
        raise FileNotFoundError(PBF)
    all_ids = {f"{kind}:{identifier}" for kind, identifiers in needed.items() for identifier in identifiers}
    cache_path = CACHE_DIR / f"osm-evidence-{evidence_cache_key(PBF, all_ids, 'osm')}.json"
    if cache_path.exists():
        log(f"Loading cached OSM language evidence: {cache_path.name}")
        return evidence_from_json(read_json(cache_path), tuple_keys=True)
    output: dict[tuple[str, str], NameEvidence] = {}
    specs = [
        ("points", "node", ["osm_id", "name", "barrier", "highway", "place", "other_tags"]),
        ("lines", "way", ["osm_id", "name", "highway", "waterway", "barrier", "other_tags"]),
        ("multipolygons", "way", ["osm_id", "osm_way_id", "name", "amenity", "barrier", "military", "place", "shop", "tourism", "other_tags"]),
    ]
    for layer, kind, columns in specs:
        log(f"Scanning OSM PBF layer {layer} for {len(needed[kind]):,} required {kind} IDs")
        frame = pyogrio.read_dataframe(str(PBF), layer=layer, bbox=bbox, columns=columns, read_geometry=False)
        log(f"OSM layer {layer}: {len(frame):,} rows inside the build bounding box")
        for row in frame.to_dict("records"):
            ids: set[str] = set()
            for key in ("osm_id", "osm_way_id"):
                value = clean(row.get(key)).lstrip("-")
                if value.isdigit() and value in needed[kind]:
                    ids.add(value)
            if not ids:
                continue
            tags = parse_tags(row.get("other_tags"))
            for key in ("barrier", "highway", "place", "amenity", "military", "shop", "tourism", "waterway"):
                value = clean(row.get(key))
                if value:
                    tags.setdefault(key, value)
            exact = exact_osm_names(tags)
            evidence = NameEvidence(names=exact, tags=tags)
            for lang in ("ku", "ar", "en"):
                evidence.aliases[lang] = exact_osm_aliases(tags, lang)
            # Source-provided Latin default names are useful English/transcribed labels,
            # but Arabic-script defaults are not guessed into Kurdish or Arabic fields.
            raw_name = clean(row.get("name"))
            if not evidence.names["en"] and normalize_en(raw_name):
                evidence.names["en"] = normalize_en(raw_name)
            for osm_id in ids:
                output.setdefault((kind, osm_id), NameEvidence()).merge(evidence)
        del frame
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    write_json(cache_path, evidence_to_json(output))
    log(f"Cached {len(output):,} OSM evidence records: {cache_path.name}")
    return output


def collect_geoname_ids(localities: list[dict], natural: list[dict], search_items: list[dict]) -> set[str]:
    ids: set[str] = set()
    for feature in [*localities, *natural]:
        props = feature.get("properties", {})
        for value in (props.get("geonameid"), props.get("osm_id") if clean(props.get("entity_kind")) == "geonames" else None):
            text = clean(value)
            if text.isdigit():
                ids.add(text)
        identifier = clean(props.get("id"))
        if identifier.startswith("geonames-") and identifier[9:].isdigit():
            ids.add(identifier[9:])
    for item in search_items:
        identifier = clean(item.get("s"))
        if identifier.startswith("geonames-") and identifier[9:].isdigit():
            ids.add(identifier[9:])
    return ids


def load_geonames_evidence(needed: set[str]) -> dict[str, NameEvidence]:
    source_signature = f"{GEONAMES_IQ}:{GEONAMES_ALT}"
    cache_path = CACHE_DIR / f"geonames-evidence-{evidence_cache_key(GEONAMES_ALT, needed, source_signature)}.json"
    if cache_path.exists():
        log(f"Loading cached GeoNames language evidence: {cache_path.name}")
        return evidence_from_json(read_json(cache_path), tuple_keys=False)
    output = {identifier: NameEvidence() for identifier in needed}
    # Source-provided GeoNames canonical/ascii names are accepted as English/transcribed
    # evidence where an explicit English alternate is unavailable.
    if GEONAMES_IQ.exists():
        log(f"Scanning GeoNames Iraq records for {len(needed):,} required IDs")
        with GEONAMES_IQ.open(encoding="utf-8") as handle:
            for line in handle:
                columns = line.rstrip("\n").split("\t")
                if len(columns) < 19 or columns[0] not in needed:
                    continue
                canonical, ascii_name = clean(columns[1]), clean(columns[2])
                candidate = normalize_en(ascii_name) or normalize_en(canonical)
                if candidate:
                    output[columns[0]].names["en"] = candidate
    choices: dict[tuple[str, str], list[tuple[tuple[int, int, int, int], str]]] = defaultdict(list)
    aliases: dict[tuple[str, str], list[str]] = defaultdict(list)
    if GEONAMES_ALT.exists():
        log("Scanning GeoNames alternateNamesV2 exact ckb/ku/ar/en aliases")
        with GEONAMES_ALT.open(encoding="utf-8", newline="") as handle:
            reader = csv.reader(handle, delimiter="\t")
            for row in reader:
                if len(row) < 4 or row[1] not in needed:
                    continue
                lang_code = clean(row[2]).lower()
                language = "ku" if lang_code == "ckb" else "ar" if lang_code == "ar" else "en" if lang_code == "en" else ""
                if not language:
                    continue
                normalizer = {"ku": normalize_ku, "ar": normalize_ar, "en": normalize_en}[language]
                value = normalizer(row[3])
                if not meaningful(value):
                    continue
                preferred = 1 if len(row) > 4 and row[4] == "1" else 0
                short = 1 if len(row) > 5 and row[5] == "1" else 0
                colloquial = 1 if len(row) > 6 and row[6] == "1" else 0
                historic = 1 if len(row) > 7 and row[7] == "1" else 0
                priority = (preferred, short, -historic, -colloquial)
                choices[(row[1], language)].append((priority, value))
                if not historic:
                    aliases[(row[1], language)].append(value)
    for (identifier, language), values in choices.items():
        values.sort(key=lambda item: item[0], reverse=True)
        if values:
            output[identifier].names[language] = values[0][1]
            output[identifier].aliases[language] = unique(aliases[(identifier, language)])
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    write_json(cache_path, evidence_to_json(output))
    log(f"Cached {len(output):,} GeoNames evidence records: {cache_path.name}")
    return output


def evidence_for_record(identifier: str, props: dict[str, Any], osm: dict[tuple[str, str], NameEvidence], geonames: dict[str, NameEvidence]) -> NameEvidence:
    result = NameEvidence()
    parsed = source_id(identifier)
    if parsed and parsed in osm:
        result.merge(osm[parsed])
    # Natural features use stable project IDs such as osm-natural-river-<hash>;
    # their actual OSM identity lives in osm_id/osm_ids. Earlier rebuilds loaded
    # this evidence but never merged it, leaving valid exact-language tags unused.
    source_kind = osm_kind_for_properties(props)
    if source_kind:
        for raw in clean(props.get("osm_ids") or props.get("osm_id")).split(","):
            osm_id = raw.strip().lstrip("-")
            evidence = osm.get((source_kind, osm_id)) if osm_id.isdigit() else None
            if evidence:
                result.merge(evidence)
    geoname_id = clean(props.get("geonameid"))
    if not geoname_id and identifier.startswith("geonames-"):
        geoname_id = identifier[9:]
    if not geoname_id and clean(props.get("entity_kind")) == "geonames":
        geoname_id = clean(props.get("osm_id"))
    if geoname_id in geonames:
        result.merge(geonames[geoname_id])
    return result


def apply_names(props: dict[str, Any], evidence: NameEvidence) -> None:
    for lang, normalizer in (("ku", normalize_ku), ("ar", normalize_ar), ("en", normalize_en)):
        existing = normalizer(props.get(f"name_{lang}"))
        sourced = normalizer(evidence.names.get(lang))
        props[f"name_{lang}"] = existing or sourced
        existing_aliases = props.get(f"aliases_{lang}") if isinstance(props.get(f"aliases_{lang}"), list) else []
        aliases = [normalizer(value) for value in [*existing_aliases, sourced, *evidence.aliases[lang]]]
        props[f"aliases_{lang}"] = unique(value for value in aliases if meaningful(value) and search_key(value) != search_key(props[f"name_{lang}"]))
    props["name"] = clean(props.get("name_ku")) or clean(props.get("name_ar")) or clean(props.get("name_en")) or clean(props.get("name"))
    props["name_display"] = props["name"]
    props["language_policy"] = "exact-source-backed-v1"
    props["source_date"] = SOURCE_DATE
    props["last_reviewed"] = REVIEW_DATE
    props["data_release"] = MAP_DATA_VERSION


def update_localities(collection: dict, osm: dict, geonames: dict, boundary) -> tuple[dict, list[dict]]:
    quarantined: list[dict] = []
    kept: list[dict] = []
    for feature in collection.get("features", []):
        props = feature.get("properties", {})
        identifier = clean(props.get("id"))
        apply_names(props, evidence_for_record(identifier, props, osm, geonames))
        coordinate = feature.get("geometry", {}).get("coordinates", [])
        inside = len(coordinate) >= 2 and boundary.covers(Point(float(coordinate[0]), float(coordinate[1])))
        props["qa_inside_coverage_boundary"] = bool(inside)
        if not inside:
            quarantined.append({"id": identifier, "kind": "locality", "reason": "outside-canonical-boundary", "coordinate": coordinate})
            continue
        for lang in ("ku", "ar", "en"):
            admin = [
                props.get(f"admin_subdistrict_{lang}"), props.get(f"admin_district_{lang}"), props.get(f"admin_governorate_{lang}")
            ]
            props[f"search_key_{lang}"] = join_language_query(lang, [props.get(f"name_{lang}"), *props.get(f"aliases_{lang}", []), *admin])
        props["search_key"] = join_query([props.get("search_key_ku"), props.get("search_key_ar"), props.get("search_key_en")])
        kept.append(feature)
    collection["features"] = kept
    cities = [f for f in kept if f.get("properties", {}).get("place") in {"city", "town"}]
    missing_ku = [f.get("properties", {}).get("id") for f in cities if not meaningful(f.get("properties", {}).get("name_ku"))]
    if missing_ku:
        raise RuntimeError(f"City/town Kurdish names are incomplete: {missing_ku[:20]}")
    collection["version"] = MAP_DATA_VERSION
    return collection, quarantined


def load_gpkg_natural_classes(boundary) -> dict[tuple[str, str], set[str]]:
    """Load authoritative Geofabrik feature classes for source-identity dedupe.

    PBF tag exports can omit a class on derived/associated geometries. The free
    GeoPackage carries Geofabrik's normalized fclass, so it is used only as an
    additional deterministic class signal; names still come from exact language
    tags and GeoNames evidence.
    """
    classes: dict[tuple[str, str], set[str]] = defaultdict(set)
    layers = (
        ("gis_osm_natural_free", "node"),
        ("gis_osm_waterways_free", "way"),
        ("gis_osm_landuse_a_free", "way"),
        ("gis_osm_water_a_free", "way"),
        ("gis_osm_natural_a_free", "way"),
    )
    for layer, source_kind in layers:
        frame = gpd.read_file(GPKG, layer=layer, bbox=boundary.bounds, engine="pyogrio", columns=["osm_id", "fclass"])
        for row in frame.itertuples(index=False):
            source_identifier = clean(getattr(row, "osm_id", "")).lstrip("-")
            fclass = clean(getattr(row, "fclass", "")).lower()
            if source_identifier and fclass:
                classes[(source_kind, source_identifier)].add(fclass)
    return classes


def natural_feature_score(
    feature: dict,
    osm: dict[tuple[str, str], NameEvidence],
    gpkg_classes: dict[tuple[str, str], set[str]],
) -> tuple[int, int, int, str]:
    props = feature.get("properties", {})
    category = clean(props.get("category") or props.get("fclass")).lower()
    source_kind = osm_kind_for_properties(props)
    primary_id = clean(props.get("osm_id")).lstrip("-")
    identity = (source_kind, primary_id) if source_kind and primary_id else None
    tags = osm.get(identity, NameEvidence()).tags if identity else {}
    source_match = 0
    if identity and category in gpkg_classes.get(identity, set()):
        source_match = max(source_match, 200)
    for key in ("waterway", "natural", "place"):
        value = clean(tags.get(key)).lower()
        if value and value == category:
            source_match = max(source_match, 150)
    if clean(tags.get("waterway")) and category in {"river", "stream", "canal", "drain", "ditch"}:
        source_match = max(source_match, 100)
    exact_names = sum(1 for lang in ("ku", "ar", "en") if meaningful(props.get(f"name_{lang}")))
    explicit_osm = 1 if source_kind else 0
    return (source_match, exact_names, explicit_osm, clean(props.get("id")))


def natural_dedupe_key(feature: dict) -> tuple | None:
    props = feature.get("properties", {})
    coordinate = feature.get("geometry", {}).get("coordinates", [])
    if len(coordinate) < 2:
        return None
    entity_kind = clean(props.get("entity_kind")).lower()
    if entity_kind == "geonames":
        source_kind = "geonames"
        source_identifier = clean(props.get("geonameid") or props.get("osm_id"))
    else:
        source_kind = osm_kind_for_properties(props)
        source_identifier = clean(props.get("osm_id")).lstrip("-")
    if not source_kind or not source_identifier:
        return None
    return (source_kind, source_identifier, round(float(coordinate[0]), 6), round(float(coordinate[1]), 6))


def update_natural(collection: dict, osm: dict, geonames: dict, boundary, gpkg_classes: dict[tuple[str, str], set[str]]) -> tuple[dict, list[dict]]:
    quarantined: list[dict] = []
    kept: list[dict] = []
    for feature in collection.get("features", []):
        props = feature.get("properties", {})
        identifier = clean(props.get("id"))
        apply_names(props, evidence_for_record(identifier, props, osm, geonames))
        coordinate = feature.get("geometry", {}).get("coordinates", [])
        inside = len(coordinate) >= 2 and boundary.covers(Point(float(coordinate[0]), float(coordinate[1])))
        if not inside:
            quarantined.append({"id": identifier, "kind": "natural", "reason": "outside-canonical-boundary", "coordinate": coordinate})
            continue
        if not any(meaningful(props.get(f"name_{lang}")) for lang in ("ku", "ar", "en")) and not meaningful(props.get("name")):
            quarantined.append({"id": identifier, "kind": "natural", "reason": "no-meaningful-source-name", "coordinate": coordinate})
            continue
        for lang in ("ku", "ar", "en"):
            props[f"search_key_{lang}"] = join_language_query(lang, [props.get(f"name_{lang}"), *props.get(f"aliases_{lang}", []), props.get(f"admin_district_{lang}"), props.get(f"admin_governorate_{lang}")])
        kept.append(feature)

    # Remove only source-identical records at the same coordinate/name. Same names
    # in different places remain untouched. When OSM tags identify the real class,
    # that class wins over a conflicting historical category.
    deduped: list[dict] = []
    key_to_index: dict[tuple, int] = {}
    for feature in kept:
        key = natural_dedupe_key(feature)
        if key is None or key not in key_to_index:
            if key is not None:
                key_to_index[key] = len(deduped)
            deduped.append(feature)
            continue
        index = key_to_index[key]
        current = deduped[index]
        if natural_feature_score(feature, osm, gpkg_classes) > natural_feature_score(current, osm, gpkg_classes):
            winner, loser = feature, current
            deduped[index] = feature
        else:
            winner, loser = current, feature
        loser_props = loser.get("properties", {})
        quarantined.append({
            "id": clean(loser_props.get("id")), "kind": "natural",
            "reason": "duplicate-source-identity",
            "survivor_id": clean(winner.get("properties", {}).get("id")),
            "source_identity": list(key[:2]),
            "coordinate": loser.get("geometry", {}).get("coordinates", []),
        })

    collection["features"] = deduped
    collection["version"] = MAP_DATA_VERSION
    return collection, quarantined


def road_labels(boundary, osm_evidence: dict[tuple[str, str], NameEvidence]) -> dict:
    if not GPKG.exists():
        raise FileNotFoundError(GPKG)
    raw = gpd.read_file(GPKG, layer="gis_osm_roads_free", bbox=boundary.bounds, engine="pyogrio")
    raw = raw[raw.geometry.notna() & ~raw.geometry.is_empty].copy()
    raw["fclass"] = raw["fclass"].map(clean)
    raw["name"] = raw["name"].map(clean)
    raw["ref"] = raw["ref"].map(clean)
    raw["osm_id"] = raw["osm_id"].map(lambda value: clean(value).lstrip("-"))
    raw = raw[raw["fclass"].isin(ROAD_CLASSES)]
    raw = raw[(raw["name"] != "") | (raw["ref"] != "")]
    prepared = prep(boundary)
    raw = raw.loc[[prepared.intersects(geometry) for geometry in raw.geometry]].copy()
    raw["road_class"] = raw["fclass"].map(lambda value: ROAD_CLASSES[value][0])
    raw["minzoom"] = raw["fclass"].map(lambda value: ROAD_CLASSES[value][1])
    raw["rank"] = raw["fclass"].map(lambda value: ROAD_CLASSES[value][2])
    raw["length_m"] = raw.to_crs(3857).length

    records: list[dict] = []
    for row in raw.sort_values("length_m", ascending=False).itertuples(index=False):
        evidence = osm_evidence.get(("way", row.osm_id), NameEvidence())
        names = dict(evidence.names)
        raw_name = clean(row.name)
        if not names["en"] and normalize_en(raw_name):
            names["en"] = normalize_en(raw_name)
        ref = clean(row.ref)
        # Road references are language-neutral identifiers. They remain in the
        # dedicated ref field and may be used as a display/search fallback, but are
        # never copied into exact Kurdish/Arabic/English name fields.
        if not any(meaningful(names[lang]) for lang in ("ku", "ar", "en")) and not meaningful(ref, allow_code=True):
            continue
        key = (row.road_class, search_key(names["ku"]), search_key(names["ar"]), search_key(names["en"]), search_key(ref))
        records.append({"key": key, "row": row, "names": names, "aliases": evidence.aliases})

    best: dict[tuple, dict] = {}
    for record in records:
        if record["key"] not in best:
            best[record["key"]] = record
    features: list[dict] = []
    for record in best.values():
        row = record["row"]
        geometry = row.geometry
        point = geometry.interpolate(0.5, normalized=True) if geometry.geom_type == "LineString" else geometry.representative_point()
        if point.is_empty or not prepared.intersects(point):
            point = geometry.representative_point()
        if point.is_empty or not prepared.intersects(point):
            continue
        names = record["names"]
        identifier = f"road-label-osm-way-{row.osm_id}"
        props = {
            "id": identifier,
            "osm_id": row.osm_id,
            "name": names["ku"] or names["ar"] or names["en"] or clean(row.name) or clean(row.ref),
            "name_ku": names["ku"], "name_ar": names["ar"], "name_en": names["en"],
            "aliases_ku": record["aliases"]["ku"], "aliases_ar": record["aliases"]["ar"], "aliases_en": record["aliases"]["en"],
            "ref": clean(row.ref) or None,
            "class": row.road_class, "minzoom": float(row.minzoom), "rank": int(row.rank),
            "source": "OpenStreetMap data via Geofabrik Iraq GeoPackage + exact OSM language tags",
            "source_date": SOURCE_DATE, "last_reviewed": REVIEW_DATE, "data_release": MAP_DATA_VERSION,
            "language_policy": "exact-source-backed-v1",
        }
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(point.x, 6), round(point.y, 6)]}, "properties": props})
    features.sort(key=lambda feature: (-feature["properties"]["rank"], feature["properties"]["name"]))
    return {
        "type": "FeatureCollection",
        "metadata": {
            "schema": "NAV KURD exact-language road label index v2",
            "source": "OpenStreetMap/Geofabrik",
            "attribution": "© OpenStreetMap contributors",
            "version": MAP_DATA_VERSION,
            "features": len(features),
            "policy": "Major-road anchors use exact language tags or language-neutral road references; no machine-generated place-name translations.",
        },
        "features": features,
    }


def security_category(tags: dict[str, str], row: dict[str, Any]) -> str:
    values = {key: clean(tags.get(key) or row.get(key)).lower() for key in ("barrier", "highway", "military", "police", "customs", "office", "amenity", "border_control", "checkpoint")}
    if values["barrier"] == "border_control" or values["border_control"] in {"yes", "official"}:
        return "border_crossing"
    if values["customs"] in {"yes", "office", "checkpoint"} or values["office"] == "customs":
        return "customs_checkpoint"
    if values["military"] == "checkpoint":
        return "military_checkpoint"
    if values["police"] == "checkpoint":
        return "police_checkpoint"
    if values["highway"] == "checkpoint" or values["barrier"] == "checkpoint" or values["checkpoint"] in {"yes", "security"}:
        return "security_checkpoint"
    return ""


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS * math.asin(math.sqrt(min(1.0, value)))


SECURITY_GENERIC_TOKENS: dict[str, set[str]] = {
    "ku": {
        "خاڵی", "خاڵ", "پشکنین", "پشکنینی", "بازگە", "بازگەی", "بازگه", "بازگهی",
        "زالگە", "زالگەی", "زالگه", "زالگهی", "سیطرە", "سیطرەی", "ئاسایش", "ئاسایشی",
        "پۆلیس", "پۆلیسی", "سەربازی", "هاوبەش", "هاوبەشی", "دەروازە", "دەروازەی",
        "سنوور", "سنووری", "گومرگ", "گومرگی",
    },
    "ar": {
        "نقطة", "نقاط", "تفتيش", "التفتيش", "سيطرة", "السيطرة", "حاجز", "الحاجز",
        "شرطة", "الشرطة", "أمن", "الامن", "امن", "عسكري", "عسكرية", "العسكري", "العسكرية",
        "مراقب", "حرس", "الحرس", "بوابة", "البوابة", "مدخل", "المدخل", "كراج", "الكراج",
        "مطار", "المطار", "حدود", "حدودي", "حدودية", "الحدود", "جمارك", "الجمارك",
    },
    "en": {
        "checkpoint", "checkpoints", "check", "point", "check-point", "check_point", "checking",
        "stuff", "security", "control", "police", "military", "army", "asayish", "asayiş", "asayis", "asayi",
        "zalgeh", "zalgah", "branch", "guard", "entrance", "gate", "border", "crossing", "customs",
        "post", "station", "bazga", "airport", "garage",
    },
}

SECURITY_GENERIC_PHRASES: dict[str, tuple[re.Pattern[str], ...]] = {
    "ku": (
        re.compile(r"خاڵی\s+پشکنینی?", re.IGNORECASE),
        re.compile(r"بازگەی?", re.IGNORECASE),
        re.compile(r"بازگهی?", re.IGNORECASE),
        re.compile(r"زالگەی?", re.IGNORECASE),
        re.compile(r"زالگهی?", re.IGNORECASE),
    ),
    "ar": (
        re.compile(r"نقطة\s+التفتيش", re.IGNORECASE),
        re.compile(r"نقطة\s+تفتيش", re.IGNORECASE),
    ),
    "en": (
        re.compile(r"(?:check|chec|chek|ceck)\s*[-_ ]?\s*point", re.IGNORECASE),
        re.compile(r"control\s+police", re.IGNORECASE),
        re.compile(r"control\s+point", re.IGNORECASE),
    ),
}


def meaningful_security_name(value: Any, lang: str) -> bool:
    normalizer = {"ku": normalize_ku, "ar": normalize_ar, "en": normalize_en}[lang]
    text = normalizer(value)
    if not meaningful(text):
        return False
    for pattern in SECURITY_GENERIC_PHRASES[lang]:
        text = pattern.sub(" ", text)
    raw_tokens = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿĀ-ž\u0600-\u06ff0-9]+", text.casefold())
    tokens = [token for token in raw_tokens if token not in SECURITY_GENERIC_TOKENS[lang]]
    # A published security feature needs a residual proper identifier/location,
    # not only a translated feature type or operational description.
    residual = "".join(tokens)
    return len(residual) >= 2 and not residual.isdigit()


def security_features(boundary, districts: dict) -> tuple[dict, list[dict]]:
    bbox = boundary.bounds
    columns = ["osm_id", "name", "barrier", "highway", "other_tags"]
    frame = pyogrio.read_dataframe(str(PBF), layer="points", bbox=bbox, columns=columns, read_geometry=True)
    prepared = prep(boundary)
    candidates: list[dict] = []
    quarantine: list[dict] = []
    for row in frame.to_dict("records"):
        geometry = row.get("geometry")
        if geometry is None or geometry.is_empty or not prepared.covers(geometry):
            continue
        tags = parse_tags(row.get("other_tags"))
        for key in ("barrier", "highway"):
            value = clean(row.get(key))
            if value:
                tags.setdefault(key, value)
        category = security_category(tags, row)
        if not category:
            continue
        exact = exact_osm_names(tags)
        raw_name = clean(row.get("name"))
        if not exact["en"] and normalize_en(raw_name):
            exact["en"] = normalize_en(raw_name)
        for lang in ("ku", "ar", "en"):
            if not meaningful_security_name(exact[lang], lang):
                exact[lang] = ""
        meaningful_names = {lang: value for lang, value in exact.items() if meaningful_security_name(value, lang)}
        osm_id = clean(row.get("osm_id")).lstrip("-")
        entry = {
            "osm_id": osm_id, "category": category,
            "coordinate": (float(geometry.x), float(geometry.y)),
            "names": exact, "aliases": {lang: exact_osm_aliases(tags, lang) for lang in ("ku", "ar", "en")},
            "tags": {key: value for key, value in tags.items() if key in {"barrier", "highway", "military", "police", "customs", "office", "border_control", "checkpoint"}},
            "raw_name": raw_name,
        }
        if not meaningful_names:
            quarantine.append({"id": f"osm-node-{osm_id}", "kind": "security", "reason": "unnamed-or-generic-security-feature", "category": category, "coordinate": list(entry["coordinate"]), "raw_name": raw_name})
            continue
        candidates.append(entry)

    # Merge lane-level duplicates only when names/categories agree and points are extremely close.
    candidates.sort(key=lambda item: (item["category"], search_key(item["names"]["ku"] or item["names"]["ar"] or item["names"]["en"]), item["osm_id"]))
    clusters: list[dict] = []
    for candidate in candidates:
        candidate_name_key = search_key(candidate["names"]["ku"] or candidate["names"]["ar"] or candidate["names"]["en"])
        matched = None
        for cluster in reversed(clusters[-40:]):
            cluster_name_key = search_key(cluster["names"]["ku"] or cluster["names"]["ar"] or cluster["names"]["en"])
            if cluster["category"] != candidate["category"] or cluster_name_key != candidate_name_key:
                continue
            if haversine(cluster["coordinate"], candidate["coordinate"]) <= 65:
                matched = cluster
                break
        if matched:
            matched["osm_ids"].append(candidate["osm_id"])
            for lang in ("ku", "ar", "en"):
                if not matched["names"][lang] and candidate["names"][lang]:
                    matched["names"][lang] = candidate["names"][lang]
                matched["aliases"][lang] = unique([*matched["aliases"][lang], *candidate["aliases"][lang]])
        else:
            clusters.append({**candidate, "osm_ids": [candidate["osm_id"]]})

    district_shapes = []
    for feature in districts.get("features", []):
        if feature.get("geometry"):
            district_shapes.append((shape(feature["geometry"]), feature.get("properties", {})))
    features: list[dict] = []
    for cluster in clusters:
        lon, lat = cluster["coordinate"]
        context: dict[str, Any] = {}
        point = Point(lon, lat)
        for geometry, properties in district_shapes:
            if geometry.covers(point):
                context = properties
                break
        names = cluster["names"]
        props: dict[str, Any] = {
            "id": f"osm-security-node-{cluster['osm_ids'][0]}",
            "osm_id": cluster["osm_ids"][0], "osm_ids": ",".join(cluster["osm_ids"]),
            "category": cluster["category"],
            "name": names["ku"] or names["ar"] or names["en"],
            "name_ku": names["ku"], "name_ar": names["ar"], "name_en": names["en"],
            "aliases_ku": cluster["aliases"]["ku"], "aliases_ar": cluster["aliases"]["ar"], "aliases_en": cluster["aliases"]["en"],
            "source": "OpenStreetMap exact checkpoint/security tags",
            "source_date": SOURCE_DATE, "last_reviewed": REVIEW_DATE, "data_release": MAP_DATA_VERSION,
            "language_policy": "exact-source-backed-v1",
            **cluster["tags"],
        }
        for lang in ("ku", "ar", "en"):
            props[f"admin_district_{lang}"] = clean(context.get(f"name_{lang}") or context.get(f"admin_district_{lang}"))
            props[f"admin_governorate_{lang}"] = clean(context.get(f"governorate_{lang}") or context.get(f"admin_governorate_{lang}"))
            props[f"search_key_{lang}"] = join_language_query(lang, [props.get(f"name_{lang}"), *props.get(f"aliases_{lang}", []), props.get(f"admin_district_{lang}"), props.get(f"admin_governorate_{lang}")])
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]}, "properties": props})
    features.sort(key=lambda feature: (feature["properties"]["category"], feature["properties"]["name"], feature["properties"]["id"]))
    return ({
        "type": "FeatureCollection", "name": "NAV KURD source-backed security features", "version": MAP_DATA_VERSION,
        "attribution": "© OpenStreetMap contributors",
        "policy": "Named source-backed checkpoint/security records only; generic and unnamed source records remain in the review quarantine.",
        "features": features,
    }, quarantine)


def sync_search(localities: dict, natural: dict, roads: dict, security: dict, original: dict, osm: dict, geonames: dict, excluded_ids: set[str] | None = None) -> dict:
    place_by_id = {clean(feature.get("properties", {}).get("id")): feature.get("properties", {}) for feature in localities.get("features", [])}
    natural_by_id = {clean(feature.get("properties", {}).get("id")): feature.get("properties", {}) for feature in natural.get("features", [])}
    road_by_osm = {clean(feature.get("properties", {}).get("osm_id")): feature.get("properties", {}) for feature in roads.get("features", [])}
    output: list[dict] = []
    seen: set[tuple] = set()
    output_ids: set[str] = set()
    excluded_ids = excluded_ids or set()

    for source_item in original.get("items", []):
        item = dict(source_item)
        identifier = clean(item.get("s"))
        if identifier in excluded_ids:
            continue
        props: dict[str, Any] | None = place_by_id.get(identifier) or natural_by_id.get(identifier)
        parsed = source_id(identifier)
        evidence = NameEvidence()
        if parsed and parsed in osm:
            evidence.merge(osm[parsed])
        if identifier.startswith("geonames-") and identifier[9:] in geonames:
            evidence.merge(geonames[identifier[9:]])
        if identifier.startswith("road-"):
            props = road_by_osm.get(identifier[5:])
        category_labels = CATEGORY_LABELS.get(clean(item.get("c")), {})
        for lang, normalizer in (("ku", normalize_ku), ("ar", normalize_ar), ("en", normalize_en)):
            item[f"c_{lang}"] = normalizer(item.get(f"c_{lang}")) or normalizer(category_labels.get(lang))
            current = normalizer(item.get(f"n_{lang}"))
            candidate = normalizer(props.get(f"name_{lang}")) if props else ""
            sourced = normalizer(evidence.names.get(lang))
            item[f"n_{lang}"] = candidate or sourced or current
            aliases = []
            if props and isinstance(props.get(f"aliases_{lang}"), list):
                aliases.extend(props[f"aliases_{lang}"])
            aliases.extend(evidence.aliases[lang])
            category = clean(item.get(f"c_{lang}"))
            admin = []
            if props:
                admin = [props.get(f"admin_subdistrict_{lang}"), props.get(f"admin_district_{lang}"), props.get(f"admin_governorate_{lang}")]
            item[f"q_{lang}"] = join_language_query(lang, [item.get(f"n_{lang}"), *aliases, category, *admin]) if item.get(f"n_{lang}") else ""
        # Language-neutral road references may appear in every language shard.
        if item.get("k") == "street" and not any(item.get(f"n_{lang}") for lang in ("ku", "ar", "en")):
            ref = clean((props or {}).get("ref"))
            if ref:
                for lang in ("ku", "ar", "en"):
                    item[f"n_{lang}"] = ref
                    item[f"q_{lang}"] = join_query([ref, normalize_ku(item.get(f"c_{lang}")) if lang == "ku" else normalize_ar(item.get(f"c_{lang}")) if lang == "ar" else normalize_en(item.get(f"c_{lang}"))])
                item["language_neutral_name"] = True
        if not any(meaningful(item.get(f"n_{lang}"), allow_code=True) for lang in ("ku", "ar", "en")):
            continue
        item["n"] = clean(item.get("n_ku")) or clean(item.get("n_ar")) or clean(item.get("n_en")) or clean(item.get("n"))
        item["q"] = join_query([item.get("q_ku"), item.get("q_ar"), item.get("q_en")])
        item["data_release"] = MAP_DATA_VERSION
        item["language_policy"] = "exact-source-backed-v1"
        key = (item.get("k"), round(float(item.get("x", 0)), 6), round(float(item.get("y", 0)), 6), identifier)
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
        if identifier:
            output_ids.add(identifier)

    def add_feature(feature: dict, kind: str) -> None:
        props = feature.get("properties", {})
        coords = feature.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            return
        identifier = clean(props.get("id"))
        if not identifier or identifier in output_ids:
            return
        category = clean(props.get("category") or props.get("place") or kind)
        labels = CATEGORY_LABELS.get(category, {})
        item = {
            "n": props.get("name"), "q": "", "k": kind, "c": category,
            "x": float(coords[0]), "y": float(coords[1]), "s": identifier,
            "n_ku": clean(props.get("name_ku")), "n_ar": clean(props.get("name_ar")), "n_en": clean(props.get("name_en")),
            "c_ku": labels.get("ku") or clean(props.get("c_ku")),
            "c_ar": labels.get("ar") or clean(props.get("c_ar")),
            "c_en": labels.get("en") or clean(props.get("c_en")) or category.replace("_", " ").title(),
            "data_release": MAP_DATA_VERSION, "language_policy": "exact-source-backed-v1",
        }
        for lang in ("ku", "ar", "en"):
            item[f"q_{lang}"] = join_language_query(lang, [item.get(f"n_{lang}"), *props.get(f"aliases_{lang}", []), item.get(f"c_{lang}"), props.get(f"admin_district_{lang}"), props.get(f"admin_governorate_{lang}")]) if item.get(f"n_{lang}") else ""
        item["q"] = join_query([item.get("q_ku"), item.get("q_ar"), item.get("q_en")])
        if any(meaningful(item.get(f"n_{lang}")) for lang in ("ku", "ar", "en")):
            output.append(item)
            output_ids.add(identifier)

    for feature in natural.get("features", []):
        add_feature(feature, "poi")
    for feature in security.get("features", []):
        add_feature(feature, "poi")

    kind_order = {"place": 0, "street": 1, "poi": 2, "building": 3}
    output.sort(key=lambda item: (kind_order.get(clean(item.get("k")), 9), clean(item.get("c")), search_key(item.get("n")), clean(item.get("s"))))
    return {
        "version": MAP_DATA_VERSION,
        "attribution": "© OpenStreetMap contributors; GeoNames CC BY 4.0; Iraq administrative boundary source",
        "language_policy": "Exact source-backed selected-language names only; no automatic translation/transliteration and no cross-language visible fallback.",
        "source_records": len(original.get("items", [])),
        "published_records": len(output),
        "removed_without_exact_language_name": max(0, len(original.get("items", [])) - len(output)),
        "items": output,
    }


def apply_reviewed_poi_corrections(search: dict) -> dict:
    """Apply deterministic, source-ID-scoped community corrections after source sync.

    The immutable PMTiles archive remains reproducible. Runtime rendering hides the
    replaced source identity and overlays the reviewed GeoJSON feature. Search is
    patched here so a future source rebuild cannot reintroduce the stale name.
    """
    if not REVIEWED_POI_CORRECTIONS.exists():
        return search
    registry = read_json(REVIEWED_POI_CORRECTIONS)
    items = search.get("items", [])
    by_source = {clean(item.get("s")): item for item in items}
    for feature in registry.get("features", []):
        props = feature.get("properties", {})
        source_id = clean(props.get("replaces_source_id"))
        if not source_id or source_id not in by_source:
            raise RuntimeError(f"Reviewed POI replacement target is missing from search: {source_id}")
        item = by_source[source_id]
        name_ku = normalize_ku(props.get("name_ku"))
        name_ar = normalize_ar(props.get("name_ar"))
        name_en = normalize_en(props.get("name_en"))
        item["n_ku"], item["n_ar"], item["n_en"] = name_ku, name_ar, name_en
        category = clean(props.get("category"))
        item["c_ku"] = "مزگەوت" if category == "muslim" else clean(item.get("c_ku"))
        item["c_ar"] = "مسجد" if category == "muslim" else clean(item.get("c_ar"))
        item["c_en"] = "Mosque" if category == "muslim" else clean(item.get("c_en"))
        item["q_ku"] = join_language_query("ku", [name_ku, item.get("c_ku")]) if name_ku else ""
        item["q_ar"] = join_language_query("ar", [name_ar, item.get("c_ar")]) if name_ar else ""
        item["q_en"] = join_language_query("en", [name_en, item.get("c_en")]) if name_en else ""
        item["n"] = name_ku or name_ar or name_en
        item["q"] = join_query([item.get("q_ku"), item.get("q_ar"), item.get("q_en")])
        item["reviewed_correction"] = REVIEWED_POI_CORRECTIONS.name
        item["review_date"] = clean(props.get("review_date"))
    return search


def exact_counts(records: Iterable[dict], prefix: str) -> dict[str, int]:
    rows = list(records)
    return {lang: sum(1 for record in rows if meaningful(record.get(f"{prefix}{lang}"), allow_code=True)) for lang in ("ku", "ar", "en")}


def build_shards(search: dict) -> dict:
    files: dict[str, dict[str, Any]] = {}
    for lang in ("ku", "ar", "en"):
        items = [item for item in search.get("items", []) if meaningful(item.get(f"n_{lang}"), allow_code=True)]
        payload = {
            "version": MAP_DATA_VERSION, "language": lang,
            "language_policy": "Exact source-backed selected-language names only.",
            "items": items,
        }
        filename = f"kri-search-index-{lang}.json"
        path = DATA / filename
        write_json(path, payload)
        files[lang] = {"file": filename, "records": len(items), "bytes": path.stat().st_size, "sha256": sha256(path)}
    manifest = {
        "version": MAP_DATA_VERSION,
        "schema": "NAV KURD exact-language search shards v1",
        "file": "kri-search-index.json", "fallback": "kri-search-index.json",
        "records": len(search.get("items", [])), "bytes": (DATA / "kri-search-index.json").stat().st_size,
        "sha256": sha256(DATA / "kri-search-index.json"), "files": files,
        "source": "OpenStreetMap/Geofabrik + GeoNames language-coded alternate names + reviewed NAV KURD records",
        "coverage": "Canonical NAV KURD operational boundary",
        "language_policy": "No synthesized place names and no cross-language visible fallback.",
    }
    write_json(DATA / "kri-search-index-manifest.json", manifest, compact=False)
    write_json(DATA / "kri-search-shards-manifest.json", {"version": MAP_DATA_VERSION, "schema": manifest["schema"], "files": files, "fallback": manifest["fallback"], "language_policy": manifest["language_policy"]}, compact=False)
    return manifest



def merge_persistent_quarantine(previous: list[dict], current: list[dict], published_ids: set[str]) -> list[dict]:
    """Keep deterministic reviewed exclusions across idempotent rebuilds.

    Once a duplicate source record is removed from the published input, a later
    rebuild cannot rediscover the losing record. Preserve that audit decision only
    while the recorded survivor still exists and the loser remains unpublished.
    """
    merged = list(current)
    keys = {(clean(item.get("id")), clean(item.get("reason"))) for item in merged}
    for item in previous:
        loser_id = clean(item.get("id"))
        reason = clean(item.get("reason"))
        survivor_id = clean(item.get("survivor_id"))
        if reason != "duplicate-source-identity":
            continue
        if not loser_id or loser_id in published_ids or not survivor_id or survivor_id not in published_ids:
            continue
        key = (loser_id, reason)
        if key not in keys:
            merged.append(item)
            keys.add(key)
    return merged

def update_manifests(
    localities: dict, natural: dict, roads: dict, security: dict, search: dict,
    search_manifest: dict, quarantine: list[dict], source_fingerprints: dict[str, Any]
) -> None:
    kind_counts = Counter(clean(item.get("k")) for item in search.get("items", []))
    report = {
        "release": RELEASE_ID, "app_version": APP_VERSION, "map_data_version": MAP_DATA_VERSION,
        "source_dates": {"osm_geofabrik": SOURCE_DATE, "geonames": GEONAMES_DATE, "reviewed": REVIEW_DATE},
        "source_fingerprints": source_fingerprints,
        "published": {
            "localities": len(localities.get("features", [])), "natural_features": len(natural.get("features", [])),
            "road_labels": len(roads.get("features", [])), "security_features": len(security.get("features", [])),
            "search_records": len(search.get("items", [])), "search_kind_counts": dict(sorted(kind_counts.items())),
            "search_source_records": int(search.get("source_records", len(search.get("items", [])))),
            "search_removed_without_exact_language_name": int(search.get("removed_without_exact_language_name", 0)),
        },
        "exact_language_coverage": {
            "localities": exact_counts((feature.get("properties", {}) for feature in localities.get("features", [])), "name_"),
            "natural_features": exact_counts((feature.get("properties", {}) for feature in natural.get("features", [])), "name_"),
            "road_labels": exact_counts((feature.get("properties", {}) for feature in roads.get("features", [])), "name_"),
            "security_features": exact_counts((feature.get("properties", {}) for feature in security.get("features", [])), "name_"),
            "search": exact_counts(search.get("items", []), "n_"),
        },
        "quarantine_records": len(quarantine),
        "quarantine_reason_counts": dict(sorted(Counter(clean(item.get("reason")) for item in quarantine).items())),
        "reviewed_poi_corrections": len(read_json(REVIEWED_POI_CORRECTIONS).get("features", [])),
        "policy": "Source-backed operational data. Unresolved names/duplicates remain quarantined; no claim of legal or mathematical infallibility.",
    }
    write_json(DATA / "kri-canonical-data-quality-report.json", report, compact=False)
    write_json(DATA_QUALITY_QUARANTINE, {"version": MAP_DATA_VERSION, "count": len(quarantine), "records": quarantine}, compact=False)

    base_manifest = {
        "release": APP_VERSION, "release_id": RELEASE_ID, "map_data_version": MAP_DATA_VERSION,
        "format": "PMTiles v3 + exact-language GeoJSON/search manifests",
        "source_date": SOURCE_DATE, "last_reviewed": REVIEW_DATE,
        "base_map": {"file": "kri-base.pmtiles", "bytes": (DATA / "kri-base.pmtiles").stat().st_size, "sha256": sha256(DATA / "kri-base.pmtiles"), "native_maxzoom": 12},
        "roads": {"file": "kri-roads.pmtiles", "bytes": (DATA / "kri-roads.pmtiles").stat().st_size, "sha256": sha256(DATA / "kri-roads.pmtiles"), "native_maxzoom": 12},
        "search": search_manifest,
        "localities": {"file": "kri-localities.geojson", "records": len(localities.get("features", [])), "bytes": (DATA / "kri-localities.geojson").stat().st_size, "sha256": sha256(DATA / "kri-localities.geojson")},
        "natural_features": {"file": "kri-natural-features.geojson", "records": len(natural.get("features", [])), "bytes": (DATA / "kri-natural-features.geojson").stat().st_size, "sha256": sha256(DATA / "kri-natural-features.geojson")},
        "road_labels": {"file": "kri-road-labels.geojson", "records": len(roads.get("features", [])), "bytes": (DATA / "kri-road-labels.geojson").stat().st_size, "sha256": sha256(DATA / "kri-road-labels.geojson")},
        "security_features": {"file": "kri-security-features.geojson", "records": len(security.get("features", [])), "bytes": (DATA / "kri-security-features.geojson").stat().st_size, "sha256": sha256(DATA / "kri-security-features.geojson")},
        "reviewed_poi_corrections": {"file": REVIEWED_POI_CORRECTIONS.name, "records": len(read_json(REVIEWED_POI_CORRECTIONS).get("features", [])), "bytes": REVIEWED_POI_CORRECTIONS.stat().st_size, "sha256": sha256(REVIEWED_POI_CORRECTIONS)},
        "coverage": {"boundary": {"file": "kri-boundary.geojson", "sha256": sha256(DATA / "kri-boundary.geojson")}, "policy": "Operational application boundary; not a legal/cadastral/political certification."},
        "language_policy": "Exact source-backed names; missing selected-language names remain empty/hidden.",
        "offline": "Base/roads PMTiles are downloadable. Exact-language search shards are cached on demand. Satellite/weather/routing/accounts require network access.",
    }
    write_json(DATA / "kri-base-map-manifest.json", base_manifest, compact=False)

    provenance = {
        "release": RELEASE_ID, "app_version": APP_VERSION, "map_data_version": MAP_DATA_VERSION,
        "scope": "NAV KURD operational coverage for Southern Kurdistan and the agreed disputed-area scope; not a legal/cadastral/political certification.",
        "sources": [
            {"name": "Geofabrik Iraq OpenStreetMap extract", "file": "iraq-260713.osm.pbf / iraq-260713-free.gpkg.zip", "date": SOURCE_DATE, "license": "ODbL / © OpenStreetMap contributors"},
            {"name": "GeoNames Iraq and alternateNamesV2", "file": "IQ.zip / alternateNamesV2.zip", "date": GEONAMES_DATE, "license": "CC BY 4.0"},
            {"name": "Iraq administrative boundaries", "file": "irq_admin_boundaries.gdb.zip", "role": "administrative geometry/hierarchy cross-check"},
            {"name": "NAV KURD reviewed corrections", "role": "source-backed Kurdish city/town names and deterministic quality corrections"},
            {"name": "NAV KURD reviewed POI correction registry", "file": REVIEWED_POI_CORRECTIONS.name, "date": REVIEW_DATE, "role": "Source-ID-scoped reviewed replacements layered above immutable PMTiles"},
        ],
        "counts": report["published"], "exact_language_coverage": report["exact_language_coverage"],
        "source_fingerprints": source_fingerprints,
        "strict_language_policy": {"automatic_translation": False, "automatic_transliteration": False, "cross_language_visible_fallback": False, "missing_names": "empty/hidden and queued for review"},
        "quality_report": "kri-canonical-data-quality-report.json",
    }
    write_json(DATA / "kri-data-provenance.json", provenance, compact=False)

    # release.config.json is the single source of release identity and is never
    # rewritten by the GIS rebuild. Verify immutable offline pack identities only.
    configured_files = {entry["id"]: entry for entry in _RELEASE_CONFIG.get("offlineMapFiles", [])}
    for file_id, filename in (("base", "kri-base.pmtiles"), ("roads", "kri-roads.pmtiles")):
        configured = configured_files.get(file_id)
        path = DATA / filename
        if not configured or configured.get("bytes") != path.stat().st_size or configured.get("sha256") != sha256(path):
            raise RuntimeError(f"release.config.json offline map identity mismatch: {filename}")


def main() -> None:
    global PBF, GPKG, GEONAMES_IQ, GEONAMES_ALT, ADMIN_GDB, CACHE_DIR
    parser = argparse.ArgumentParser(description="Rebuild exact-language NAV KURD map/search metadata from verified Iraq sources.")
    parser.add_argument("--osm-pbf", type=Path, default=PBF)
    parser.add_argument("--gpkg", type=Path, default=GPKG)
    parser.add_argument("--geonames-iq", type=Path, default=GEONAMES_IQ)
    parser.add_argument("--geonames-alt", type=Path, default=GEONAMES_ALT)
    parser.add_argument("--admin-gdb", type=Path, default=ADMIN_GDB)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    args = parser.parse_args()
    PBF, GPKG = args.osm_pbf.resolve(), args.gpkg.resolve()
    GEONAMES_IQ, GEONAMES_ALT = args.geonames_iq.resolve(), args.geonames_alt.resolve()
    ADMIN_GDB, CACHE_DIR = args.admin_gdb.resolve(), args.cache_dir.resolve()
    require_sources()
    log("Starting full NAV KURD canonical data rebuild")
    log(f"Sources: PBF={PBF} GPKG={GPKG} GeoNames={GEONAMES_IQ} alternate={GEONAMES_ALT} admin={ADMIN_GDB}")
    boundary_collection = read_json(DATA / "kri-boundary.geojson")
    boundary = unary_union([shape(feature["geometry"]) for feature in boundary_collection.get("features", []) if feature.get("geometry")])
    if boundary.is_empty:
        raise RuntimeError("Canonical boundary is empty")
    localities = read_json(DATA / "kri-localities.geojson")
    natural = read_json(DATA / "kri-natural-features.geojson")
    search = read_json(DATA / "kri-search-index.json")
    previous_quarantine = read_json(DATA_QUALITY_QUARANTINE).get("records", []) if (DATA_QUALITY_QUARANTINE).exists() else []
    needed = collect_needed_ids(localities.get("features", []), natural.get("features", []), search.get("items", []))
    log(f"Source evidence required: {len(needed['node']):,} OSM nodes, {len(needed['way']):,} OSM ways")
    osm = load_osm_evidence(needed, boundary.bounds)
    geonames_ids = collect_geoname_ids(localities.get("features", []), natural.get("features", []), search.get("items", []))
    log(f"GeoNames evidence required: {len(geonames_ids):,} IDs")
    geonames = load_geonames_evidence(geonames_ids)

    log("Applying exact-language evidence to localities")
    localities, locality_quarantine = update_localities(localities, osm, geonames, boundary)
    log("Loading Geofabrik natural-feature class evidence")
    gpkg_natural_classes = load_gpkg_natural_classes(boundary)
    log("Applying exact-language evidence to natural features")
    natural, natural_quarantine = update_natural(natural, osm, geonames, boundary, gpkg_natural_classes)
    log("Rebuilding major-road label anchors")
    roads = road_labels(boundary, osm)
    log("Extracting source-backed checkpoint/security features")
    security, security_quarantine = security_features(boundary, read_json(DATA / "kri-districts.geojson"))
    log("Synchronizing multilingual search records")
    current_quarantine = [*locality_quarantine, *natural_quarantine, *security_quarantine]
    published_ids = {
        clean(feature.get("properties", {}).get("id"))
        for collection in (localities, natural, security)
        for feature in collection.get("features", [])
        if clean(feature.get("properties", {}).get("id"))
    }
    quarantine = merge_persistent_quarantine(previous_quarantine, current_quarantine, published_ids)
    excluded_ids = {clean(item.get("id")) for item in quarantine if clean(item.get("id"))}
    rebuilt_search = apply_reviewed_poi_corrections(sync_search(localities, natural, roads, security, search, osm, geonames, excluded_ids))

    log("Writing rebuilt data and manifests")
    write_json(DATA / "kri-localities.geojson", localities)
    write_json(DATA / "kri-natural-features.geojson", natural)
    write_json(DATA / "kri-road-labels.geojson", roads)
    write_json(DATA / "kri-security-features.geojson", security)
    write_json(DATA / "kri-search-index.json", rebuilt_search)
    manifest = build_shards(rebuilt_search)
    log("Fingerprinting supplied source datasets for reproducibility")
    source_fingerprints = {
        "osm_pbf": source_fingerprint(PBF),
        "osm_gpkg": source_fingerprint(GPKG),
        "geonames_iq": source_fingerprint(GEONAMES_IQ),
        "geonames_alternate_names": source_fingerprint(GEONAMES_ALT),
        "iraq_admin_gdb": source_fingerprint(ADMIN_GDB),
    }
    update_manifests(localities, natural, roads, security, rebuilt_search, manifest, quarantine, source_fingerprints)
    print(json.dumps({
        "release": RELEASE_ID,
        "localities": len(localities.get("features", [])),
        "natural": len(natural.get("features", [])),
        "road_labels": len(roads.get("features", [])),
        "security": len(security.get("features", [])),
        "search": len(rebuilt_search.get("items", [])),
        "shards": manifest["files"],
        "quarantine": len(quarantine),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
