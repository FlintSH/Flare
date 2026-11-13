#!/usr/bin/env python3
"""Rebuild the two WOFF2 files the app serves from the bundled Inter TTF.

    python3 -m venv /tmp/fonts && /tmp/fonts/bin/pip install fonttools brotli
    /tmp/fonts/bin/python scripts/fonts/split-inter.py

Inter-latin.woff2 holds the characters English and Western European pages
use; Inter-other.woff2 holds every other character of the same font. Both keep
the weight and optical-size axes, hinting and all layout features, so text is
drawn exactly as the TTF draws it. The script prints the `unicode-range` of
each file for app/fonts.ts.
"""
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parents[2] / "public" / "fonts" / "inter"
SOURCE = FONTS / "Inter-VariableFont_opsz_wght.ttf"
# The range Google Fonts serves as "latin".
LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,"
    "U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,"
    "U+FEFF,U+FFFD"
)


def code_points(ranges: str) -> set[int]:
    points: set[int] = set()
    for part in ranges.replace("U+", "").split(","):
        first, _, last = part.partition("-")
        points.update(range(int(first, 16), int(last or first, 16) + 1))
    return points


def unicode_range(points: list[int]) -> str:
    spans: list[list[int]] = []
    for point in points:
        if spans and point == spans[-1][1] + 1:
            spans[-1][1] = point
        else:
            spans.append([point, point])
    return ",".join(
        f"U+{first:04X}" if first == last else f"U+{first:04X}-{last:04X}"
        for first, last in spans
    )


def write(points: list[int], name: str) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.hinting = True
    font = TTFont(SOURCE)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(FONTS / name)
    size = (FONTS / name).stat().st_size
    print(f"{name}: {size:,} bytes, {len(points)} characters")
    print(unicode_range(points), end="\n\n")


covered = set(TTFont(SOURCE).getBestCmap())
latin = code_points(LATIN)
write(sorted(covered & latin), "Inter-latin.woff2")
write(sorted(covered - latin), "Inter-other.woff2")
