#!/bin/bash

# Kila Icon Generation Script
# Generates all required icon formats from the bundled master image
# Requires: magick (ImageMagick), python3 + Pillow

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SOURCE_IMAGE="icon-source.png"
TRAY_DIR="kila-logos"
RENDERER_BRAND_DIR="../src/renderer/assets/models"
APP_ICON_SIZE=1024
APP_SAFE_SIZE=936
APP_CARD_INSET=56
APP_CARD_RADIUS=300
TRAY_ICON_SIZE=256
TRAY_SAFE_SIZE=220
COMPACT_CROP_RATIO=0.75

echo "🎨 Generating Kila icons from resources/icon-source.png..."

if [ ! -f "$SOURCE_IMAGE" ]; then
  echo "❌ Source image not found: $SOURCE_IMAGE"
  exit 1
fi

if ! command -v magick &> /dev/null; then
  echo "❌ ImageMagick (magick) not found. Install with: brew install imagemagick"
  exit 1
fi

if ! command -v python3 &> /dev/null; then
  echo "❌ python3 not found."
  exit 1
fi

python3 - <<'PY'
try:
    from PIL import Image  # noqa: F401
except Exception as exc:
    raise SystemExit(f'❌ Pillow not available for python3: {exc}')
PY

mkdir -p "$TRAY_DIR"

# 1-2. Generate compact app / tray sources from the same cropped brand master
echo "📦 Generating compact icon sources..."
python3 - <<PY
from PIL import Image, ImageChops, ImageOps
from PIL import ImageDraw
from pathlib import Path

source_image = Path("${SOURCE_IMAGE}")
app_icon_size = ${APP_ICON_SIZE}
app_safe_size = ${APP_SAFE_SIZE}
app_card_inset = ${APP_CARD_INSET}
app_card_radius = ${APP_CARD_RADIUS}
tray_icon_size = ${TRAY_ICON_SIZE}
tray_safe_size = ${TRAY_SAFE_SIZE}
compact_crop_ratio = ${COMPACT_CROP_RATIO}

source = Image.open(source_image).convert('RGBA')


def crop_compact_logo(image: Image.Image) -> Image.Image:
    cropped = image.crop((0, 0, image.width, int(image.height * compact_crop_ratio)))
    diff = ImageChops.difference(
        cropped.convert('RGB'),
        Image.new('RGB', cropped.size, 'white'),
    ).convert('L')
    bbox = diff.point(lambda p: 255 if p > 10 else 0).getbbox()
    if bbox is None:
        raise SystemExit('❌ Unable to detect brand content in source image.')
    return cropped.crop(bbox)


def contain_on_canvas(
    image: Image.Image,
    *,
    canvas_size: int,
    safe_size: int,
    background: tuple[int, int, int, int],
) -> Image.Image:
    fitted = ImageOps.contain(
        image,
        (safe_size, safe_size),
        method=Image.Resampling.LANCZOS,
    )
    canvas = Image.new('RGBA', (canvas_size, canvas_size), background)
    offset = ((canvas_size - fitted.width) // 2, (canvas_size - fitted.height) // 2)
    canvas.paste(fitted, offset, fitted)
    return canvas


compact_logo = crop_compact_logo(source)

app_logo_layer = contain_on_canvas(
    compact_logo,
    canvas_size=app_icon_size,
    safe_size=app_safe_size,
    background=(255, 255, 255, 0),
)
card_mask = Image.new('L', (app_icon_size, app_icon_size), 0)
ImageDraw.Draw(card_mask).rounded_rectangle(
    (
        app_card_inset,
        app_card_inset,
        app_icon_size - 1 - app_card_inset,
        app_icon_size - 1 - app_card_inset,
    ),
    radius=app_card_radius,
    fill=255,
)
card_layer = Image.new('RGBA', (app_icon_size, app_icon_size), (255, 255, 255, 0))
card_layer.putalpha(card_mask)
logo_alpha = ImageChops.multiply(app_logo_layer.getchannel('A'), card_mask)
app_logo_layer.putalpha(logo_alpha)
app_icon = Image.new('RGBA', (app_icon_size, app_icon_size), (0, 0, 0, 0))
app_icon.alpha_composite(card_layer)
app_icon.alpha_composite(app_logo_layer)
app_icon.save('icon.png')

tray_alpha = ImageOps.invert(compact_logo.convert('L')).point(
    lambda p: 0 if p < 8 else p
)
tray_foreground = Image.new('RGBA', compact_logo.size, (0, 0, 0, 0))
tray_foreground.putalpha(tray_alpha)
tray_icon = contain_on_canvas(
    tray_foreground,
    canvas_size=tray_icon_size,
    safe_size=tray_safe_size,
    background=(0, 0, 0, 0),
)
tray_icon.save(Path('${TRAY_DIR}') / 'icon-source.png')
PY

echo "📦 Generating tray icons..."

magick "$TRAY_DIR/icon-source.png" -resize 22x22 "$TRAY_DIR/iconTemplate.png"
magick "$TRAY_DIR/icon-source.png" -resize 44x44 "$TRAY_DIR/iconTemplate@2x.png"
magick "$TRAY_DIR/icon-source.png" -resize 66x66 "$TRAY_DIR/iconTemplate@3x.png"

echo "✅ Tray icons generated:"
echo "   - $TRAY_DIR/iconTemplate.png (22x22 @1x)"
echo "   - $TRAY_DIR/iconTemplate@2x.png (44x44 @2x Retina)"
echo "   - $TRAY_DIR/iconTemplate@3x.png (66x66 @3x)"

# 3. Write self-contained SVG wrappers so source assets stay aligned with the brand master
echo "📦 Writing SVG wrappers..."
python3 - <<'PY'
from base64 import b64encode
from pathlib import Path

root = Path('.')
app_png = root / 'icon.png'
tray_png = root / 'kila-logos' / 'icon-source.png'

app_data = b64encode(app_png.read_bytes()).decode('ascii')
tray_data = b64encode(tray_png.read_bytes()).decode('ascii')

(root / 'icon.svg').write_text(
    f'''<svg id="kila-brand" width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <image href="data:image/png;base64,{app_data}" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid meet"/>
</svg>
''',
    encoding='utf-8',
)

(root / 'kila-logos' / 'icon.svg').write_text(
    f'''<svg id="kila-tray-brand" width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <image href="data:image/png;base64,{tray_data}" x="0" y="0" width="256" height="256" preserveAspectRatio="xMidYMid meet"/>
</svg>
''',
    encoding='utf-8',
)
PY

# 4. Generate .icns (macOS app icon)
echo "📦 Generating icon.icns..."
python3 - <<'PY'
from PIL import Image

img = Image.open('icon.png').convert('RGBA')
img.save('icon.icns')
PY
echo "✅ icon.icns generated"

# 5. Generate .ico (Windows app icon)
echo "📦 Generating icon.ico..."
magick icon.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico
echo "✅ icon.ico generated"

# 6. Sync renderer brand fallbacks
echo "📦 Syncing renderer fallback logos..."
mkdir -p "$RENDERER_BRAND_DIR"
magick icon.png -resize 256x256 "$RENDERER_BRAND_DIR/kila.png"
cp "$RENDERER_BRAND_DIR/kila.png" "$RENDERER_BRAND_DIR/default.png"

echo ""
echo "✅ All Kila icons generated successfully!"
echo ""
echo "Generated files:"
echo "  - icon.png (1024x1024) - Linux & macOS Dock"
echo "  - icon.svg - self-contained app icon wrapper"
echo "  - icon.icns - macOS app icon"
echo "  - icon.ico - Windows app icon"
echo "  - $TRAY_DIR/icon.svg - self-contained tray icon wrapper"
echo "  - $TRAY_DIR/iconTemplate.png - macOS tray (22x22 @1x)"
echo "  - $TRAY_DIR/iconTemplate@2x.png - macOS tray (44x44 @2x Retina)"
echo "  - $TRAY_DIR/iconTemplate@3x.png - macOS tray (66x66 @3x)"
echo "  - ../src/renderer/assets/models/kila.png"
echo "  - ../src/renderer/assets/models/default.png"
