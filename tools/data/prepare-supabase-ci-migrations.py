#!/usr/bin/env python3
"""Create uniquely versioned disposable Supabase migrations for CI.

The production migration filenames are retained for compatibility with the
already-deployed remote project. Supabase uses the text before the first
underscore as the version, so same-day historical files need a CI-only 14-digit
version made from YYYYMMDD + the existing six-digit sequence.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "supabase" / "migrations"
TARGET = ROOT / "supabase" / "migrations-ci"
PATTERN = re.compile(r"^(?P<date>\d{8})_(?P<sequence>\d{6})_(?P<name>.+\.sql)$")


def main() -> int:
    if not SOURCE.is_dir():
        raise SystemExit(f"Migration directory is missing: {SOURCE}")
    shutil.rmtree(TARGET, ignore_errors=True)
    TARGET.mkdir(parents=True)
    seen: set[str] = set()
    count = 0
    for source in sorted(SOURCE.glob("*.sql")):
        match = PATTERN.fullmatch(source.name)
        if not match:
            raise SystemExit(f"Unsupported migration filename: {source.name}")
        version = f"{match.group('date')}{match.group('sequence')}"
        if version in seen:
            raise SystemExit(f"Duplicate normalized migration version: {version}")
        seen.add(version)
        shutil.copy2(source, TARGET / f"{version}_{match.group('name')}")
        count += 1
    if count == 0:
        raise SystemExit("No SQL migrations were found.")
    print(f"Prepared {count} uniquely versioned CI migrations in {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
