"""
Generate PWA icons in all required sizes.
Run: python frontend/_gen_icons.py
Outputs to frontend/icons/
"""
from PIL import Image, ImageDraw
import os, math

OUT = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT, exist_ok=True)

# Sizes: PWA + iOS + favicon
SIZES = [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-192-maskable.png", 192, True),   # Android adaptive (extra safe-area padding)
    ("icon-512-maskable.png", 512, True),
    ("apple-touch-icon.png", 180, False),   # iOS home screen
    ("favicon-32.png", 32, False),
    ("favicon-16.png", 16, False),
]

GRAD_START = (90, 76, 208)   # #5a4cd0
GRAD_END = (167, 139, 250)   # #a78bfa
HOUSE_WHITE = (255, 255, 255, 255)

def _lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def _diagonal_gradient(size):
    """135deg gradient — top-left → bottom-right."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    diag = size * 1.414  # sqrt(2)
    for y in range(size):
        for x in range(size):
            # Project onto 135deg axis
            t = (x + y) / (2 * size)
            t = max(0.0, min(1.0, t))
            px[x, y] = (*_lerp(GRAD_START, GRAD_END, t), 255)
    return img

def _rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    return mask

def _draw_house(draw, size, safe_area=False):
    """Draw a stylized house outline. safe_area=True shrinks for maskable icons."""
    s = size
    pad = s * 0.20 if safe_area else s * 0.15  # extra padding for adaptive
    inner = s - 2 * pad
    stroke = max(2, int(s * 0.045))
    # House polygon points (scaled to inner area, offset by pad)
    def p(x_pct, y_pct):
        return (pad + inner * x_pct, pad + inner * y_pct)
    # Roof + body
    poly = [
        p(0.10, 0.45),    # top-left of roof descending
        p(0.50, 0.10),    # roof peak
        p(0.90, 0.45),    # top-right of roof
        p(0.90, 0.86),    # bottom-right
        p(0.10, 0.86),    # bottom-left
    ]
    # Draw outline house
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        draw.line([a, b], fill=HOUSE_WHITE, width=stroke, joint="curve")
    # Door
    door = [p(0.40, 0.86), p(0.40, 0.55), p(0.60, 0.55), p(0.60, 0.86)]
    for i in range(len(door) - 1):
        draw.line([door[i], door[i + 1]], fill=HOUSE_WHITE, width=stroke, joint="curve")

def build(name, size, maskable):
    if maskable:
        # Maskable: fill entire bleed area with gradient — Android crops to circle/squircle
        bg = _diagonal_gradient(size)
    else:
        # Regular icon: gradient with rounded corners (12% radius like iOS)
        bg = _diagonal_gradient(size)
        radius = int(size * 0.22)
        mask = _rounded_mask(size, radius)
        rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        rounded.paste(bg, (0, 0), mask)
        bg = rounded
    # Draw house on top
    draw = ImageDraw.Draw(bg)
    if size >= 64:
        _draw_house(draw, size, safe_area=maskable)
    else:
        # tiny favicons — just a solid square with letter "H"
        try:
            from PIL import ImageFont
            font = ImageFont.load_default()
            draw.text((size * 0.3, size * 0.15), "H", fill=HOUSE_WHITE, font=font)
        except Exception:
            pass
    out_path = os.path.join(OUT, name)
    bg.save(out_path, "PNG", optimize=True)
    print(f"  {name}  ({size}x{size}{', maskable' if maskable else ''})")

if __name__ == "__main__":
    print("Generating PWA icons → frontend/icons/")
    for name, size, maskable in SIZES:
        build(name, size, maskable)
    print("Done.")
