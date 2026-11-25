#!/usr/bin/env python3
"""
Generate the 5 built-in Color Grading LUTs for VideoAI Studio (v0.4.0).

All LUTs are designed for Rec.709 input (phone footage / AI renders),
NOT for LOG footage — a LOG LUT at full strength burns skin and
crushes blacks on normal footage. Size 32 (LUT_3D_SIZE 32), the
same size as the research sample (research/warm-cinematic-research.cube).

Run:  python3 tools/luts/generate_luts.py
Writes: tools/luts/<id>.cube  (warm-cinematic, colorful, clean-natural,
        film-fade, monochrome)

The "warm-cinematic" recipe follows the research sample: gentle
S-curve + slightly teal shadows + warm highlights + saturation
1.12 + a light black fade.
"""

import os

SIZE = 32
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)))


def clamp(x):
    return max(0.0, min(1.0, x))


def luma(r, g, b):
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def smoothstep(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * (3.0 - 2.0 * t)


def scurve(x, amt):
    """Gentle S-curve: darkens shadows, lifts highlights."""
    return x + amt * x * (1.0 - x) * (x - 0.5) * 2.0


def saturate(r, g, b, sat):
    y = luma(r, g, b)
    return (y + sat * (r - y), y + sat * (g - y), y + sat * (b - y))


def finish(r, g, b):
    return (clamp(r), clamp(g), clamp(b))


def warm_cinematic(r, g, b):
    # S-curve, then saturation, then fade + tints (fade last keeps
    # the lifted blacks lifted instead of darkening them again).
    r, g, b = scurve(r, 0.25), scurve(g, 0.25), scurve(b, 0.25)
    r, g, b = saturate(r, g, b, 1.12)
    # Light black fade.
    r, g, b = 0.02 + 0.98 * r, 0.02 + 0.98 * g, 0.02 + 0.98 * b
    # Teal shadows: stronger where the pixel is dark.
    w = (1.0 - luma(r, g, b)) ** 2
    r -= 0.012 * w
    g += 0.004 * w
    b += 0.028 * w
    # Warm highlights.
    w = smoothstep(0.5, 1.0, luma(r, g, b))
    r += 0.022 * w
    b -= 0.022 * w
    return finish(r, g, b)


def colorful(r, g, b):
    r, g, b = scurve(r, 0.15), scurve(g, 0.15), scurve(b, 0.15)
    # Extra saturation for already-muted pixels (vibrance-like):
    # boost less where the pixel is already strongly saturated.
    sat = max(r, g, b) - min(r, g, b)
    boost = 1.32 + 0.18 * (1.0 - sat)
    r, g, b = saturate(r, g, b, boost)
    return finish(r, g, b)


def clean_natural(r, g, b):
    r, g, b = scurve(r, 0.18), scurve(g, 0.18), scurve(b, 0.18)
    r, g, b = saturate(r, g, b, 1.08)
    return finish(r, g, b)


def film_fade(r, g, b):
    r, g, b = scurve(r, 0.08), scurve(g, 0.08), scurve(b, 0.08)
    r, g, b = saturate(r, g, b, 0.90)
    # Lifted blacks + slightly lowered whites (faded film), warm.
    r = 0.06 + 0.91 * r
    g = 0.06 + 0.91 * g
    b = 0.06 + 0.91 * b
    r *= 1.02
    b *= 0.97
    return finish(r, g, b)


def monochrome(r, g, b):
    y = scurve(luma(r, g, b), 0.25)
    return finish(y, y, y)


LUTS = [
    ("warm-cinematic", "Warm Cinematic - Am dien anh", warm_cinematic),
    ("colorful", "Colorful - Day mau sac", colorful),
    ("clean-natural", "Clean Natural - Sach tu nhien", clean_natural),
    ("film-fade", "Film Fade - Mo phim", film_fade),
    ("monochrome", "Monochrome - Don sac", monochrome),
]


def write_cube(lut_id, title, fn):
    path = os.path.join(OUT_DIR, lut_id + ".cube")
    steps = SIZE - 1
    with open(path, "w", encoding="ascii", newline="\n") as f:
        f.write('TITLE "%s"\n' % title)
        f.write("LUT_3D_SIZE %d\n" % SIZE)
        f.write("DOMAIN_MIN 0.0 0.0 0.0\n")
        f.write("DOMAIN_MAX 1.0 1.0 1.0\n")
        # .cube order: R fastest, then G, then B.
        for bi in range(SIZE):
            for gi in range(SIZE):
                for ri in range(SIZE):
                    r, g, b = fn(ri / steps, gi / steps, bi / steps)
                    f.write("%.6f %.6f %.6f\n" % (r, g, b))
    return path


def main():
    for lut_id, title, fn in LUTS:
        path = write_cube(lut_id, title, fn)
        print("wrote %s (%d entries)" % (path, SIZE ** 3))


if __name__ == "__main__":
    main()
