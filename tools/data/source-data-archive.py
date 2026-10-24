#!/usr/bin/env python3
"""Read and verify deterministic source-data entries, including gzip archives."""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = ROOT / "data-src/source-data-manifest.json"


def manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def entry_for(*, source: str | None = None, stage: str | None = None) -> dict[str, Any]:
    for entry in manifest()["entries"]:
        if source and entry.get("source") == source:
            return entry
        if stage and entry.get("stage") == stage:
            return entry
    needle = source or stage or "<unspecified>"
    raise KeyError(f"No source-data manifest entry for {needle}")


def read_entry(entry: dict[str, Any]) -> bytes:
    stored = (ROOT / entry["source"]).read_bytes()
    if entry.get("compression") == "gzip":
        if len(stored) != entry.get("archive_bytes"):
            raise ValueError(f"Compressed byte mismatch: {entry['source']}")
        if hashlib.sha256(stored).hexdigest() != entry.get("archive_sha256"):
            raise ValueError(f"Compressed hash mismatch: {entry['source']}")
        body = gzip.decompress(stored)
    else:
        body = stored

    if len(body) != entry["bytes"]:
        raise ValueError(f"Uncompressed byte mismatch: {entry['source']}")
    if hashlib.sha256(body).hexdigest() != entry["sha256"]:
        raise ValueError(f"Uncompressed hash mismatch: {entry['source']}")
    return body


def read_json_entry(entry: dict[str, Any]) -> Any:
    return json.loads(read_entry(entry).decode("utf-8"))


def read_json_by_stage(stage: str) -> Any:
    return read_json_entry(entry_for(stage=stage))
