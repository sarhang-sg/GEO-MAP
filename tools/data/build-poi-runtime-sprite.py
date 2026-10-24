#!/usr/bin/env python3
from __future__ import annotations
import hashlib
import io
import json
import math
import re
from pathlib import Path

try:
    import cairosvg
    from PIL import Image
except ImportError as exc:
    raise SystemExit("Install Python packages cairosvg and Pillow to rebuild the committed runtime sprite.") from exc

ROOT = Path(__file__).resolve().parents[2]
ACTIVE = ROOT / "src/lib/active-static-poi-icons.ts"
GROUPS = ROOT / "public/assets/icons/atlas/groups"
OUTPUT = ROOT / "public/assets/icons/atlas/runtime-sprite"

ids = re.findall(r'^\s*"([a-z0-9_]+)",?\s*$', ACTIVE.read_text(encoding="utf-8"), flags=re.MULTILINE)
if len(ids) < 150:
    raise SystemExit(f"Unexpected active static icon count: {len(ids)}")
svgs: dict[str, str] = {}
for path in sorted(GROUPS.glob("*.json")):
    svgs.update(json.loads(path.read_text(encoding="utf-8"))["icons"])
missing = [icon_id for icon_id in ids if icon_id not in svgs]
if missing:
    raise SystemExit(f"Missing SVG definitions: {missing}")

OUTPUT.mkdir(parents=True, exist_ok=True)
columns = 16
rows = math.ceil(len(ids) / columns)
variants = []
for size, pixel_ratio, suffix, min_dpr in ((80, 2, "2x", 0), (96, 3, "3x", 2.5)):
    sheet = Image.new("RGBA", (columns * size, rows * size), (0, 0, 0, 0))
    icons = {}
    for index, icon_id in enumerate(ids):
        png = cairosvg.svg2png(bytestring=svgs[icon_id].encode("utf-8"), output_width=size, output_height=size)
        image = Image.open(io.BytesIO(png)).convert("RGBA")
        x = (index % columns) * size
        y = (index // columns) * size
        sheet.alpha_composite(image, (x, y))
        icons[icon_id] = {
            "image_id": f"nav-kurd-atlas-{icon_id}",
            "x": x, "y": y, "width": size, "height": size,
        }
    filename = f"nav-kurd-poi-runtime-{suffix}.png"
    image_path = OUTPUT / filename
    sheet.save(image_path, format="PNG", optimize=True, compress_level=9)
    payload = image_path.read_bytes()
    variants.append({
        "min_dpr": min_dpr, "image": filename, "pixel_ratio": pixel_ratio,
        "icon_size": size, "width": sheet.width, "height": sheet.height,
        "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(), "icons": icons,
    })
release = json.loads((ROOT / "release.config.json").read_text(encoding="utf-8"))
manifest = {"schema": "NAV KURD POI Runtime Sprite v2", "release": release["appVersion"], "count": len(ids), "variants": variants}
(OUTPUT / "nav-kurd-poi-runtime.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"Built runtime sprite for {release['appVersion']}: {len(ids)} icons, {len(variants)} density variants.")
