"""Generate web previews from Blender PNG renders; keep source renders unchanged."""
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text()
sources = sorted(set(re.findall(r'src="(/assets/[^"]+)\.(?:png|webp)"', html)))
report = []
for asset in sources:
    source = ROOT / ("public" + asset + ".png")
    destination = source.with_suffix(".webp")
    with Image.open(source) as image:
        original_size = image.size
        image = image.convert("RGB")
        # Theme buttons display small thumbnails; the gallery keeps larger previews.
        limit = 192 if "/days/" in asset else 960
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=85, method=6)
        report.append({
            "asset": asset,
            "sourceDimensions": original_size,
            "webDimensions": image.size,
            "pngBytes": source.stat().st_size,
            "webpBytes": destination.stat().st_size,
        })
totals = {
    "pngBytes": sum(row["pngBytes"] for row in report),
    "webpBytes": sum(row["webpBytes"] for row in report),
}
evidence = ROOT / "evidence/loading"
evidence.mkdir(parents=True, exist_ok=True)
(evidence / "preview-sizes.json").write_text(
    json.dumps({"settings": {"quality": 85, "method": 6}, "totals": totals, "assets": report}, indent=2) + "\n"
)
print(json.dumps(totals))
