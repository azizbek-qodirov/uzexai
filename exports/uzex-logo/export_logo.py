"""Export the existing UZEX Assist wordmark as transparent slide-ready PNGs."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
FONTS = ROOT / 'public' / 'fonts'
SCALE = 20

def font(name, size):
    return ImageFont.truetype(str(FONTS / name), round(size * SCALE))

REGULAR = 'rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAopxhTg.ttf'
MEDIUM = 'rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAkJxhTg.ttf'
SEMIBOLD = 'rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAfJthTg.ttf'
BOLD = 'rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwARZthTg.ttf'

def coords(values):
    return tuple(round(v * SCALE) for v in values)

def mark(image, x=0, y=0):
    d = ImageDraw.Draw(image)
    d.rounded_rectangle(coords((x+4, y+16, x+54, y+64)), radius=12*SCALE,
                        outline='#326b9b', width=round(.8*SCALE))
    # The upward arrow overlaps the top-right of the open outline.
    d.rectangle(coords((x+35, y+4, x+63, y+27)), fill=(0,0,0,0))
    d.text(coords((x+10, y+25)), 'u', font=font(SEMIBOLD, 48), fill='#37d6ff', anchor='lt')
    purple = '#8581ff'
    d.line([coords((x+39, y+8)), coords((x+57, y+8)), coords((x+57, y+26))],
           fill=purple, width=round(3.6*SCALE), joint='curve')
    d.line([coords((x+39, y+26)), coords((x+57, y+8))], fill=purple, width=round(3.6*SCALE))

def tracked(d, xy, text, typeface, color, tracking):
    x, y = xy
    baseline = y - typeface.getbbox('H', anchor='ls')[1]
    for ch in text:
        d.text((round(x), round(baseline)), ch, font=typeface, fill=color, anchor='ls')
        x += d.textlength(ch, font=typeface) + tracking * SCALE
    return x

wordmark = Image.new('RGBA', (260*SCALE, 76*SCALE), (0,0,0,0))
mark(wordmark, 3, 1)
d = ImageDraw.Draw(wordmark)
x = tracked(d, coords((73, 21)), 'UZEX', font(BOLD, 28), '#f1f5ff', -.9)
tracked(d, (x + 3*SCALE, 21*SCALE), 'Assist', font(MEDIUM, 28), '#b8c9eb', -.9)
tracked(d, coords((73, 59)), 'INTELLIGENT EXCHANGE', font(REGULAR, 9), '#7c93b9', 2)
wordmark = wordmark.resize((2600, 760), Image.Resampling.LANCZOS)
wordmark.save(OUT / 'uzex-assist-with-text.png', dpi=(300,300))

symbol = Image.new('RGBA', (80*SCALE, 80*SCALE), (0,0,0,0))
mark(symbol, 8, 4)
symbol = symbol.resize((1200,1200), Image.Resampling.LANCZOS)
symbol.save(OUT / 'uzex-assist-icon.png', dpi=(300,300))

# Inspection preview only; deliverables retain their alpha transparency.
preview = Image.new('RGBA', (1500,470), '#050e21')
w = wordmark.copy(); w.thumbnail((1040,330), Image.Resampling.LANCZOS)
i = symbol.copy(); i.thumbnail((290,290), Image.Resampling.LANCZOS)
preview.alpha_composite(w, (35,90)); preview.alpha_composite(i, (1170,80))
preview.convert('RGB').save(OUT / 'preview.jpg', quality=94)
for path in [OUT/'uzex-assist-with-text.png', OUT/'uzex-assist-icon.png']:
    im = Image.open(path)
    assert im.mode == 'RGBA' and im.getpixel((0,0))[3] == 0
    print(f'{path.name}: {im.width} x {im.height}, transparent PNG')
