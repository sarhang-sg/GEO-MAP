#!/usr/bin/env python3
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STYLE_ROOT = ROOT / "src" / "styles"


def strip_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def orphan_preludes_before_at_rules(text: str) -> list[tuple[int, str, str]]:
    """Return top-level selector fragments immediately followed by an at-rule.

    Esbuild treats constructs such as `.selector,` followed by `@supports`, or a
    lone `.selector` followed by `@media`, as CSS syntax errors. The previous
    verifier balanced braces but could accidentally interpret the combined text
    as one selector, allowing a warning-producing stylesheet into production.
    """
    cleaned = strip_comments(text)
    failures: list[tuple[int, str, str]] = []
    depth = 0
    pending = ""
    pending_line = 1
    quote: str | None = None
    escape = False

    for line_number, line in enumerate(cleaned.splitlines(), 1):
        stripped = line.strip()
        if depth == 0 and stripped.startswith("@") and pending.strip():
            failures.append((pending_line, compact(pending), stripped.split("{", 1)[0].strip()))
            pending = ""

        index = 0
        while index < len(line):
            char = line[index]
            if quote:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == quote:
                    quote = None
                if depth == 0:
                    pending += char
                index += 1
                continue
            if char in {"'", '"'}:
                quote = char
                if depth == 0:
                    pending += char
            elif char == "{":
                depth += 1
                if depth == 1:
                    pending = ""
            elif char == "}":
                depth = max(0, depth - 1)
                if depth == 0:
                    pending = ""
            elif depth == 0:
                if not pending and not char.isspace():
                    pending_line = line_number
                pending += char
                if char == ";":
                    pending = ""
            index += 1
        if depth == 0 and pending:
            pending += "\n"

    trailing = compact(pending)
    if trailing:
        failures.append((pending_line, trailing, "<end-of-file>"))
    return failures


def blocks(text: str):
    i = 0
    n = len(text)
    start = 0
    quote = None
    escape = False
    while i < n:
        ch = text[i]
        if quote:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in {"'", '"'}:
            quote = ch
            i += 1
            continue
        if ch == ";":
            start = i + 1
            i += 1
            continue
        if ch != "{":
            i += 1
            continue
        header = text[start:i].strip()
        depth = 1
        j = i + 1
        quote = None
        escape = False
        while j < n and depth:
            c = text[j]
            if quote:
                if escape:
                    escape = False
                elif c == "\\":
                    escape = True
                elif c == quote:
                    quote = None
            elif c in {"'", '"'}:
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            j += 1
        if depth:
            raise ValueError(f"Unclosed CSS block near: {header[:80]}")
        yield header, text[i + 1:j - 1]
        start = j
        i = j


def collect(text: str, context: tuple[str, ...], output: list[tuple[tuple[str, ...], str, str]]):
    for header, body in blocks(text):
        normalized_header = compact(header)
        if not normalized_header:
            continue
        if normalized_header.startswith("@") and "{" in body:
            collect(body, (*context, normalized_header), output)
        elif normalized_header.startswith(("@media", "@supports", "@container", "@layer", "@scope", "@keyframes", "@-webkit-keyframes")):
            collect(body, (*context, normalized_header), output)
        elif not normalized_header.startswith("@"):
            output.append((context, normalized_header, compact(body)))


records: dict[tuple[tuple[str, ...], str, str], list[str]] = {}
failures: list[str] = []
important_count = 0
files = sorted(STYLE_ROOT.rglob("*.css"))
for path in files:
    raw_text = path.read_text(encoding="utf-8")
    important_count += raw_text.count("!important")
    for line_number, prelude, at_rule in orphan_preludes_before_at_rules(raw_text):
        failures.append(
            f"{path.relative_to(ROOT)}:{line_number}: orphan top-level CSS prelude {prelude!r} before {at_rule}"
        )
    text = strip_comments(raw_text)
    rules: list[tuple[tuple[str, ...], str, str]] = []
    try:
        collect(text, (), rules)
    except ValueError as error:
        failures.append(f"{path.relative_to(ROOT)}: {error}")
        continue
    for context, selector, body in rules:
        if not body:
            failures.append(f"{path.relative_to(ROOT)}: empty CSS rule {selector!r} in context {' > '.join(context) or '<root>'}")
        records.setdefault((context, selector, body), []).append(str(path.relative_to(ROOT)))

duplicates = [(rule, paths) for rule, paths in records.items() if len(paths) > 1]
for (context, selector, _), paths in duplicates:
    failures.append(f"exact duplicate CSS rule {selector!r} in context {' > '.join(context) or '<root>'}: {' = '.join(paths)}")

if failures:
    print("STYLE VERIFICATION FAILED")
    for failure in failures:
        print("-", failure)
    raise SystemExit(1)
print(f"PASS styles: {len(files)} modules, {len(records)} unique scoped rules, zero empty/exact-duplicate rules, {important_count} explicit cascade locks.")
