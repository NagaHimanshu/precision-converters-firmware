"""Draws the app icons (blush background, gold arch, rose heart).

Run: python tools/make_icons.py
Content stays inside the central safe zone so the same image works as a
"maskable" Android icon.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "icons"
BLUSH, GOLD, ROSE = (246, 220, 220), (201, 162, 39), (232, 160, 168)
S = 2048  # draw large, then downscale for smooth edges


def draw():
    img = Image.new("RGB", (S, S), BLUSH)
    d = ImageDraw.Draw(img)
    w, top, bottom = int(S * 0.40), int(S * 0.22), int(S * 0.78)
    left, right = (S - w) // 2, (S + w) // 2
    line = int(S * 0.022)
    for inset in (0, int(S * 0.045)):
        l, r, t = left + inset, right - inset, top + inset
        b = bottom - inset
        radius = (r - l) // 2
        d.arc([l, t, r, t + 2 * radius], 180, 360, fill=GOLD, width=line)
        d.line([l + line // 2, t + radius, l + line // 2, b], fill=GOLD, width=line)
        d.line([r - line // 2, t + radius, r - line // 2, b], fill=GOLD, width=line)
        d.line([l, b - line // 2, r, b - line // 2], fill=GOLD, width=line)
    # heart
    cx, cy, k = S // 2, int(S * 0.56), int(S * 0.07)
    d.ellipse([cx - 2 * k, cy - k, cx, cy + k], fill=ROSE)
    d.ellipse([cx, cy - k, cx + 2 * k, cy + k], fill=ROSE)
    d.polygon([(cx - 2 * k + k // 8, cy + k // 3), (cx + 2 * k - k // 8, cy + k // 3), (cx, cy + int(2.3 * k))], fill=ROSE)
    return img


base = draw()
for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    base.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
print("icons written to", OUT)
