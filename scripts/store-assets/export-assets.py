"""Export and validate the store upload assets. Requires Pillow."""
import hashlib
import json
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / ".cache/store-raw"
OUT = ROOT / "store-assets"
SIZES = {
    "app-store/iphone-6.9": (1320, 2868),
    "app-store/ipad-13": (2064, 2752),
    "google-play/phone": (1080, 1920),
    "google-play/tablet-7": (1080, 1920),
    "google-play/tablet-10": (1440, 2560),
}
FILENAMES = ["01-channels.png", "02-design.png", "03-direct-messages.png", "04-threads.png", "05-group-conversations.png"]

icon = Image.open(ROOT / "apps/mobile/ios/Aulora/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png").convert("RGBA")
opaque = Image.new("RGBA", icon.size, "#18181A")
opaque.alpha_composite(icon)
for store, size, mode in [("app-store", 1024, "RGB"), ("google-play", 512, "RGBA")]:
    folder = OUT / store / "icon"
    folder.mkdir(parents=True, exist_ok=True)
    opaque.resize((size, size), Image.Resampling.LANCZOS).convert(mode).save(folder / f"aulora-{size}x{size}.png", optimize=True)

for family, size in SIZES.items():
    folder = OUT / family
    folder.mkdir(parents=True, exist_ok=True)
    for name in FILENAMES:
        with Image.open(RAW / family / name) as source:
            if source.size != size:
                raise ValueError(f"{family}/{name}: expected native capture {size}, got {source.size}")
            # Normalize to 24-bit PNG. Keep the capture's pixels and geometry.
            source.convert("RGB").save(folder / name, optimize=True)

feature_source = RAW / "feature-graphic.png"
if feature_source.exists():
    with Image.open(feature_source) as source:
        source.convert("RGB").resize((1024, 500), Image.Resampling.LANCZOS).save(OUT / "google-play/feature-graphic-1024x500.png", optimize=True)

manifest = {"locale": "en-US", "capture": "Native iOS and Android app components with a disposable fictional Acme Studio workspace", "assets": []}
for path in sorted(OUT.rglob("*.png")):
    if path.parent == OUT:
        continue
    with Image.open(path) as asset:
        asset.load()
        if asset.format != "PNG":
            raise ValueError(f"Not PNG: {path}")
        is_play_icon = path.relative_to(OUT).as_posix() == "google-play/icon/aulora-512x512.png"
        expected_mode = "RGBA" if is_play_icon else "RGB"
        if asset.mode != expected_mode:
            raise ValueError(f"Unexpected color format: {path}: {asset.mode}")
        if is_play_icon and (path.stat().st_size > 1024 * 1024 or asset.getchannel("A").getextrema() != (255, 255)):
            raise ValueError("Play icon must be opaque and less than 1 MB")
        if "google-play" in path.parts and path.name in FILENAMES:
            width, height = asset.size
            if width * 16 != height * 9 or width < 1080 or height > 3840:
                raise ValueError(f"Play screenshot dimensions are invalid: {path}")
        manifest["assets"].append({"path": path.relative_to(OUT).as_posix(), "width": asset.width, "height": asset.height, "mode": asset.mode, "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
if len(manifest["assets"]) != 28:
    raise ValueError(f"Expected 25 screenshots, 2 icons and a feature graphic; got {len(manifest['assets'])}")
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

# A review sheet is separate from the files that go into the store consoles.
font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
font = ImageFont.truetype(font_path, 22)
small = ImageFont.truetype(font_path, 15)
sheet = Image.new("RGB", (1440, 5 * 620 + 80), "#eae7e2")
draw = ImageDraw.Draw(sheet)
draw.text((32, 24), "Aulora | store screenshots | en-US", fill="#18181A", font=font)
for row, (family, size) in enumerate(SIZES.items()):
    y = 80 + row * 620
    draw.text((32, y), f"{family}  |  {size[0]} x {size[1]}", fill="#18181A", font=font)
    for column, name in enumerate(FILENAMES):
        with Image.open(OUT / family / name) as screenshot:
            thumbnail = ImageOps.contain(screenshot, (260, 548), Image.Resampling.LANCZOS)
        x = 32 + column * 282
        sheet.paste(thumbnail, (x, y + 40))
        draw.text((x, y + 593), name.removesuffix(".png"), fill="#484440", font=small)
sheet.save(OUT / "preview.jpg", quality=90)

archive = ROOT / ".cache/aulora-store-assets.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
    for path in sorted(OUT.rglob("*")):
        if path.is_file():
            package.write(path, path.relative_to(OUT))
print(f"Validated {len(manifest['assets'])} upload PNGs. Archive: {archive}")
