#!/usr/bin/env python3
"""Build the player's embedded fonts (src/player/fonts/*.woff2) from the Nacho Combo font files.

Dev-only step; the generated .woff2 files are committed, so building pages never needs this.
Needs fontTools and brotli (pip install fonttools brotli).

usage: python3 scripts/build-fonts.py <dir with Anton-Regular.ttf and IBMPlex*.ttf> [out dir]

The sources are the unmodified files shipped by Nacho Combo (Resources/Fonts), licensed under the
SIL Open Font License 1.1. Subsetting makes a Modified Version. IBM Plex declares the Reserved Font
Name "Plex", so the subsets are renamed ("Nacho Sans", "Nacho Mono"); Anton declares none and keeps its
name. Copyright and license records stay in each font; see FONTLOG.md.
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

# Latin text, punctuation and the arrows / symbols the player prints. Anything else (Hangul included)
# falls back, glyph by glyph, to the system font stack.
TEXT_UNICODES = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + list(range(0x2010, 0x2028)) + list(range(0x2030, 0x203B))
    + [0x2044, 0x20AC, 0x20A9, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x2212, 0x2260, 0x2264, 0x2265, 0x2713]
)
SIGN_UNICODES = list(range(0x20, 0x7F))  # Anton: the one loud line, set in capitals

FONTS = [
    # source file, family, weight, unicodes
    ("IBMPlexSans-Regular.ttf", "Nacho Sans", 400, TEXT_UNICODES),
    ("IBMPlexSans-Medium.ttf", "Nacho Sans", 500, TEXT_UNICODES),
    ("IBMPlexSans-SemiBold.ttf", "Nacho Sans", 600, TEXT_UNICODES),
    ("IBMPlexSans-Bold.ttf", "Nacho Sans", 700, TEXT_UNICODES),
    ("IBMPlexMono-Medium.ttf", "Nacho Mono", 500, TEXT_UNICODES),
    ("IBMPlexMono-SemiBold.ttf", "Nacho Mono", 600, TEXT_UNICODES),
    ("Anton-Regular.ttf", "Anton", 400, SIGN_UNICODES),
]
STYLE = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold"}
NOTE = " Modified Version (subset and renamed) by Mafianacho, 2026."


def rename(font, family, weight):
    """Replace every font-name record; keep copyright (0), trademark (7), vendor/designer (8-12) and license (13, 14)."""
    style = STYLE[weight]
    ps = family.replace(" ", "") + "-" + style
    names = {1: family if weight in (400, 700) else f"{family} {style}", 2: "Bold" if weight == 700 else "Regular",
             3: f"{ps};Mafianacho;2026", 4: f"{family} {style}", 6: ps, 16: family, 17: style}
    table = font["name"]
    for rec in list(table.names):
        if rec.nameID in names or rec.nameID in (18, 21, 22, 25):
            table.removeNames(nameID=rec.nameID)
    for nid, value in names.items():
        table.setName(value, nid, 3, 1, 0x409)
    for rec in table.names:
        if rec.nameID == 0 and NOTE.strip() not in rec.toUnicode():
            rec.string = rec.toUnicode() + NOTE
    if "CFF " in font:
        raise SystemExit("CFF fonts are not expected here")


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "src/player/fonts"
    out.mkdir(parents=True, exist_ok=True)
    for file, family, weight, unicodes in FONTS:
        font = TTFont(src / file)
        opts = subset.Options()
        opts.layout_features = ["*"]  # keep kerning and every OpenType feature for the kept glyphs
        opts.name_IDs = ["*"]
        opts.name_languages = ["*"]
        opts.notdef_outline = True
        opts.flavor = "woff2"
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=unicodes)
        sub.subset(font)
        if family != "Anton":  # "Plex" is a Reserved Font Name: a Modified Version must not carry it
            rename(font, family, weight)
        name = f"{family.lower().replace(' ', '-')}-{weight}.woff2"
        font.flavor = "woff2"
        font.save(out / name)
        leftover = [r.nameID for r in font["name"].names if "plex" in r.toUnicode().lower() and r.nameID not in (0, 7, 8, 9, 10, 11, 12, 13, 14)]
        if leftover:
            raise SystemExit(f"{name}: name records still say Plex: {leftover}")
        print(name, (out / name).stat().st_size)


if __name__ == "__main__":
    main()
